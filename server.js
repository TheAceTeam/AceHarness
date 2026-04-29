/* eslint-disable no-console */
const http = require('http');
const path = require('path');
const fs = require('fs');

process.env.ACE_INSTALL_ROOT = process.env.ACE_INSTALL_ROOT || __dirname;
process.chdir(__dirname);

/**
 * Custom server 不会自动加载 Next 在 `next dev` 下注入的 .env*，需在 require('next') 之前合并进 process.env。
 * 与 Next 常见规则一致：已在操作系统环境中存在的变量不会被文件覆盖；多文件时后者覆盖前者。
 */
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
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      const q = value[0];
      value = value.slice(1, -1);
      if (q === '"') {
        value = value.replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      }
    }
    out[key] = value;
  }
  return out;
}

function loadProjectEnvFiles() {
  const root = __dirname;
  const isDev =
    process.argv.includes('dev') || (!process.argv.includes('start') && process.env.NODE_ENV !== 'production');
  const names = isDev
    ? ['.env', '.env.development', '.env.local', '.env.development.local']
    : ['.env', '.env.production', '.env.local', '.env.production.local'];
  const shellKeys = new Set(Object.keys(process.env));
  const merged = {};
  for (const name of names) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    const parsed = parseEnvFileContent(fs.readFileSync(p, 'utf8'));
    Object.assign(merged, parsed);
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!shellKeys.has(key)) process.env[key] = value;
  }
}

loadProjectEnvFiles();

function normalizeRoutesManifest() {
  const manifestPath = path.join(__dirname, '.next', 'routes-manifest.json');
  if (!fs.existsSync(manifestPath)) return;

  try {
    const content = fs.readFileSync(manifestPath, 'utf8');
    const manifest = JSON.parse(content);
    if (Array.isArray(manifest.onMatchHeaders)) return;

    manifest.onMatchHeaders = [];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } catch (error) {
    console.warn('[ACEHarness] Failed to normalize routes-manifest.json:', error);
  }
}

normalizeRoutesManifest();

const next = require('next');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const {
  getWorkspaceDataFile,
  getWorkspaceNotebookRoot,
} = require(path.join(__dirname, 'dist/lib/app-paths.js'));

const dev = process.argv.includes('dev') || (!process.argv.includes('start') && process.env.NODE_ENV !== 'production');
const host = process.env.ACE_HOST || '127.0.0.1';
const port = Number(process.env.PORT || process.env.ACE_PORT || 3000);
const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();

const docs = new Map();

function safeResolve(root, relPath) {
  const rootPath = path.resolve(root);
  const resolved = path.resolve(rootPath, relPath || '.');
  const relative = path.relative(rootPath, resolved);
  if (relative && (relative.startsWith('..') || path.isAbsolute(relative))) return null;
  return resolved;
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
  const usersFile = getWorkspaceDataFile('users.json');
  const users = readJson(usersFile, []);
  if (!Array.isArray(users)) return null;
  const user = users.find((item) => item && item.id === userId);
  if (!user) return null;
  return user;
}

function getShareByToken(token) {
  if (!token) return null;
  const sharesFile = getWorkspaceDataFile('notebook-shares.json');
  const shares = readJson(sharesFile, []);
  if (!Array.isArray(shares)) return null;
  return shares.find((item) => item && item.token === token) || null;
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
      if (conn !== origin && conn.readyState === conn.OPEN) {
        conn.send(payload);
      }
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
      if (conn !== originConn && conn.readyState === conn.OPEN) {
        conn.send(payload);
      }
    }
  });

  docs.set(roomId, item);
  return item;
}

function closeWith(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {}
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
    const globalRoot = getWorkspaceNotebookRoot();
    const share = shareToken ? getShareByToken(shareToken) : null;
    if (shareToken && (!share || share.scope !== 'global')) {
      return { ok: false, reason: '分享链接无效' };
    }

    const relPath = share?.path || filePath;
    if (!relPath) return { ok: false, reason: '缺少文件路径' };
    if (share && filePath && filePath !== share.path) {
      return { ok: false, reason: '文件路径与分享链接不一致' };
    }

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

app.prepare().then(() => {
  const server = http.createServer((req, res) => {
    handle(req, res);
  });
  const handleUpgrade = app.getUpgradeHandler();

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
        awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys()))
      );
      ws.send(Buffer.from(encoding.toUint8Array(awarenessEncoder)));
    }

    ws.on('message', (message) => {
      try {
        const buffer = new Uint8Array(message);
        const decoder = decoding.createDecoder(buffer);
        const messageType = decoding.readVarUint(decoder);
        if (messageType === 0) {
          const syncEncoder = encoding.createEncoder();
          encoding.writeVarUint(syncEncoder, 0);
          syncProtocol.readSyncMessage(decoder, syncEncoder, room.doc, ws);
          const payload = encoding.toUint8Array(syncEncoder);
          if (payload.length > 1) ws.send(Buffer.from(payload));
          return;
        }
        if (messageType === 1) {
          const update = decoding.readVarUint8Array(decoder);
          awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
        }
      } catch {}
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
    const requestUrl = request.url || '';
    if (!requestUrl.startsWith('/api/notebook/collab')) {
      handleUpgrade(request, socket, head);
      return;
    }
    const parsed = new URL(requestUrl, `http://${request.headers.host || 'localhost'}`);
    const resolved = resolveCollabRoom(parsed.searchParams);
    if (!resolved.ok) {
      socket.write(`HTTP/1.1 401 Unauthorized\r\n\r\n${resolved.reason || 'Unauthorized'}`);
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, resolved);
    });
  });

  server.listen(port, host, () => {
    console.log(`[ACEHarness] Server ready on http://${host}:${port}`);
  });
});
