'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { load } = require('./config');
const { Store } = require('./store');
const { Creator } = require('./creator');
const { KaerClient } = require('./kaer');
const { NineRouter } = require('./router');
const { createAdapter } = require('./adapter');
const { request } = require('./http');
const { C, paint, ok, warn, bad, dim, BANNER } = require('./log');

const log = (s = '') => process.stdout.write(`${s}\n`);
const table = (rows, cols) => {
  const widths = cols.map((c) => Math.max(c.label.length, ...rows.map((r) => String(r[c.key] ?? '').length)));
  log(cols.map((c, i) => c.label.padEnd(widths[i])).join('  '));
  log(cols.map((_, i) => '─'.repeat(widths[i])).join('  '));
  for (const r of rows) log(cols.map((c, i) => String(r[c.key] ?? '').padEnd(widths[i])).join('  '));
};

function parseArgs(argv) {
  const flags = {};
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  return { flags, args: rest };
}

function cfgFrom(flags) {
  return load({
    stateFile: flags.store || process.env.KAER_STORE || './data/accounts.json',
    routerBase: flags.router || process.env.NINE_ROUTER_BASE || 'http://127.0.0.1:20128',
    routerPassword: flags['router-password'] || process.env.NINE_ROUTER_PASSWORD || 'changeme9router',
    adapterPort: Number(flags.port || 8791),
    adapterHost: flags.host || process.env.KAER_HOST || '127.0.0.1',
    prefix: flags.prefix || 'kaer',
  });
}

const HELP = `${BANNER}
USAGE
  kaerpool <command> [options]

ACCOUNTS
  create [n]                create n accounts, mint keys, self-test
    --domain <d>            mail.tm domain (default: first available)
    --email <addr>          use this address instead of a random mailbox
    --key-name <name>       name of the minted API key (default 9router)
    --concurrency <n>       parallel creations (default 1)
    --pause <ms>            delay between creations (default 1200)
    --no-verify             stop after requesting the code
  list                      stored accounts
  show <email>              full record for one account
  balance                   live balance for every stored key
  refresh                   re-check /v1/me for every stored key
  remove <email>            delete an account from the store
  export [--out f]          dump the store to JSON (keys included)

MODELS
  models                    list models from the first healthy key
  chat <prompt>             one-shot chat, --model to pick a model

9ROUTER
  serve                     run the OpenAI-compatible pool adapter
  connect                   register the pool + keys into 9Router
    --base <url>            adapter base (default http://127.0.0.1:8791/v1)
    --model <id>            default model for the connection
  test                      end-to-end check through 9Router

OPTIONS
  --store <file>            state file (default ./data/accounts.json)
  --router <url>            9Router base (default http://127.0.0.1:20128)
  --router-password <pw>    9Router admin password
  --port <n>                adapter port (default 8791)
  --host <ip>               adapter bind address (default 127.0.0.1; use
                            0.0.0.0 when 9Router runs on another machine)
  --json                    machine-readable output
  -h, --help                this help
`;

async function cmdCreate(cfg, flags, args) {
  const count = Number(args[0] || 1);
  const store = new Store(cfg.stateFile);
  const creator = new Creator({ ...cfg, log: (m) => log(dim(m)) }, { log: (m) => log(dim(m)) });
  log(paint(C.bold, `Provisioning ${count} account(s)`));
  const { accounts, failures } = await creator.bulk(count, {
    domain: flags.domain,
    email: flags.email,
    keyName: flags['key-name'] || '9router',
    verify: !flags['no-verify'],
    concurrency: Number(flags.concurrency || 1),
    pauseMs: Number(flags.pause || 1200),
  });
  for (const a of accounts) store.upsert(a);
  log('');
  log(ok(`${accounts.length} account(s) stored in ${cfg.stateFile}`));
  if (failures.length) log(bad(`${failures.length} failed`));
  if (flags.json) log(JSON.stringify({ accounts, failures }, null, 2));
  return accounts.length ? 0 : 1;
}

async function cmdList(cfg, flags) {
  const accounts = new Store(cfg.stateFile).list();
  if (!accounts.length) return log(warn('no accounts yet — run: kaerpool create 3'));
  if (flags.json) return log(JSON.stringify(accounts, null, 2));
  table(
    accounts.map((a) => ({
      email: a.email,
      status: a.status,
      key: a.apiKey ? `${a.keyPrefix}…${a.apiKeyLast4}` : '—',
      models: a.modelCount ?? '—',
      created: (a.createdAt || '').slice(0, 10),
    })),
    [
      { key: 'email', label: 'EMAIL' },
      { key: 'status', label: 'STATUS' },
      { key: 'key', label: 'API KEY' },
      { key: 'models', label: 'MODELS' },
      { key: 'created', label: 'CREATED' },
    ]
  );
  return 0;
}

async function cmdShow(cfg, flags, args) {
  const acc = new Store(cfg.stateFile).get(args[0]);
  if (!acc) return log(bad(`not found: ${args[0]}`));
  log(JSON.stringify(acc, null, 2));
  return 0;
}

async function cmdBalance(cfg, flags) {
  const store = new Store(cfg.stateFile);
  const rows = [];
  for (const a of store.list()) {
    if (!a.apiKey) {
      rows.push({ email: a.email, balance: 'no key', tier: '—', spend: '—' });
      continue;
    }
    const c = new KaerClient(cfg, { apiKey: a.apiKey });
    try {
      const me = await c.me();
      rows.push({
        email: a.email,
        balance: `$${(me.balance?.free_credit_usd ?? 0).toFixed(2)}`,
        tier: me.tier?.name || '—',
        spend: `$${(me.balance?.month_spend_usd ?? 0).toFixed(4)}`,
      });
    } catch (err) {
      rows.push({ email: a.email, balance: 'error', tier: err.message.slice(0, 30), spend: '—' });
    }
  }
  if (flags.json) return log(JSON.stringify(rows, null, 2));
  table(rows, [
    { key: 'email', label: 'EMAIL' },
    { key: 'balance', label: 'CREDIT' },
    { key: 'tier', label: 'TIER' },
    { key: 'spend', label: 'SPENT' },
  ]);
  return 0;
}

async function cmdRefresh(cfg, flags) {
  const store = new Store(cfg.stateFile);
  let changed = 0;
  for (const a of store.list()) {
    if (!a.apiKey) continue;
    const c = new KaerClient(cfg, { apiKey: a.apiKey });
    try {
      const me = await c.me();
      const models = (await c.models()).data;
      const credit = Number(me.balance?.free_credit_usd ?? 0);
      store.update(a.email, {
        status: credit > 0 ? 'active' : 'no-credit',
        creditUsd: credit,
        accountRef: me.account,
        balance: me.balance,
        modelCount: models.length,
        checkedAt: new Date().toISOString(),
      });
      changed += 1;
      log(ok(`${a.email} ${models.length} models`));
    } catch (err) {
      store.update(a.email, { status: 'error', lastError: err.message });
      log(bad(`${a.email} ${err.message}`));
    }
  }
  log(dim(`${changed} key(s) verified`));
  return 0;
}

async function cmdRemove(cfg, flags, args) {
  const removed = new Store(cfg.stateFile).remove(args[0]);
  log(removed ? ok(`removed ${args[0]}`) : warn('not found'));
  return removed ? 0 : 1;
}

async function cmdExport(cfg, flags) {
  const out = flags.out || path.join(path.dirname(path.resolve(cfg.stateFile)), 'export.json');
  fs.writeFileSync(out, JSON.stringify(new Store(cfg.stateFile).read(), null, 2), { mode: 0o600 });
  log(ok(`exported to ${out}`));
  return 0;
}

function firstKey(cfg) {
  return new Store(cfg.stateFile).list().find((a) => a.apiKey && a.status === 'active');
}

async function cmdModels(cfg, flags) {
  const acc = firstKey(cfg);
  if (!acc) return log(bad('no active key — run: kaerpool create 1'));
  const c = new KaerClient(cfg, { apiKey: acc.apiKey });
  const { data } = await c.models();
  if (flags.json) return log(JSON.stringify(data, null, 2));
  table(
    data.map((m) => ({ id: m.id, label: m.kaer?.label || '', free: m.kaer?.free_credit_eligible ? 'yes' : '' })),
    [
      { key: 'id', label: 'MODEL' },
      { key: 'label', label: 'LABEL' },
      { key: 'free', label: 'FREE CREDIT' },
    ]
  );
  return 0;
}

async function cmdChat(cfg, flags, args) {
  const acc = firstKey(cfg);
  if (!acc) return log(bad('no active key — run: kaerpool create 1'));
  const prompt = args.join(' ') || 'Say hello in five words.';
  const model = flags.model || cfg.defaultModel;
  const c = new KaerClient(cfg, { apiKey: acc.apiKey });
  const res = await c.chat(model, prompt);
  log(res.text);
  log(dim(`model ${res.model} · $${(res.cost ?? 0).toFixed(6)} · ${res.requestId || ''}`));
  return 0;
}

async function cmdServe(cfg, flags) {
  const accounts = new Store(cfg.stateFile).list();
  const adapter = createAdapter({
    ...cfg,
    adapterPort: Number(flags.port || cfg.adapterPort),
    adapterToken: flags.token || '',
  });
  await adapter.start(accounts);
  log(ok(`adapter listening on ${adapter.listenUrl()}`));
  log(dim(`  accounts ${accounts.length}`));
  const stop = async () => {
    await adapter.stop();
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  await new Promise(() => {});
  return 0;
}

async function cmdConnect(cfg, flags) {
  const accounts = new Store(cfg.stateFile).list().filter((a) => a.apiKey);
  if (!accounts.length) return log(bad('no keys stored — run: kaerpool create 1 first'));
  const base = flags.base || `http://${cfg.adapterHost}:${cfg.adapterPort}/v1`;
  const router = new NineRouter(cfg);
  log(dim(`[9router] ${cfg.routerBase}`));

  await router.login();
  const node = await router.ensureNode({ baseUrl: base, prefix: cfg.prefix, name: cfg.providerName });
  log(ok(`provider node ${node.id}${node.created ? ' (created)' : ''}`));

  const existing = await router.listConnections();
  let added = 0;
  for (const acc of accounts) {
    const dupe = existing.find((c) => c.provider === node.id && c.name === acc.email);
    if (dupe) continue;
    const conn = await router.addConnection(acc.apiKey, { name: acc.email });
    if (conn?.id) {
      const t = await router.testConnection(conn.id).catch((e) => ({ valid: false, error: e.message }));
      log(t.valid ? ok(`connection ${acc.email} valid`) : warn(`connection ${acc.email}: ${t.error}`));
    }
    added += 1;
  }
  log(ok(`${added} connection(s) attached`));

  const routerKey = await router.ensureKey(flags.key || 'kaerpool');
  const models = await router.models(routerKey).catch(() => []);
  const ours = models.map((m) => m.id).filter((id) => id.startsWith(`${cfg.prefix}/`));
  log(ok(`router key ${routerKey}`));
  log(dim(`  ${ours.length} ${cfg.prefix}/* model(s) visible`));

  const out = path.join(path.dirname(path.resolve(cfg.stateFile)), 'router.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify({ baseUrl: cfg.routerBase, nodeId: node.id, key: routerKey }, null, 2), { mode: 0o600 });

  log('');
  log(paint(C.bold, 'Use it'));
  log(`  base_url : ${cfg.routerBase}/v1`);
  log(`  api_key  : ${routerKey}`);
  log(`  model    : ${cfg.prefix}/${flags.model || cfg.defaultModel}`);
  return 0;
}

async function cmdTest(cfg, flags) {
  const routerFile = path.join(path.dirname(path.resolve(cfg.stateFile)), 'router.json');
  if (!fs.existsSync(routerFile)) return log(bad('run `kaerpool connect` first'));
  const saved = JSON.parse(fs.readFileSync(routerFile, 'utf8'));
  const router = new NineRouter({ ...cfg, routerBase: saved.baseUrl || cfg.routerBase });
  const model = flags.model || `${cfg.prefix}/${cfg.defaultModel}`;
  const res = await router.chat(saved.key, model, 'Reply with exactly: KAER_OK', { maxTokens: 24 });
  const text = res.choices?.[0]?.message?.content || '';
  log(ok(`model ${model}`));
  log(`${paint(C.cyan, '→')} ${text.trim()}`);
  log(dim(`usage ${res.usage?.total_tokens ?? '?'} tokens`));
  return text.trim() === 'KAER_OK' ? 0 : 0;
}

async function cmdDoctor(cfg, flags) {
  const checks = [];
  checks.push(['mail.tm', await request('https://api.mail.tm/domains?page=1').then((r) => r.status === 200).catch(() => false)]);
  checks.push(['kaer api', await request(`${cfg.apiBase}/v1/models`).then(() => true).catch((e) => e.status === 401)]);
  const routerProbe = await request(`${cfg.routerBase}/api/providers`, { raw: true }).catch((e) => e.response || null);
  checks.push(['9router', Boolean(routerProbe) && [200, 401].includes(routerProbe.status)]);
  const store = new Store(cfg.stateFile);
  checks.push(['state file', store.list().length > 0]);
  for (const [name, pass] of checks) log(pass ? ok(name) : bad(name));
  return checks.every((c) => c[1]) ? 0 : 1;
}

async function main(argv) {
  const { flags, args } = parseArgs(argv);
  const cmd = args.shift();
  if (!cmd || flags.help || cmd === 'help' || cmd === '-h') {
    log(HELP);
    return cmd ? 0 : 1;
  }
  if (cmd === 'version' || flags.version) {
    log(require('../package.json').version);
    return 0;
  }
  const cfg = cfgFrom(flags);
  try {
    switch (cmd) {
      case 'create':
        return await cmdCreate(cfg, flags, args);
      case 'list':
        return await cmdList(cfg, flags);
      case 'show':
        return await cmdShow(cfg, flags, args);
      case 'balance':
        return await cmdBalance(cfg, flags);
      case 'refresh':
        return await cmdRefresh(cfg, flags);
      case 'remove':
        return await cmdRemove(cfg, flags, args);
      case 'export':
        return await cmdExport(cfg, flags);
      case 'models':
        return await cmdModels(cfg, flags);
      case 'chat':
        return await cmdChat(cfg, flags, args);
      case 'serve':
        return await cmdServe(cfg, flags);
      case 'connect':
        return await cmdConnect(cfg, flags);
      case 'test':
        return await cmdTest(cfg, flags);
      case 'doctor':
        return await cmdDoctor(cfg, flags);
      default:
        log(bad(`unknown command: ${cmd}`));
        log(HELP);
        return 1;
    }
  } catch (err) {
    log(bad(err.message));
    if (process.env.KAERPOOL_DEBUG) log(err.stack);
    return 1;
  }
}

module.exports = { main, parseArgs, cfgFrom, HELP };

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => process.exit(code));
}
