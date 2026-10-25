'use strict';

const { request, cookiesFrom } = require('./http');

/**
 * mail.tm disposable mailbox.
 *
 * Kaer's verification message carries both a 6-digit code in the subject and a
 * one-click token link inside the body, so either path can complete signup.
 */
class MailTm {
  constructor(cfg = {}) {
    this.base = (cfg.mailBase || 'https://api.mail.tm').replace(/\/$/, '');
    this.token = null;
    this.address = null;
    this.password = null;
  }

  async domains() {
    const res = await request(`${this.base}/domains?page=1`);
    return (res.json?.['hydra:member'] || []).map((d) => d.domain);
  }

  async create(address, password) {
    const res = await request(`${this.base}/accounts`, {
      method: 'POST',
      body: { address, password },
      timeout: 20000,
    });
    this.address = address;
    this.password = password;
    return { address, password, provider: 'mail.tm' };
  }

  async login(address, password) {
    const res = await request(`${this.base}/token`, {
      method: 'POST',
      body: { address, password },
      timeout: 20000,
    });
    this.token = res.json.token;
    this.address = address;
    this.password = password;
    return this.token;
  }

  async messages() {
    if (!this.token) await this.login(this.address, this.password);
    const res = await request(`${this.base}/messages?page=1`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    return res.json?.['hydra:member'] || [];
  }

  async message(id) {
    const res = await request(`${this.base}/messages/${id}`, {
      headers: { authorization: `Bearer ${this.token}` },
    });
    return res.json;
  }

  /** Returns {code, link} from the newest matching message, or null. */
  async findVerification(match = /kaer/i, timeoutMs = 120000) {
    if (!this.token) await this.login(this.address, this.password);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const list = await this.messages().catch(() => []);
      for (const m of list) {
        const to = (m.to || []).map((t) => t.address?.toLowerCase());
        if (this.address && to.length && !to.includes(this.address.toLowerCase())) continue;
        const hay = `${m.subject || ''} ${m.intro || ''}`;
        if (!match.test(hay) && !match.test(m.from?.address || '')) continue;
        const code = (hay.match(/\b(\d{6})\b/) || [])[1] || null;
        let link = null;
        try {
          const full = await this.message(m.id);
          const text = `${full.text || ''} ${full.html || ''}`;
          link = (text.match(/https:\/\/[^\s"'<>]*(?:verify|token)[^\s"'<>]*/) || [])[0] || null;
          if (!code) {
            const c = (text.match(/\b(\d{6})\b/) || [])[1];
            if (c) return { code: c, link, message: m };
          }
        } catch {
          /* ignore */
        }
        if (code || link) return { code, link, message: m };
      }
      await new Promise((r) => setTimeout(r, 4000));
    }
    return null;
  }
}

module.exports = { MailTm, cookiesFrom };
