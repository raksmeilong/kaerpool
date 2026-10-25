'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { parseArgs, cfgFrom } = require('../src/cli');
const { Store } = require('../src/store');
const { Pool, createAdapter } = require('../src/adapter');
const { load } = require('../src/config');

const results = [];
const test = (name, fn) => {
  try {
    fn();
    results.push(['✔', name]);
  } catch (err) {
    results.push(['✖', `${name} — ${err.message}`]);
    process.exitCode = 1;
  }
};

test('parseArgs separates flags from positionals', () => {
  const { flags, args } = parseArgs(['create', '5', '--domain', 'x.test', '--json']);
  assert.deepStrictEqual(args, ['create', '5']);
  assert.strictEqual(flags.domain, 'x.test');
  assert.strictEqual(flags.json, true);
});

test('cfgFrom honours overrides', () => {
  const cfg = cfgFrom({ router: 'http://r:1', port: '9999', prefix: 'kb' });
  assert.strictEqual(cfg.routerBase, 'http://r:1');
  assert.strictEqual(cfg.adapterPort, 9999);
  assert.strictEqual(cfg.prefix, 'kb');
});

test('store round-trips and upserts by email', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'kaerpool-')), 'a.json');
  const s = new Store(file);
  s.upsert({ email: 'a@b.c', status: 'active' });
  s.upsert({ email: 'a@b.c', status: 'no-credit' });
  assert.strictEqual(s.list().length, 1);
  assert.strictEqual(s.get('A@B.C').status, 'no-credit');
  assert.strictEqual((fs.statSync(file).mode & 0o777).toString(8), '600');
  assert.ok(s.remove('a@b.c'));
});

test('pool skips zero-credit accounts', () => {
  const pool = new Pool(
    [
      { email: 'rich@x', apiKey: 'k1', status: 'active', creditUsd: 10 },
      { email: 'broke@x', apiKey: 'k2', status: 'active', creditUsd: 0 },
    ],
    load()
  );
  assert.strictEqual(pool.healthy().length, 1);
  assert.strictEqual(pool.pick().email, 'rich@x');
});

test('pool failover backs off exponentially', () => {
  const pool = new Pool([{ email: 'a@x', apiKey: 'k', status: 'active', creditUsd: 1 }], load());
  const acc = pool.accounts[0];
  pool.markFail(acc);
  assert.ok(acc.cooldownUntil > Date.now());
  pool.markOk(acc);
  assert.strictEqual(pool.healthy().length, 1);
});

test('pool marks 402 accounts out for a day', () => {
  const pool = new Pool([{ email: 'a@x', apiKey: 'k', status: 'active', creditUsd: 1 }], load());
  pool.markNoCredit(pool.accounts[0]);
  assert.strictEqual(pool.healthy().length, 0);
});

test('adapter exposes health and model routes', async () => {
  const cfg = { ...load(), adapterPort: 0, adapterHost: '127.0.0.1', prefix: 'kaer', defaultModel: 'janus-1-flash' };
  const adapter = createAdapter(cfg);
  await adapter.start([{ email: 'a@x', apiKey: 'k', status: 'active', creditUsd: 1, models: ['janus-1-flash'] }]);
  const port = adapter.server.address().port;
  const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
  assert.strictEqual(health.ok, true);
  const models = await fetch(`http://127.0.0.1:${port}/v1/models`).then((r) => r.json());
  assert.strictEqual(models.data[0].id, 'kaer/janus-1-flash');
  await adapter.stop();
});

(async () => {
  for (const [mark, name] of results) console.log(`${mark} ${name}`);
})();
