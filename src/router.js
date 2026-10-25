'use strict';

const { request } = require('./http');

/**
 * 9Router bridge.
 *
 *   POST /api/auth/login        {password} -> session cookie
 *   POST /api/provider-nodes    create an openai-compatible provider node
 *   POST /api/providers         attach a connection (API key) to that node
 *   POST /api/keys              mint the client key your tools use on /v1
 *
 * Works against a self-hosted instance (default http://127.0.0.1:20128) or any
 * 9Router deployment you can reach.
 */
class NineRouter {
  constructor(cfg) {
    this.cfg = cfg;
    this.base = String(cfg.routerBase).replace(/\/$/, '');
    this.cookie = null;
    this.nodeId = null;
  }

  async login(password = this.cfg.routerPassword) {
    const res = await request(`${this.base}/api/auth/login`, {
      method: 'POST',
      body: { password },
      timeout: 20000,
    });
    const setCookie = res.headers['set-cookie'] || [];
    const pairs = [].concat(setCookie).filter(Boolean).map((c) => c.split(';')[0]);
    if (!pairs.length) throw new Error('9Router login returned no session cookie');
    this.cookie = pairs.join('; ');
    return res.json;
  }

  async api(path, { method = 'GET', body } = {}) {
    if (!this.cookie) await this.login();
    const res = await request(`${this.base}${path}`, {
      method,
      headers: { cookie: this.cookie, accept: 'application/json' },
      body,
      timeout: 25000,
      raw: true,
    });
    if (res.status >= 400) throw new Error(`${method} ${path} -> ${res.status} ${res.text.slice(0, 160)}`);
    return res.json ?? res.text;
  }

  async ensureNode({ prefix = this.cfg.prefix, baseUrl, name = this.cfg.providerName } = {}) {
    const target = String(baseUrl).replace(/\/$/, '');
    const nodes = (await this.api('/api/provider-nodes')).nodes || [];
    const existing = nodes.find((n) => n.prefix === prefix && n.type === 'openai-compatible');
    if (existing) {
      if (String(existing.baseUrl).replace(/\/$/, '') !== target) {
        await this.api(`/api/provider-nodes/${existing.id}`, { method: 'PUT', body: { name, prefix, baseUrl: target, type: 'openai-compatible', apiType: 'chat' } });
      }
      this.nodeId = existing.id;
      return { id: existing.id, created: false };
    }
    const created = await this.api('/api/provider-nodes', {
      method: 'POST',
      body: { type: 'openai-compatible', prefix, name, baseUrl: target, apiType: 'chat' },
    });
    this.nodeId = created.node?.id || created.id;
    if (!this.nodeId) throw new Error(`unexpected node response: ${JSON.stringify(created).slice(0, 160)}`);
    return { id: this.nodeId, created: true };
  }

  async addConnection(apiKey, { name = this.cfg.providerName } = {}) {
    const body = { provider: this.nodeId, apiKey, name, priority: 1, allowOverwrite: true };
    const out = await this.api('/api/providers', { method: 'POST', body });
    return out.connection || out;
  }

  async listConnections() {
    return (await this.api('/api/providers')).connections || [];
  }

  async testConnection(id) {
    return this.api(`/api/providers/${id}/test`, { method: 'POST' });
  }

  async ensureKey(name = 'kaerpool') {
    const list = (await this.api('/api/keys')).keys || [];
    const hit = list.find((k) => k.name === name);
    if (hit) return hit.key || hit;
    const created = await this.api('/api/keys', { method: 'POST', body: { name } });
    return created.key;
  }

  async models(key) {
    const res = await request(`${this.base}/v1/models`, {
      headers: { authorization: `Bearer ${key}` },
      raw: true,
      timeout: 20000,
    });
    return res.json?.data || [];
  }

  async chat(key, model, prompt, { maxTokens = 32 } = {}) {
    const res = await request(`${this.base}/v1/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: { model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, stream: false },
      timeout: this.cfg.chatTimeout,
      raw: true,
    });
    if (res.status >= 400) {
      const e = new Error(res.json?.error?.message || `HTTP ${res.status}`);
      e.status = res.status;
      throw e;
    }
    return res.json;
  }
}

module.exports = { NineRouter };
