const { getWeChatOfficialAccount } = require('../src/lib/wechat-official-store');
const { runWeChatOfficialBridge, runWeChatOfficialQrLogin } = require('../src/lib/wechat-official-client');

function getArg(name: string): string {
  const index = process.argv.findIndex((item: string) => item === `--${name}`);
  if (index >= 0) return process.argv[index + 1] || '';
  return '';
}

async function printQr(qrcodeUrl: string) {
  console.log('\n请使用微信扫描以下二维码：');
  console.log(qrcodeUrl);
  console.log('');
  try {
    const mod = require('qrcode-terminal');
    mod.generate(qrcodeUrl, { small: true });
  } catch {
    // optional dependency
  }
}

async function loginCommand() {
  const result = await runWeChatOfficialQrLogin({
    onQr: async ({ qrcodeUrl }: { qrcodeUrl: string }) => {
      await printQr(qrcodeUrl);
    },
    onStatus: async (status: string) => {
      if (status === 'scaned') {
        console.log('已扫码，请在微信中确认...');
      } else if (status === 'wait') {
        process.stdout.write('.');
      } else if (status === 'expired') {
        console.log('\n二维码已过期，正在刷新...');
      }
    },
  });
  console.log(`\n微信连接成功：account_id=${result.accountId}`);
  console.log(JSON.stringify(result, null, 2));
}

async function bridgeCommand() {
  const accountId = getArg('account') || process.env.WECHAT_ACCOUNT_ID || '';
  const webhookUrl = getArg('webhook') || process.env.ACE_WEBHOOK_URL || '';
  const secret = getArg('secret') || process.env.ACE_SECRET || '';
  const integrationId = getArg('integration') || process.env.ACE_INTEGRATION_ID || '';

  if (!accountId || !webhookUrl || !secret || !integrationId) {
    throw new Error('Missing required args. Need --account, --webhook, --secret, --integration.');
  }

  const account = await getWeChatOfficialAccount(accountId);
  if (!account) {
    throw new Error(`WeChat account not found in local store: ${accountId}`);
  }

  console.log(`[wechat-official] bridge start: account=${accountId} integration=${integrationId}`);
  console.log(`[wechat-official] forwarding inbound to ${webhookUrl}`);

  await runWeChatOfficialBridge({
    integrationId,
    webhookUrl,
    secret,
    account,
    onEvent(event: string, payload?: Record<string, any>) {
      if (event === 'inbound') {
        console.log(`[inbound] ${payload?.conversationId} <= ${payload?.userId}: ${String(payload?.text || '').slice(0, 120)}`);
      } else if (event === 'outbound') {
        console.log(`[outbound] -> ${payload?.to}: ${String(payload?.text || '').slice(0, 120)}`);
      } else if (event.endsWith('error')) {
        console.log(`[${event}] ${payload?.error || 'unknown error'}`);
      }
    },
  });
}

async function main() {
  const command = process.argv[2] || 'help';
  if (command === 'login') {
    await loginCommand();
    return;
  }
  if (command === 'bridge') {
    await bridgeCommand();
    return;
  }

  console.log('Usage:');
  console.log('  npm run wechat:official -- login');
  console.log('  npm run wechat:official -- bridge --account <accountId> --integration <id> --webhook <url> --secret <secret>');
}

main().catch((error: any) => {
  console.error(`[wechat-official] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
