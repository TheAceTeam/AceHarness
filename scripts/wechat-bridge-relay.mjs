#!/usr/bin/env node

import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const port = Number(process.env.PORT || 8787);
const aceWebhookUrl = String(process.env.CSIHARNESS_WEBHOOK_URL || '').trim();
const aceSecret = String(process.env.CSIHARNESS_SECRET || '').trim();
const logFile = resolve(process.env.BRIDGE_LOG_FILE || '.aceharness/wechat-bridge-relay.ndjson');

if (!aceWebhookUrl || !aceSecret) {
  console.error('Missing CSIHARNESS_WEBHOOK_URL or CSIHARNESS_SECRET.');
  console.error('Example: CSIHARNESS_WEBHOOK_URL=http://127.0.0.1:3000/api/channels/inbound/channel-xxx CSIHARNESS_SECRET=xxxx node scripts/wechat-bridge-relay.mjs');
  process.exit(1);
}

async function writeLog(entry) {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `${JSON.stringify({ ts: new Date().toISOString(), ...entry })}\n`, 'utf8');
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}

function normalizeIncoming(body) {
  if (body?.message?.conversationId && body?.message?.text) {
    return body;
  }
  return {
    message: {
      conversationId: String(body.conversationId || body.roomId || body.chatId || 'wechat-room'),
      conversationName: typeof body.conversationName === 'string' ? body.conversationName : undefined,
      userId: String(body.userId || body.senderId || 'wechat-user'),
      userName: typeof body.userName === 'string' ? body.userName : 'WeChat User',
      messageId: typeof body.messageId === 'string' ? body.messageId : undefined,
      text: String(body.text || ''),
      mentions: Array.isArray(body.mentions) ? body.mentions.filter((item) => typeof item === 'string') : [],
    },
    raw: body,
  };
}

async function forwardInbound(body) {
  const normalized = normalizeIncoming(body);
  const payload = {
    secret: aceSecret,
    ...normalized,
  };

  const response = await fetch(aceWebhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-ace-channel-secret': aceSecret,
    },
    body: JSON.stringify(payload),
  });
  const json = await response.json().catch(() => ({}));
  await writeLog({ direction: 'inbound', request: payload, response: json, status: response.status });
  console.log(`[inbound] ${payload.message.conversationId} <= ${payload.message.userName || payload.message.userId}: ${String(payload.message.text || '').slice(0, 120)}`);
  const printedReplies = Array.isArray(json?.replyMessages) && json.replyMessages.length
    ? json.replyMessages.map((item) => `${item.speakerName || item.kind}: ${String(item.text || '').slice(0, 120)}`)
    : Array.isArray(json?.replies)
      ? json.replies.map((item) => String(item).slice(0, 120))
      : [];
  for (const line of printedReplies) {
    console.log(`[reply] ${line}`);
  }
  return { status: response.status, body: json };
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/healthz') {
      return sendJson(res, 200, { ok: true, aceWebhookUrl, logFile });
    }

    if (req.method === 'GET' && req.url === '/logs') {
      const content = await readFile(logFile, 'utf8').catch(() => '');
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.end(content);
      return;
    }

    if (req.method === 'POST' && req.url === '/weixin/event') {
      const body = await readJson(req);
      const result = await forwardInbound(body);
      return sendJson(res, 200, result.body);
    }

    if (req.method === 'POST' && req.url === '/ace/outbound') {
      const body = await readJson(req);
      await writeLog({ direction: 'outbound', payload: body });
      const messages = Array.isArray(body?.messages) ? body.messages : [];
      console.log(`[outbound] ${body?.conversationId || 'unknown-conversation'} -> ${messages.length || 1} message(s)`);
      if (messages.length) {
        for (const item of messages) {
          console.log(`[outbound:${item.speakerName || item.kind}] ${String(item.text || '').slice(0, 120)}`);
        }
      } else if (body?.text) {
        console.log(`[outbound:text] ${String(body.text).slice(0, 120)}`);
      }
      return sendJson(res, 200, {
        ok: true,
        accepted: true,
        note: 'Outbound payload stored in relay log. Connect this endpoint to your ClawBot/Hermes sender implementation.',
      });
    }

    return sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    await writeLog({ direction: 'error', error: error instanceof Error ? error.message : String(error) });
    return sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, () => {
  console.log(`wechat-bridge-relay listening on http://127.0.0.1:${port}`);
  console.log(`forwarding inbound messages to ${aceWebhookUrl}`);
  console.log(`relay log: ${logFile}`);
});
