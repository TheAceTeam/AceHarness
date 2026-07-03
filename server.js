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
        if (!trimmed || trimmed.startsWith('#'))
            continue;
        const eq = trimmed.indexOf('=');
        if (eq === -1)
            continue;
        let key = trimmed.slice(0, eq).trim();
        if (key.startsWith('export '))
            key = key.slice(7).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (value.length >= 2 &&
            ((value.startsWith('"') && value.endsWith('"')) ||
                (value.startsWith("'") && value.endsWith("'")))) {
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
    const isDev = process.argv.includes('dev');
    const names = isDev
        ? ['.env', '.env.development', '.env.local', '.env.development.local']
        : ['.env', '.env.production', '.env.local', '.env.production.local'];
    const shellKeys = new Set(Object.keys(process.env));
    const merged = {};
    for (const name of names) {
        const p = path.join(root, name);
        if (!fs.existsSync(p))
            continue;
        const parsed = parseEnvFileContent(fs.readFileSync(p, 'utf8'));
        Object.assign(merged, parsed);
    }
    for (const [key, value] of Object.entries(merged)) {
        if (!shellKeys.has(key))
            process.env[key] = value;
    }
}
loadProjectEnvFiles();
function normalizeBasePath(value) {
    const raw = String(value || '').trim();
    if (!raw || raw === '/')
        return '';
    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '');
        return pathname === '/' ? '' : pathname;
    }
    catch {
        const withSlash = raw.startsWith('/') ? raw : `/${raw}`;
        const normalized = withSlash.replace(/\/+$/, '');
        return normalized === '/' ? '' : normalized;
    }
}
const basePath = normalizeBasePath(process.env.BASEURL || process.env.BASE_URL);
function normalizeRoutesManifest() {
    const manifestPath = path.join(__dirname, '.next', 'routes-manifest.json');
    if (!fs.existsSync(manifestPath))
        return;
    try {
        const content = fs.readFileSync(manifestPath, 'utf8');
        const manifest = JSON.parse(content);
        if (Array.isArray(manifest.onMatchHeaders))
            return;
        manifest.onMatchHeaders = [];
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
    catch (error) {
        console.warn('[ACEHarness] Failed to normalize routes-manifest.json:', error);
    }
}
normalizeRoutesManifest();
// ACEHarness: 运行模式显式化 —— 仅当显式传入 `dev` 才进开发模式，否则一律生产。
// 防止"启动方式不规范 → 误入 .next/dev 开发模式 → require.cache 堆积编译分片 → OOM"。
const dev = process.argv.includes('dev');
if (!dev) {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
    if (!fs.existsSync(path.join(__dirname, '.next', 'BUILD_ID'))) {
        console.error('[ACEHarness] 未找到生产构建产物 .next/BUILD_ID。请先执行 `npm run build`，再以生产模式启动（npm start / ace start）。');
        process.exit(1);
    }
}
else {
    console.warn('[ACEHarness] ⚠ 正在以 DEV（开发）模式运行 —— 仅供本地开发；长期运行内存会持续增长直至 OOM，请勿用于部署。');
}
const next = require('next');
const { WebSocketServer } = require('ws');
const Y = require('yjs');
const syncProtocol = require('y-protocols/sync');
const awarenessProtocol = require('y-protocols/awareness');
const encoding = require('lib0/encoding');
const decoding = require('lib0/decoding');
const { getWorkspaceDataFile, getWorkspaceNotebookRoot, } = require(path.join(__dirname, 'dist/lib/core/app-paths.js'));
const host = process.env.ACE_HOST || '127.0.0.1';
const port = Number(process.env.PORT || process.env.ACE_PORT || 3000);
const CHAT_REQUEST_TIMEOUT_MS = 20 * 60 * 1000;
const app = next({ dev, hostname: host, port });
const handle = app.getRequestHandler();
const docs = new Map();
let ragStore = null;
async function restoreScheduler() {
    try {
        const schedulerModulePath = path.join(__dirname, 'dist', 'lib', 'core', 'scheduler.js');
        if (!fs.existsSync(schedulerModulePath)) {
            return;
        }
        const { scheduler } = require(schedulerModulePath);
        if (scheduler?.init) {
            await scheduler.init();
            console.log('[ACEHarness] Scheduler restored');
        }
    }
    catch (error) {
        console.error('[ACEHarness] Scheduler restore failed:', error);
    }
}
function stripBasePath(pathname) {
    if (!basePath)
        return pathname;
    if (pathname === basePath)
        return '/';
    if (pathname.startsWith(`${basePath}/`))
        return pathname.slice(basePath.length) || '/';
    return pathname;
}
function safeResolve(root, relPath) {
    const rootPath = path.resolve(root);
    const resolved = path.resolve(rootPath, relPath || '.');
    const relative = path.relative(rootPath, resolved);
    if (relative && (relative.startsWith('..') || path.isAbsolute(relative)))
        return null;
    return resolved;
}
function readJson(filePath, fallback) {
    try {
        if (!fs.existsSync(filePath))
            return fallback;
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    }
    catch {
        return fallback;
    }
}
function validateAuthToken(token) {
    if (!token)
        return null;
    const tokensFile = getWorkspaceDataFile('tokens.json');
    const entries = readJson(tokensFile, []);
    if (!Array.isArray(entries))
        return null;
    const now = Date.now();
    const hit = entries.find((item) => Array.isArray(item) && item[0] === token);
    if (!hit)
        return null;
    const info = hit[1];
    if (!info || typeof info.userId !== 'string' || typeof info.expiry !== 'number')
        return null;
    if (info.expiry < now)
        return null;
    return { userId: info.userId };
}
function getUserById(userId) {
    const usersFile = getWorkspaceDataFile('users.json');
    const users = readJson(usersFile, []);
    if (!Array.isArray(users))
        return null;
    const user = users.find((item) => item && item.id === userId);
    if (!user)
        return null;
    return user;
}
function getRagStore() {
    if (!ragStore) {
        ragStore = require(path.join(__dirname, 'dist', 'lib', 'rag', 'store.js'));
    }
    return ragStore;
}
function sendJson(res, status, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(body),
    });
    res.end(body);
}
function requireRequestUser(req, res) {
    const authHeader = String(req.headers.authorization || '');
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const auth = validateAuthToken(token);
    if (!auth) {
        sendJson(res, 401, { error: '未登录或登录已过期' });
        return null;
    }
    const user = getUserById(auth.userId);
    if (!user) {
        sendJson(res, 401, { error: '用户不存在' });
        return null;
    }
    if (user.status === 'pending') {
        sendJson(res, 403, { error: '账号等待管理员审核' });
        return null;
    }
    if (user.status === 'rejected') {
        sendJson(res, 403, { error: '账号注册申请未通过' });
        return null;
    }
    return {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        personalDir: user.personalDir,
        avatar: user.avatar,
    };
}
function readRequestJson(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        req.on('end', () => {
            const raw = Buffer.concat(chunks).toString('utf8').trim();
            if (!raw) {
                resolve({});
                return;
            }
            try {
                resolve(JSON.parse(raw));
            }
            catch (error) {
                reject(error);
            }
        });
        req.on('error', reject);
    });
}
async function handleRagApi(req, res) {
    const requestUrl = req.url || '/';
    const parsed = new URL(requestUrl, `http://${req.headers.host || 'localhost'}`);
    const pathname = stripBasePath(parsed.pathname);
    if (!pathname.startsWith('/api/rag')) {
        return false;
    }
    const user = requireRequestUser(req, res);
    if (!user)
        return true;
    const method = req.method || 'GET';
    const store = getRagStore();
    try {
        if (pathname === '/api/rag/knowledge-bases') {
            if (method === 'GET') {
                return sendJson(res, 200, { knowledgeBases: await store.listRagKnowledgeBases() }), true;
            }
            if (method === 'POST') {
                const body = await readRequestJson(req);
                const knowledgeBase = await store.createRagKnowledgeBase({ name: body?.name, description: body?.description });
                return sendJson(res, 200, { knowledgeBase }), true;
            }
            if (method === 'DELETE') {
                const id = parsed.searchParams.get('id') || '';
                if (!id)
                    return sendJson(res, 400, { error: '缺少知识库 ID' }), true;
                await store.deleteRagKnowledgeBase(id);
                return sendJson(res, 200, { success: true }), true;
            }
        }
        if (pathname === '/api/rag/detail' && method === 'GET') {
            const knowledgeBaseId = parsed.searchParams.get('knowledgeBaseId') || '';
            if (!knowledgeBaseId)
                return sendJson(res, 400, { error: '缺少知识库 ID' }), true;
            const limit = Number(parsed.searchParams.get('limit') || 80);
            const [documents, chunks, importJobs, stats, schema] = await Promise.all([
                store.listRagDocuments(knowledgeBaseId),
                store.listRagChunks(knowledgeBaseId, Number.isFinite(limit) ? limit : 80),
                store.listRagImportJobs(knowledgeBaseId),
                store.getRagDatabaseStats(knowledgeBaseId),
                store.getRagTableSchema(knowledgeBaseId),
            ]);
            return sendJson(res, 200, { documents, chunks, importJobs, stats, schema }), true;
        }
        if (pathname === '/api/rag/import' && method === 'POST') {
            const body = await readRequestJson(req);
            const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
            if (!knowledgeBaseId)
                return sendJson(res, 400, { error: '缺少知识库 ID' }), true;
            if (body?.mode === 'bundle') {
                const bundle = typeof body.bundle === 'string' ? JSON.parse(body.bundle) : body.bundle;
                const job = await store.importRagBundle({ knowledgeBaseId, bundle, userId: user.id });
                return sendJson(res, 200, { job }), true;
            }
            const job = await store.importRagText({
                knowledgeBaseId,
                title: body?.title,
                content: body?.content,
                sourceType: body?.sourceType,
                userId: user.id,
            });
            return sendJson(res, 200, { job }), true;
        }
        if (pathname === '/api/rag/search' && method === 'POST') {
            const body = await readRequestJson(req);
            const knowledgeBaseId = typeof body?.knowledgeBaseId === 'string' ? body.knowledgeBaseId : '';
            const query = typeof body?.query === 'string' ? body.query : '';
            if (!knowledgeBaseId)
                return sendJson(res, 400, { error: '缺少知识库 ID' }), true;
            if (!query.trim())
                return sendJson(res, 400, { error: '缺少搜索内容' }), true;
            const results = await store.searchRagKnowledgeBase({ knowledgeBaseId, query, topK: Number(body?.topK || 8), userId: user.id });
            return sendJson(res, 200, { results }), true;
        }
        if (pathname === '/api/rag/documents' && method === 'DELETE') {
            const knowledgeBaseId = parsed.searchParams.get('knowledgeBaseId') || '';
            const documentId = parsed.searchParams.get('documentId') || '';
            if (!knowledgeBaseId)
                return sendJson(res, 400, { error: '缺少知识库 ID' }), true;
            if (!documentId)
                return sendJson(res, 400, { error: '缺少来源 ID' }), true;
            await store.deleteRagDocument({ knowledgeBaseId, documentId });
            return sendJson(res, 200, { success: true }), true;
        }
        const parts = pathname.split('/').filter(Boolean);
        if (parts[0] === 'api' && parts[1] === 'rag' && parts[2] === 'v1' && parts[3] === 'collections') {
            if (parts.length === 4 && method === 'GET') {
                return sendJson(res, 200, { collections: await store.listRagKnowledgeBases() }), true;
            }
            const collectionId = parts[4] ? decodeURIComponent(parts[4]) : '';
            if (!collectionId)
                return sendJson(res, 400, { error: '缺少 RAG collection ID' }), true;
            if (parts[5] === 'schema' && method === 'GET') {
                const [schema, stats] = await Promise.all([
                    store.getRagTableSchema(collectionId),
                    store.getRagDatabaseStats(collectionId),
                ]);
                if (!schema)
                    return sendJson(res, 404, { error: 'RAG collection 不存在' }), true;
                return sendJson(res, 200, { schema, stats }), true;
            }
            if (parts[5] === 'rows') {
                if (method === 'GET') {
                    const page = Number(parsed.searchParams.get('page') || 0);
                    const pageSize = Number(parsed.searchParams.get('pageSize') || 50);
                    const documentId = parsed.searchParams.get('sourceId') || undefined;
                    const result = await store.listRagRowsPage({
                        knowledgeBaseId: collectionId,
                        page: Number.isFinite(page) ? page : 0,
                        pageSize: Number.isFinite(pageSize) ? pageSize : 50,
                        documentId,
                    });
                    return sendJson(res, 200, result), true;
                }
                if (method === 'DELETE') {
                    const body = await readRequestJson(req);
                    if (body?.all === true) {
                        await store.emptyRagKnowledgeBase(collectionId);
                        return sendJson(res, 200, { success: true }), true;
                    }
                    const rowIds = Array.isArray(body?.rowIds) ? body.rowIds.filter((item) => typeof item === 'string') : [];
                    await store.deleteRagRows({ knowledgeBaseId: collectionId, rowIds });
                    return sendJson(res, 200, { success: true }), true;
                }
            }
            if (parts[5] === 'search' && method === 'POST') {
                const body = await readRequestJson(req);
                const query = typeof body?.query === 'string' ? body.query : '';
                if (!query.trim())
                    return sendJson(res, 400, { error: '缺少搜索内容' }), true;
                const results = await store.searchRagKnowledgeBase({ knowledgeBaseId: collectionId, query, topK: Number(body?.topK || 8), userId: user.id });
                return sendJson(res, 200, { results }), true;
            }
            if (parts[5] === 'import' && method === 'POST') {
                const body = await readRequestJson(req);
                if (body?.sample === true || body?.mode === 'sample') {
                    const job = await store.importRagSampleKnowledgeBase({ knowledgeBaseId: collectionId, userId: user.id });
                    return sendJson(res, 200, { job }), true;
                }
                const bundle = body?.bundle || body;
                const job = await store.importRagBundle({ knowledgeBaseId: collectionId, bundle, userId: user.id });
                return sendJson(res, 200, { job }), true;
            }
            if (parts[5] === 'sources' && parts[6] && method === 'DELETE') {
                await store.deleteRagDocument({ knowledgeBaseId: collectionId, documentId: decodeURIComponent(parts[6]) });
                return sendJson(res, 200, { success: true }), true;
            }
        }
        sendJson(res, 404, { error: 'RAG API 不存在' });
        return true;
    }
    catch (error) {
        sendJson(res, 500, { error: error?.message || 'RAG API 请求失败' });
        return true;
    }
}
function getShareByToken(token) {
    if (!token)
        return null;
    const sharesFile = getWorkspaceDataFile('notebook-shares.json');
    const shares = readJson(sharesFile, []);
    if (!Array.isArray(shares))
        return null;
    return shares.find((item) => item && item.token === token) || null;
}
function getOrCreateDoc(roomId) {
    const existing = docs.get(roomId);
    if (existing)
        return existing;
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
        if (changed.length === 0)
            return;
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
    }
    catch { }
}
function resolveCollabRoom(searchParams) {
    const token = searchParams.get('authToken') || '';
    const auth = validateAuthToken(token);
    if (!auth)
        return { ok: false, reason: '未登录或登录已过期' };
    const user = getUserById(auth.userId);
    if (!user)
        return { ok: false, reason: '用户不存在' };
    const scope = searchParams.get('scope') === 'global' ? 'global' : 'personal';
    const filePath = String(searchParams.get('file') || '');
    const shareToken = String(searchParams.get('shareToken') || '');
    if (!filePath && !shareToken)
        return { ok: false, reason: '缺少 file 参数' };
    if (scope === 'global') {
        const globalRoot = getWorkspaceNotebookRoot();
        const share = shareToken ? getShareByToken(shareToken) : null;
        if (shareToken && (!share || share.scope !== 'global')) {
            return { ok: false, reason: '分享链接无效' };
        }
        const relPath = share?.path || filePath;
        if (!relPath)
            return { ok: false, reason: '缺少文件路径' };
        if (share && filePath && filePath !== share.path) {
            return { ok: false, reason: '文件路径与分享链接不一致' };
        }
        const absPath = safeResolve(globalRoot, relPath);
        if (!absPath)
            return { ok: false, reason: '路径不合法' };
        return { ok: true, roomId: `global:${absPath}`, user, filePath: relPath };
    }
    if (!user.personalDir)
        return { ok: false, reason: '用户未配置个人目录' };
    const personalRoot = path.resolve(user.personalDir, '.cangjie-notbook');
    const absPath = safeResolve(personalRoot, filePath);
    if (!absPath)
        return { ok: false, reason: '路径不合法' };
    return { ok: true, roomId: `personal:${user.id}:${absPath}`, user, filePath };
}
// ACEHarness: 内存看门狗。dev 模式下编译分片会随运行无界堆积在 require.cache 直至 OOM。
// 仅当受 daemon 监管(ACE_MANAGED=1)时才允许自重启(由守护进程拉起):
//   - 空闲(无在跑的 agent/流)且 heapUsed 超过软阈值 -> 优雅重启(用户基本无感);
//   - heapUsed 超过硬红线 -> 强制重启(避免不可控的 OOM 崩溃)。
// 非受管运行(如 npm run dev)只告警、不自杀。可用 ACE_MEM_WATCHDOG=0 关闭。
function startMemoryWatchdog() {
    if (process.env.ACE_MEM_WATCHDOG === '0')
        return;
    const v8 = require('v8');
    const heapLimit = v8.getHeapStatistics().heap_size_limit;
    if (!heapLimit || heapLimit < 1)
        return;
    const managed = process.env.ACE_MANAGED === '1';
    const softPct = Number(process.env.ACE_MEM_SOFT_PCT) || 0.80;
    const hardPct = Number(process.env.ACE_MEM_HARD_PCT) || 0.92;
    const soft = heapLimit * softPct;
    const hard = heapLimit * hardPct;
    const mb = (n) => Math.round(n / 1024 / 1024);
    let restarting = false;
    let warnedUnmanaged = false;
    const getActiveWork = () => {
        try {
            // process-manager 是挂在 globalThis 上的单例(与 Next 应用同进程共享)，
            // 直接读取，避免依赖 dist 构建。
            const pm = globalThis.__processManager;
            if (!pm)
                return 0; // 还没有任何 agent 进程被创建 = 空闲
            if (typeof pm.getActiveWorkCount !== 'function')
                return 1; // 单例存在但查不到 = 保守当作"忙"，绝不在不确定时打断任务
            return pm.getActiveWorkCount();
        }
        catch {
            return 1;
        }
    };
    const restart = (reason) => {
        if (restarting)
            return;
        restarting = true;
        console.error(`[ACEHarness] 内存看门狗触发重启(${reason}): heapUsed=${mb(process.memoryUsage().heapUsed)}MB / limit=${mb(heapLimit)}MB。受管进程将由守护进程自动拉起。`);
        setTimeout(() => process.exit(1), 1500); // 留点时间落日志/在途响应，再以非零码退出 -> supervisor 重启
    };
    const timer = setInterval(() => {
        if (restarting)
            return;
        const heapUsed = process.memoryUsage().heapUsed;
        if (heapUsed >= hard) {
            if (managed)
                restart('硬红线');
            else if (!warnedUnmanaged) {
                warnedUnmanaged = true;
                console.warn(`[ACEHarness] ⚠ 内存逼近上限(heapUsed=${mb(heapUsed)}MB / limit=${mb(heapLimit)}MB),且非受管模式不会自动重启,请尽快手动重启进程。`);
            }
            return;
        }
        if (managed && heapUsed >= soft && getActiveWork() === 0)
            restart('软阈值+空闲');
    }, 30000);
    timer.unref();
}
app.prepare().then(() => {
    const server = http.createServer(async (req, res) => {
        if (await handleRagApi(req, res)) {
            return;
        }
        handle(req, res);
    });
    server.requestTimeout = CHAT_REQUEST_TIMEOUT_MS;
    server.timeout = CHAT_REQUEST_TIMEOUT_MS;
    server.headersTimeout = CHAT_REQUEST_TIMEOUT_MS + 5000;
    server.keepAliveTimeout = CHAT_REQUEST_TIMEOUT_MS;
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
            encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, Array.from(states.keys())));
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
                    if (payload.length > 1)
                        ws.send(Buffer.from(payload));
                    return;
                }
                if (messageType === 1) {
                    const update = decoding.readVarUint8Array(decoder);
                    awarenessProtocol.applyAwarenessUpdate(room.awareness, update, ws);
                }
            }
            catch { }
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
        const parsedUpgradeUrl = new URL(requestUrl, `http://${request.headers.host || 'localhost'}`);
        if (!stripBasePath(parsedUpgradeUrl.pathname).startsWith('/api/notebook/collab')) {
            handleUpgrade(request, socket, head);
            return;
        }
        const resolved = resolveCollabRoom(parsedUpgradeUrl.searchParams);
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
        process.env.ACE_INTERNAL_BASE_URL = process.env.ACE_INTERNAL_BASE_URL || `http://${host}:${port}`;
        void restoreScheduler();
        startMemoryWatchdog();
    });
});
