'use strict';

const tls = require('node:tls');
const crypto = require('node:crypto');

/**
 * Gmail (or any IMAP4rev1 over TLS) mailbox, addressed with plus aliases.
 *
 * Kaer blocks disposable providers by domain, but accepts `local+tag@domain`.
 * Aliases land in one real inbox, which this client reads directly over IMAP —
 * no third-party mail API, no dependencies beyond `node:tls`.
 *
 * Config: imapHost / imapPort / imapUser / imapPassword (see src/config.js).
 */
class ImapMail {
  constructor(cfg = {}) {
    this.host = cfg.imapHost || 'imap.gmail.com';
    this.port = Number(cfg.imapPort || 993);
    this.user = cfg.imapUser || '';
    this.password = String(cfg.imapPassword || '').replace(/\s+/g, '');
    this.domain = cfg.mailDomain || 'gmail.com';
    this.folder = cfg.imapFolder || '"[Gmail]/All Mail"';
    this.sock = null;
    this.buf = '';
    this.seq = 0;
    this.seen = new Set();
  }

  connected() {
    return Boolean(this.sock && !this.sock.destroyed);
  }

  /** Every alias in this provider shares one inbox; the domain is the identity. */
  async domains() {
    if (!this.user) throw new Error('imap provider needs imapUser (set KAER_IMAP_USER)');
    return [this.domain];
  }

  /** Aliases are not provisioned — the mailbox already exists. */
  async create(address) {
    if (!this.user) throw new Error('imap provider needs imapUser (set KAER_IMAP_USER)');
    this.address = address;
    return { address, provider: 'imap', domain: this.domain };
  }

  open() {
    if (this.connected()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const sock = tls.connect({ host: this.host, port: this.port, servername: this.host }, () => {});
      this.sock = sock;
      sock.setEncoding('utf8');
      sock.once('error', reject);
      sock.on('data', (chunk) => { this.buf += chunk; });
      sock.once('secureConnect', () => resolve());
    });
  }

  /** Read one full command response: lines until the tagged status line, literals included. */
  async command(command) {
    this.seq += 1;
    const tag = `k${this.seq}`;
    await this.open();
    this.sock.write(`${tag} ${command}\r\n`);

    const deadline = Date.now() + 25000;
    for (;;) {
      const parsed = this.take(tag);
      if (parsed) {
        if (parsed.status !== 'OK') throw new Error(`imap ${command.split(' ')[0]} failed: ${parsed.status}`);
        return parsed.lines;
      }
      if (Date.now() > deadline) throw new Error(`imap timeout on ${command.split(' ')[0]}`);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  /**
   * Pull one complete response out of the buffer. Literals ({n}) are consumed by
   * byte-length, because IMAP literals are binary and may contain CRLFs.
   */
  take(tag) {
    const lines = [];
    let pos = 0;
    for (;;) {
      const end = this.buf.indexOf('\r\n', pos);
      if (end === -1) break;
      const line = this.buf.slice(pos, end);
      const literal = /\{(\d+)\}$/.exec(line);
      if (literal) {
        const size = Number(literal[1]);
        const start = end + 2;
        if (this.buf.length < start + size + 2) break; // literal not fully buffered yet
        lines.push(line, this.buf.slice(start, start + size));
        pos = start + size; // a literal is followed directly by the rest of the response
        continue;
      }
      lines.push(line);
      pos = end + 2;
      const status = new RegExp(`^${tag} (OK|NO|BAD)`).exec(line);
      if (status) {
        this.buf = this.buf.slice(pos);
        return { status: status[1], lines };
      }
    }
    return null;
  }

  async login() {
    if (!this.user) throw new Error('imap provider needs an address (set KAER_IMAP_USER)');
    if (!this.password) throw new Error('imap provider needs a password (set KAER_IMAP_PASS)');
    await this.command(`LOGIN "${this.user}" "${this.password}"`);
    await this.command(`SELECT ${this.folder}`);
  }

  /** UIDs of messages addressed to one alias, oldest first. */
  async search(address) {
    const lines = await this.command(`UID SEARCH TO "${address}"`);
    const uids = [];
    for (const line of lines) {
      if (!line.startsWith('* SEARCH')) continue;
      for (const tok of line.slice(9).trim().split(/\s+/)) if (/^\d+$/.test(tok)) uids.push(Number(tok));
    }
    return uids.sort((a, b) => a - b);
  }

  async fetch(uid) {
    const lines = await this.command(`UID FETCH ${uid} (BODY.PEEK[])`);
    return lines.filter((l) => l.length > 40 || /subject:/i.test(l)).join('\n');
  }

  /** Poll the inbox until a message for this alias carries a 6-digit code. */
  async findVerification(_pattern, timeoutMs = 150000, { address = this.address, pollMs = 5000 } = {}) {
    if (!address) throw new Error('imap findVerification needs the alias address');
    await this.login();
    const deadline = Date.now() + timeoutMs;
    const before = new Set(await this.search(address));
    for (;;) {
      const uids = (await this.search(address)).filter((u) => !before.has(u) || !this.seen.has(u));
      for (const uid of uids) {
        if (this.seen.has(uid)) continue;
        const raw = await this.fetch(uid);
        this.seen.add(uid);
        const code = extractCode(raw);
        if (code) return { code, uid };
      }
      if (Date.now() > deadline) return null;
      await new Promise((r) => setTimeout(r, pollMs));
    }
  }

  close() {
    if (!this.sock) return;
    try { this.sock.write('k0 LOGOUT\r\n'); this.sock.end(); } catch { /* already gone */ }
    this.sock = null;
    this.buf = '';
  }
}

/** Decode a small subset of MIME so the code survives quoted-printable/base64 parts. */
function decodeText(raw) {
  const out = [];
  const parts = raw.split(/Content-Transfer-Encoding:\s*/i);
  if (parts.length === 1) return raw;
  for (const part of parts.slice(1)) {
    const enc = part.slice(0, 12).toLowerCase();
    const body = part.slice(part.indexOf('\n\n') + 2 || 0);
    if (enc.startsWith('base64')) {
      try { out.push(Buffer.from(body.replace(/[^A-Za-z0-9+/=]/g, ''), 'base64').toString('utf8')); } catch { /* keep raw */ }
    } else if (enc.startsWith('quoted-printable')) {
      out.push(
        body
          .replace(/=\r?\n/g, '')
          .replace(/=([0-9A-F]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))),
      );
    } else {
      out.push(body);
    }
  }
  return `${raw}\n${out.join('\n')}`;
}

function extractCode(raw) {
  const text = decodeText(raw).replace(/<[^>]+>/g, ' ');
  const subject = /^subject:\s*(.+)$/im.exec(text)?.[1] || '';
  const fromSubject = /\b(\d{6})\b/.exec(subject);
  if (fromSubject) return fromSubject[1];
  const body = /\b(\d{6})\b/.exec(text.replace(/^subject:.*$/gim, ''));
  return body ? body[1] : null;
}

/** Build `local+kaer<hex>@domain`, which every mail host treats as a distinct address. */
function aliasFor(user, domain, tag = crypto.randomBytes(4).toString('hex')) {
  const [local, host] = user.split('@');
  return { address: `${local}+kaer${tag}@${host || domain}`, password: '' };
}

module.exports = { ImapMail, aliasFor, extractCode, decodeText };
