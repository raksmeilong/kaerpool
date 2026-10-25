'use strict';

const http = require('node:http');
const { URL } = require('node:url');

/**
 * OpenAI-compatible shim over the Kaer pool.
 *
 * Rotates accounts round-robin, cools down failures exponentially and exposes
 * GET /v1/models plus POST /v1/chat/completions (stream and non-stream).
 */
class Pool {
  constructor(accounts, cfg) {
    this.cfg = cfg;
    this.accounts = accounts.map((a, i) => ({
      ...a,
      idx: i,
      cooldownUntil: 0,
      fails: 0,
      noCredit: a.status === 'no-credit' || Number(a.creditUsd ?? 1) <= 0,
    }));
    this.cursor = 0;
  }

  healthy() {
    const now = Date.now();
    return this.accounts.filter((a) => a.status === 'active' && !a.noCredit && a.cooldownUntil <= now);
  }

  markNoCredit(acc) {
    acc.noCredit = true;
    acc.cooldownUntil = Date.now() + 86400000;
  }

  pick() {
    const pool = this.healthy();
    if (!pool.length) return null;
    const acc = pool[this.cursor % pool.length];
    this.cursor = (this.cursor + 1) % Math.max(pool.length, 1);
    return acc;
  }

  markOk(acc) {
    acc.fails = 0;
    acc.cooldownUntil = 0;
    acc.lastUsedAt = new Date().toISOString();
  }

  markFail(acc) {
    acc.fails += 1;
    const wait = Math.min(300000, 5000 * 2 ** (acc.fails - 1));
    acc.cooldownUntil = Date.now() + wait;
    acc.lastError = new Date().toISOString();
  }

  async chat(body) {
    const maxTries = Math.min(this.accounts.length, 3);
    for (let i = 0; i < maxTries; i += 1) {
      const acc = this.pick();
      if (!acc) break;
      try {
        const res = await fetch(`${this.cfg.apiBase}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${acc.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(this.cfg.chatTimeout),
        });
        if (res.status === 402) {
          this.markNoCredit(acc);
          continue;
        }
        if (res.status === 429 || res.status >= 500) {
          this.markFail(acc);
          continue;
        }
        if (!res.ok) {
          const text = await res.text();
          return { error: { status: res.status, body: text }, account: acc };
        }
        this.markOk(acc);
        return { response: res, account: acc, streaming: Boolean(body.stream) };
      } catch (err) {
        this.markFail(acc);
      }
    }
    return { error: { status: 503, body: '{"error":{"message":"no healthy account"}}' } };
  }
}

const json = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  res.end(body);
};

function createAdapter(cfg) {
  const adapter = {
    server: null,
    pool: null,

    async start(accounts) {
      adapter.pool = new Pool(accounts || [], cfg);
      adapter.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://x');
        const key = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (cfg.adapterToken && key !== cfg.adapterToken) return json(res, 401, { error: { message: 'invalid adapter token' } });

        if (url.pathname === '/health') {
          return json(res, 200, { ok: true, accounts: adapter.pool.accounts.length, healthy: adapter.pool.healthy().length });
        }

        if (url.pathname === '/v1/models' && req.method === 'GET') {
          const ids = new Set();
          for (const a of adapter.pool.accounts) (a.models || []).forEach((m) => ids.add(m));
          if (!ids.size) ids.add(cfg.defaultModel);
          return json(res, 200, {
            object: 'list',
            data: [...ids].map((id) => ({ id: `${cfg.prefix}/${id}`, object: 'model', owned_by: cfg.prefix })),
          });
        }

        if (url.pathname === '/v1/chat/completions' && req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) raw += chunk;
          let body;
          try {
            body = JSON.parse(raw);
          } catch {
            return json(res, 400, { error: { message: 'invalid JSON body' } });
          }
          body.model = String(body.model || '').replace(new RegExp(`^${cfg.prefix}/`), '');
          const out = await adapter.pool.chat(body);
          if (out.error) return json(res, out.error.status, safeJson(out.error.body));
          const { response } = out;
          res.writeHead(response.status, {
            'content-type': response.headers.get('content-type') || 'application/json',
            'x-kaer-account': out.account.email,
          });
          if (out.streaming && response.body) {
            for await (const chunk of response.body) res.write(chunk);
            return res.end();
          }
          res.end(await response.text());
          return undefined;
        }

        return json(res, 404, { error: { message: `no route ${req.method} ${url.pathname}` } });
      });

      await new Promise((resolve) => adapter.server.listen(cfg.adapterPort, cfg.adapterHost, resolve));
      return adapter;
    },

    listenUrl() {
      return `http://${cfg.adapterHost}:${cfg.adapterPort}/v1`;
    },

    async stop() {
      if (adapter.server) await new Promise((r) => adapter.server.close(r));
    },
  };
  return adapter;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return { error: { message: String(text).slice(0, 400) } };
  }
}

module.exports = { createAdapter, Pool };
