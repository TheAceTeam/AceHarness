import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
process.env.ACE_INSTALL_ROOT = process.env.ACE_INSTALL_ROOT || root;
process.chdir(root);

const host = process.env.ACE_HOST || '127.0.0.1';
const port = Number(process.env.PORT || process.env.ACE_PORT || 3000);
const clientDir = path.join(root, 'dist', 'client');
const serverEntry = path.join(root, 'dist', 'server', 'server.mjs');
const docs = new Map();
let appPaths = null;

function parseEnvFileContent(content) {
  const out = {};
  for (let line of content.split(/\r?\n/)) {
    line = line.replace(/^\uFEFF/, '');
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    let key = trimmed.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      const quote = value[0];
      value = value.slice(1, -1);
      if (quote === '"') value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    out[key] = value;
  }
  return out;
}

function loadProjectEnvFiles() {
  const names = ['.env', '.env.production', '.env.local', '.env.production.local'];
  const shellKeys = new Set(Object.keys(process.env));
  const merged = {};
  for (const name of names) {
    const file = path.join(root, name);
    if (!fs.existsSync(file)) continue;
    Object.assign(merged, parseEnvFileContent(fs.readFileSync(file, 'utf8')));
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!shellKeys.has(key)) process.env[key] = value;
  }
}

function normalizeBasePath(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '/') return '';
  try {
    const parsed = new URL(raw);
    const pathname = parsed.pathname.replace(/\/+$/, '');
    return pathname === '/' ? '' : pathname;
  } catch {
    const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
    const normalized = withSlash.replace(/\/+$/, '');
    return normalized === '/' ? '' : normalized;
  }
}

function stripBasePath(pathname) {
  if (!basePath) return pathname;
  if (pathname === basePath) return '/';
  if (pathname.startsWith(`${basePath}/`)) return pathname.slice(basePath.length) || '/';
  return pathname;
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.js' || ext === '.mjs') return 'text/javascript; charset=utf-8';
  if (ext === '.css') return 'text/css; charset=utf-8';
  if (ext === '.json') return 'application/json; charset=utf-8';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.woff2') return 'font/woff2';
  return 'application/octet-stream';
}

function safeStaticPath(pathname) {
  const stripped = stripBasePath(pathname);
  const rel = decodeURIComponent(stripped.replace(/^\/+/, ''));
  const resolved = path.resolve(clientDir, rel || 'index.html');
  const relative = path.relative(clientDir, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return resolved;
}

function escapeScriptString(value) {
  return JSON.stringify(String(value || '')).replace(/</g, '\\u003c');
}

function rewriteHtmlForBasePath(html) {
  if (!basePath) return html;
  const runtimeScript = `<script>window.__ACE_BASE_PATH=${escapeScriptString(basePath)}</script>`;
  let out = html.includes('window.__ACE_BASE_PATH=')
    ? html
    : html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${runtimeScript}`);
  out = out
    .replace(/\b(src|href)=("|')\/(assets|avatars|engines|file_type|images|office|protocols|uploads|favicon\.ico|logo\.png|readme(?:\.en)?\.png)(?=\/|["'?])/g, `$1=$2${basePath}/$3`)
    .replace(/\b(src|href)=("|')\/(manifest\.webmanifest|site\.webmanifest)(?=["'?])/g, `$1=$2${basePath}/$3`);
  return out;
}

function getAppPaths() {
  if (!appPaths) {
    appPaths = require(path.join(root, 'dist', 'lib', 'core', 'app-paths.js'));
  }
  return appPaths;
}

function refreshRuntimeSkillsOnStartup() {
  try {
    const runtimeSkillsPath = path.join(root, 'dist', 'lib', 'run', 'runtime-skills.js');
    if (!fs.existsSync(runtimeSkillsPath)) return;
    const runtimeSkills = require(runtimeSkillsPath);
    runtimeSkills.refreshBundledAceHarnessSkillsOnStartup?.();
  } catch (error) {
    console.warn('[ACEHarness] Runtime skill startup refresh failed:', error);
  }
}

function readJson(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback;
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return fallback;
  }
}

function validateAuthToken(token) {
  if (!token) return null;
  const { getWorkspaceDataFile } = getAppPaths();
  const tokensFile = getWorkspaceDataFile('tokens.json');
  const entries = readJson(tokensFile, []);
  if (!Array.isArray(entries)) return null;
  const now = Date.now();
  const hit = entries.find((item) => Array.isArray(item) && item[0] === token);
  if (!hit) return null;
  const info = hit[1];
  if (!info || typeof info.userId !== 'string' || typeof info.expiry !== 'number') return null;
  if (info.expiry < now) return null;
  return { userId: info.userId };
}

function getUserById(userId) {
  const { getWorkspaceDataFile } = getAppPaths();
  const usersFile = getWorkspaceDataFile('users.json');
  const users = readJson(usersFile, []);
  if (!Array.isArray(users)) return null;
  return users.find((item) => item && item.id === userId) || null;
}

function getShareByToken(token) {
  if (!token) return null;
  const { getWorkspaceDataFile } = getAppPaths();
  const sharesFile = getWorkspaceDataFile('notebook-shares.json');
  const shares = readJson(sharesFile, []);
  if (!Array.isArray(shares)) return null;
  return shares.find((item) => item && item.token === token) || null;
}

function safeResolve(rootPath, relPath) {
  const resolvedRoot = path.resolve(rootPath);
  const resolved = path.resolve(resolvedRoot, relPath || '.');
  const relative = path.relative(resolvedRoot, resolved);
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) return null;
  return resolved;
}

function resolveCollabRoom(searchParams) {
  const token = searchParams.get('authToken') || '';
  const auth = validateAuthToken(token);
  if (!auth) return { ok: false, reason: '未登录或登录已过期' };
  const user = getUserById(auth.userId);
  if (!user) return { ok: false, reason: '用户不存在' };
  const scope = searchParams.get('scope') === 'global' ? 'global' : 'personal';
  const filePath = String(searchParams.get('file') || '');
  const shareToken = String(searchParams.get('shareToken') || '');
  if (!filePath && !shareToken) return { ok: false, reason: '缺少 file 参数' };
  if (scope === 'global') {
    const { getWorkspaceNotebookRoot } = getAppPaths();
    const globalRoot = getWorkspaceNotebookRoot();
    const share = shareToken ? getShareByToken(shareToken) : null;
    if (shareToken && (!share || share.scope !== 'global')) return { ok: false, reason: '分享链接无效' };
    const relPath = share?.path || filePath;
    if (!relPath) return { ok: false, reason: '缺少文件路径' };
    if (share && filePath && filePath !== share.path) return { ok: false, reason: '文件路径与分享链接不一致' };
    const absPath = safeResolve(globalRoot, relPath);
    if (!absPath) return { ok: false, reason: '路径不合法' };
    return { ok: true, roomId: `global:${absPath}`, user, filePath: relPath };
  }
  if (!user.personalDir) return { ok: false, reason: '用户未配置个人目录' };
  const personalRoot = path.resolve(user.personalDir, '.cangjie-notbook');
  const absPath = safeResolve(personalRoot, filePath);
  if (!absPath) return { ok: false, reason: '路径不合法' };
  return { ok: true, roomId: `personal:${user.id}:${absPath}`, user, filePath };
}

function getOrCreateDoc(roomId) {
  const existing = docs.get(roomId);
  if (existing) return existing;
  const doc = new Y.Doc();
  const awareness = new awarenessProtocol.Awareness(doc);
  const conns = new Set();
  const item = { doc, awareness, conns };
  doc.on('update', (update, origin) => {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeUpdate(encoder, update);
    const payload = Buffer.from(encoding.toUint8Array(encoder));
    for (const conn of conns) {
      if (conn !== origin && conn.readyState === conn.OPEN) conn.send(payload);
    }
  });
  awareness.on('update', ({ added, updated, removed }, originConn) => {
    const changed = added.concat(updated, removed);
    if (changed.length === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(awareness, changed));
    const payload = Buffer.from(encoding.toUint8Array(encoder));
    for (const conn of conns) {
      if (conn !== originConn && conn.readyState === conn.OPEN) conn.send(payload);
    }
  });
  docs.set(roomId, item);
  return item;
}

function isExpectedStreamClose(error) {
  const message = String(error?.message || error || '');
  return error?.name === 'AbortError'
    || error?.code === 'ABORT_ERR'
    || error?.code === 'ERR_STREAM_PREMATURE_CLOSE'
    || message.includes('Stream lifetime exceeded')
    || message.includes('The operation was aborted')
    || message.includes('aborted')
    || message.includes('Premature close');
}

function sendNodeResponse(req, res, response, abortController) {
  const contentTypeHeader = response.headers.get('content-type') || '';
  if (basePath && contentTypeHeader.includes('text/html')) {
    response.text().then((html) => {
      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        if (key.toLowerCase() !== 'content-length') res.setHeader(key, value);
      });
      res.end(rewriteHtmlForBasePath(html));
    }).catch((error) => {
      console.error('[ACEHarness] Failed to rewrite Start HTML response:', error);
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'Start HTML rewrite failed' }));
    });
    return;
  }

  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!response.body) {
    res.end();
    return;
  }
  const reader = response.body.getReader();

  let closed = false;
  let readerReleased = false;
  let drainReject = null;

  const releaseReader = () => {
    if (readerReleased) return;
    readerReleased = true;
    try {
      reader.releaseLock();
    } catch {
      // The lock may still be held by a pending read/cancel.
    }
  };

  const cleanup = async (reason, cancelReader = true) => {
    if (closed) return;
    closed = true;
    if (drainReject) {
      drainReject(reason instanceof Error ? reason : new Error(String(reason || 'stream closed')));
      drainReject = null;
    }
    req.off('aborted', onRequestAborted);
    res.off('close', onResponseClose);
    res.off('error', onResponseError);
    if (cancelReader) {
      if (abortController && !abortController.signal.aborted) {
        try {
          abortController.abort(reason);
        } catch {
          // Ignore abort races.
        }
      }
      try {
        await reader.cancel(reason);
      } catch {
        // The upstream transform may already be errored or cancelled.
      }
    }
    releaseReader();
  };

  const closeResponse = () => {
    if (!res.writableEnded && !res.destroyed) {
      try {
        res.end();
      } catch {
        // Ignore close races.
      }
    }
  };

  const onRequestAborted = () => {
    void cleanup(new Error('client aborted request'));
  };
  const onResponseClose = () => {
    void cleanup(new Error('response closed'));
  };
  const onResponseError = (error) => {
    void cleanup(error);
  };

  req.once('aborted', onRequestAborted);
  res.once('close', onResponseClose);
  res.once('error', onResponseError);

  const waitForDrain = () => new Promise((resolve, reject) => {
    const cleanupDrain = () => {
      res.off('drain', onDrain);
      res.off('error', onError);
      drainReject = null;
    };
    const onDrain = () => {
      cleanupDrain();
      resolve();
    };
    const onError = (error) => {
      cleanupDrain();
      reject(error);
    };
    drainReject = (error) => {
      cleanupDrain();
      reject(error);
    };
    res.once('drain', onDrain);
    res.once('error', onError);
  });

  const pump = async () => {
    try {
      while (!closed) {
        const { done, value } = await reader.read();
        if (done) {
          await cleanup(undefined, false);
          closeResponse();
          return;
        }
        if (closed || res.destroyed) return;
        if (!res.write(Buffer.from(value))) {
          await waitForDrain();
        }
      }
    } catch (error) {
      await cleanup(error);
      if (isExpectedStreamClose(error)) {
        closeResponse();
        return;
      }
      console.error('[ACEHarness] Failed to stream Start response:', error);
      if (!res.destroyed) res.destroy();
    } finally {
      releaseReader();
    }
  };

  void pump();
}

async function restoreScheduler() {
  try {
    const schedulerModulePath = path.join(root, 'dist', 'lib', 'core', 'scheduler.js');
    if (!fs.existsSync(schedulerModulePath)) {
      console.warn('[ACEHarness] Scheduler restore skipped: dist/lib/core/scheduler.js not found');
      return;
    }
    const { scheduler } = await import(pathToFileURL(schedulerModulePath).href);
    if (scheduler?.init) {
      await scheduler.init();
      console.log('[ACEHarness] Scheduler restored');
    }
  } catch (error) {
    console.error('[ACEHarness] Scheduler restore failed:', error);
  }
}

function startMemoryWatchdog() {
  const maxMb = Number(process.env.ACE_MEMORY_WATCHDOG_MB || 0);
  if (!Number.isFinite(maxMb) || maxMb <= 0) return;
  setInterval(() => {
    const usedMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
    if (usedMb > maxMb) {
      console.error(`[ACEHarness] Memory watchdog limit exceeded: ${usedMb}MB > ${maxMb}MB`);
      process.exit(137);
    }
  }, 30_000).unref();
}

loadProjectEnvFiles();
process.env.NODE_ENV = process.env.NODE_ENV || 'production';
const basePath = normalizeBasePath(process.env.BASEURL || process.env.BASE_URL);
process.env.NEXT_PUBLIC_BASEURL = process.env.NEXT_PUBLIC_BASEURL || basePath;
refreshRuntimeSkillsOnStartup();

if (!fs.existsSync(serverEntry)) {
  console.error('[ACEHarness] 未找到 TanStack Start 服务端产物 dist/server/server.mjs。请先执行 `npm run build:start`。');
  process.exit(1);
}

let fetchHandler = null;
let loadedServerEntryMtimeMs = -1;
let reloadPromise = null;

function serverEntryMtimeMs() {
  try {
    return fs.statSync(serverEntry).mtimeMs;
  } catch {
    return -1;
  }
}

async function refreshFetchHandler({ required = false } = {}) {
  const mtimeMs = serverEntryMtimeMs();
  if (mtimeMs < 0) {
    if (required) {
      throw new Error(`TanStack Start server entry is unavailable: ${serverEntry}`);
    }
    return;
  }
  if (fetchHandler && mtimeMs === loadedServerEntryMtimeMs) return;
  if (reloadPromise) return reloadPromise;

  reloadPromise = (async () => {
    // A running local Start server can outlive `npm run build:start`. Bust the
    // Node ESM entry cache so its SSR manifest and dist/client asset hashes
    // advance together, instead of rendering an HTML document that references
    // chunks removed by the rebuild.
    const entryUrl = pathToFileURL(serverEntry);
    entryUrl.searchParams.set('build', String(mtimeMs));
    const startServer = await import(entryUrl.href);
    const nextFetchHandler = startServer.default?.fetch;
    if (typeof nextFetchHandler !== 'function') {
      throw new Error('TanStack Start server entry does not export a fetch handler.');
    }
    fetchHandler = nextFetchHandler;
    loadedServerEntryMtimeMs = mtimeMs;
  })();

  try {
    await reloadPromise;
  } finally {
    reloadPromise = null;
  }
}

try {
  await refreshFetchHandler({ required: true });
} catch (error) {
  console.error('[ACEHarness] Failed to load TanStack Start server entry:', error);
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  const abortController = new AbortController();
  const abortStartRequest = () => {
    if (!abortController.signal.aborted) {
      abortController.abort(new Error('client disconnected'));
    }
  };
  req.once('aborted', abortStartRequest);
  res.once('close', abortStartRequest);
  try {
    await refreshFetchHandler();
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`);
    const staticPath = safeStaticPath(requestUrl.pathname);
    if (staticPath && fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
      req.off('aborted', abortStartRequest);
      res.off('close', abortStartRequest);
      res.writeHead(200, {
        'content-type': contentType(staticPath),
        'cache-control': requestUrl.pathname.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      });
      fs.createReadStream(staticPath).pipe(res);
      return;
    }

    const headers = new Headers();
    for (const [key, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) {
        for (const item of value) headers.append(key, item);
      } else if (value !== undefined) {
        headers.set(key, value);
      }
    }
    const handlerUrl = new URL(requestUrl);
    handlerUrl.pathname = stripBasePath(handlerUrl.pathname);
    const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : req;
    const request = new Request(handlerUrl, {
      method: req.method,
      headers,
      body,
      duplex: body ? 'half' : undefined,
      signal: abortController.signal,
    });
    const response = await fetchHandler(request);
    req.off('aborted', abortStartRequest);
    res.off('close', abortStartRequest);
    sendNodeResponse(req, res, response, abortController);
  } catch (error) {
    req.off('aborted', abortStartRequest);
    res.off('close', abortStartRequest);
    if (abortController.signal.aborted || res.destroyed) return;
    console.error('[ACEHarness] Start request failed:', error);
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'Start request failed' }));
  }
});

const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws, request, context) => {
  const room = getOrCreateDoc(context.roomId);
  room.conns.add(ws);
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, 0);
  syncProtocol.writeSyncStep1(encoder, room.doc);
  ws.send(Buffer.from(encoding.toUint8Array(encoder)));

  const states = room.awareness.getStates();
  if (states.size > 0) {
    const awarenessEncoder = encoding.createEncoder();
    encoding.writeVarUint(awarenessEncoder, 1);
    encoding.writeVarUint8Array(
      awarenessEncoder,
      awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())),
    );
    ws.send(Buffer.from(encoding.toUint8Array(awarenessEncoder)));
  }

  ws.on('message', (data) => {
    try {
      const decoder = decoding.createDecoder(new Uint8Array(data));
      const messageType = decoding.readVarUint(decoder);
      if (messageType === 0) {
        const reply = encoding.createEncoder();
        encoding.writeVarUint(reply, 0);
        syncProtocol.readSyncMessage(decoder, reply, room.doc, ws);
        const payload = encoding.toUint8Array(reply);
        if (payload.length > 1 && ws.readyState === ws.OPEN) {
          ws.send(Buffer.from(payload));
        }
      } else if (messageType === 1) {
        awarenessProtocol.applyAwarenessUpdate(
          room.awareness,
          decoding.readVarUint8Array(decoder),
          ws,
        );
      }
    } catch (error) {
      console.warn('[ACEHarness] Notebook collab message failed:', error);
    }
  });

  ws.on('close', () => {
    room.conns.delete(ws);
    if (room.conns.size === 0) {
      room.doc.destroy();
      docs.delete(context.roomId);
    }
  });
});

server.on('upgrade', (request, socket, head) => {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (stripBasePath(requestUrl.pathname).startsWith('/api/notebook/collab')) {
    const resolved = resolveCollabRoom(requestUrl.searchParams);
    if (!resolved.ok) {
      socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${resolved.reason || 'Unauthorized'}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, resolved);
    });
    return;
  }
  socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
  socket.destroy();
});

server.listen(port, host, async () => {
  console.log(`[ACEHarness] TanStack Start server ready on http://${host}:${port}${basePath || ''}`);
  startMemoryWatchdog();
  await restoreScheduler();
});
