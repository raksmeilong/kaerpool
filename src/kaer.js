'use strict';

const crypto = require('node:crypto');
const { request, cookiesFrom, retry } = require('./http');

/**
 * Kaer API client (api.kaer.ai).
 *
 * Auth is passwordless and cookie based:
 *   POST /api/apiplat/auth/code    { email }            -> 6-digit code by email
 *   POST /api/apiplat/auth/verify  { email, code, agreed } -> Set-Cookie session
 *   POST /api/apiplat/keys         { name, scopes }     -> kaer_live_... (shown once)
 *   GET  /api/apiplat/keys                              -> key list
 *
 * Then the OpenAI-compatible surface at /v1 with `Authorization: Bearer kaer_live_...`.
 */
class KaerClient {
  constructor(cfg, state = {}) {
    this.cfg = cfg;
    this.state = { ...state };
    this.log = cfg.log || (() => {});
  }

  get base() {
    return this.cfg.apiBase.replace(/\/$/, '');
  }

  cookieHeader() {
    return Object.entries(this.state.cookies || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  headers(extra = {}) {
    return {
      accept: 'application/json',
      'content-type': 'application/json',
      origin: this.base,
      referer: `${this.base}/login?mode=signup`,
      ...(this.state.cookies ? { cookie: this.cookieHeader() } : {}),
      ...extra,
    };
  }

  /** Step 1 — ask for a sign-in code. */
  async requestCode(email) {
    const res = await request(`${this.base}/api/apiplat/auth/code`, {
      method: 'POST',
      headers: this.headers(),
      body: { email },
      timeout: 25000,
    });
    this.state.email = email;
    return res.json;
  }

  /** Step 2 — exchange the code for a session cookie (creates the account on first use). */
  async verifyCode(email, code, agreed = true) {
    const res = await request(`${this.base}/api/apiplat/auth/verify`, {
      method: 'POST',
      headers: this.headers(),
      body: { email, code: String(code).replace(/\D/g, ''), agreed },
      timeout: 25000,
    });
    const jar = cookiesFrom(res);
    if (!Object.keys(jar).length) throw new Error('verify returned no session cookie');
    this.state.cookies = { ...(this.state.cookies || {}), ...jar };
    this.state.email = email;
    this.state.verifiedAt = new Date().toISOString();
    return res.json;
  }

  async session() {
    const res = await request(`${this.base}/api/apiplat/account`, {
      headers: this.headers(),
      raw: true,
    });
    if (res.status >= 400) throw new Error(`session invalid (${res.status})`);
    return res.json;
  }

  async listKeys() {
    const res = await request(`${this.base}/api/apiplat/keys`, { headers: this.headers(), raw: true });
    if (res.status >= 400) throw new Error(`keys list failed (${res.status})`);
    return res.json;
  }

  /** Step 3 — mint the API key that 9Router will use. Shown once, stored encrypted at rest. */
  async createKey(name = '9router') {
    const res = await request(`${this.base}/api/apiplat/keys`, {
      method: 'POST',
      headers: this.headers(),
      body: { name, scopes: ['models'] },
      timeout: 25000,
    });
    const body = res.json || {};
    const key = body.secret || body.apiKey || body.data?.secret;
    if (!key || !/^kaer_(live|sk)_/.test(key)) {
      throw new Error(`key not returned: ${JSON.stringify(body).slice(0, 180)}`);
    }
    this.state.apiKey = key;
    this.state.keyName = name;
    this.state.keyPrefix = key.slice(0, 12);
    return key;
  }

  async me() {
    const res = await request(`${this.base}/v1/me`, {
      headers: { authorization: `Bearer ${this.state.apiKey}` },
      raw: true,
    });
    if (res.status >= 400) {
      const e = new Error(res.json?.error?.message || `me failed (${res.status})`);
      e.status = res.status;
      throw e;
    }
    return res.json;
  }

  async models() {
    const res = await request(`${this.base}/v1/models`, {
      headers: { authorization: `Bearer ${this.state.apiKey}` },
      raw: true,
    });
    return { status: res.status, data: res.json?.data || [] };
  }

  /** One chat turn through Kaer's OpenAI-compatible endpoint. */
  async chat(model, prompt, { maxTokens = 64 } = {}) {
    const res = await retry(
      async () => {
        const r = await request(`${this.base}/v1/chat/completions`, {
          method: 'POST',
          headers: { authorization: `Bearer ${this.state.apiKey}` },
          body: { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens },
          timeout: this.cfg.chatTimeout,
          raw: true,
        });
        if (r.status >= 400) {
          const e = new Error(r.json?.error?.message || `HTTP ${r.status}`);
          e.status = r.status;
          throw e;
        }
        return r.json;
      },
      { attempts: this.cfg.maxAttempts, log: this.log }
    );
    return {
      text: res.choices?.[0]?.message?.content || '',
      model: res.model,
      usage: res.usage || null,
      cost: res.kaer?.cost_usd ?? null,
      requestId: res.kaer?.request_id || null,
    };
  }

  static mailbox(domain) {
    const tag = crypto.randomBytes(5).toString('hex');
    return { address: `kaer${tag}@${domain}`, password: `Kp!${crypto.randomBytes(9).toString('base64url')}` };
  }
}

module.exports = { KaerClient };
