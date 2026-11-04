'use strict';

const { KaerClient } = require('./kaer');
const { MailTm } = require('./mail');
const { ImapMail, aliasFor } = require('./mail_imap');
const { retry, sleep } = require('./http');

function mailboxFor(cfg) {
  return cfg.mailProvider === 'imap' ? new ImapMail(cfg) : new MailTm(cfg);
}

/**
 * Provisions one Kaer API account end to end:
 *
 *   mailbox -> request code -> wait for email -> verify -> create key -> self-test
 *
 * Everything it learns is returned as a plain record so the caller can persist
 * it; on failure it throws with a `.stage` so the CLI can report precisely where.
 */
class Creator {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.log = opts.log || (() => {});
    this.mail = opts.mail || mailboxFor(cfg);
  }

  async ensureMailbox({ email, domain, mail = null } = {}) {
    if (mail) this.mail = mail;
    // Real inboxes (Gmail) are addressed with plus aliases; nothing to provision.
    if (this.mail instanceof ImapMail || this.cfg.mailProvider === 'imap') {
      const box = email ? { address: email } : aliasFor(this.cfg.imapUser, this.cfg.mailDomain);
      await this.mail.create(box.address);
      return { ...box, domain: this.cfg.mailDomain };
    }
    if (email) {
      const box = KaerClient.mailbox(domain || 'maxxspace.com');
      const target = { ...box, address: email };
      await this.mail.create(target.address, target.password);
      return target;
    }
    const domains = await this.mail.domains().catch(() => []);
    const useDomain = domain || domains[0];
    if (!useDomain) throw new Error('no mail.tm domain available');
    const box = KaerClient.mailbox(useDomain);
    await this.mail.create(box.address, box.password);
    return { ...box, domain: useDomain };
  }

  async provision({ email, domain, keyName = '9router', verify = true, mailTimeoutMs = 150000, mail = null } = {}) {
    const c = new KaerClient(this.cfg, {});
    const box0 = mail || mailboxFor(this.cfg);
    this.mail = box0;
    let stage = 'mailbox';
    try {
      const box = await this.ensureMailbox({ email, domain, mail: box0 });
      this.log(`  mailbox  ${box.address}`);
      stage = 'request-code';
      await retry(() => c.requestCode(box.address), { attempts: this.cfg.maxAttempts, log: this.log });
      this.log('  code requested');

      stage = 'verify';
      if (!verify) {
        return { email: box.address, mailbox: box, status: 'code-sent', cookies: c.state.cookies || null };
      }
      const found = await box0.findVerification(/kaer/i, mailTimeoutMs);
      if (!found || !found.code) throw new Error('verification code never arrived');
      this.log(`  code ${found.code}`);
      await c.verifyCode(box.address, found.code, true);

      stage = 'create-key';
      const apiKey = await c.createKey(keyName);
      this.log(`  key ${apiKey.slice(0, 14)}…`);

      stage = 'self-test';
      let me = null;
      let models = [];
      try {
        me = await c.me();
        models = (await c.models()).data;
      } catch (err) {
        this.log(`  ! self-test soft-failed: ${err.message}`);
      }

      const credit = Number(me?.balance?.free_credit_usd ?? 0);
      return {
        email: box.address,
        mailbox: box,
        status: credit > 0 ? 'active' : 'no-credit',
        creditUsd: credit,
        apiKey,
        keyName,
        keyPrefix: apiKey.slice(0, 14),
        apiKeyLast4: apiKey.slice(-4),
        accountRef: me?.account || null,
        balance: me?.balance || null,
        modelCount: models.length,
        models: models.map((m) => m.id).slice(0, 64),
        cookies: c.state.cookies,
        createdAt: new Date().toISOString(),
      };
    } catch (err) {
      err.stage = stage;
      err.email = email || undefined;
      err.retryable = !/too many new accounts|rate limit/i.test(err.message);
      if (/too many new accounts/i.test(err.message)) err.code = 'NETWORK_QUOTA';
      throw err;
    }
  }

  /** Bulk helper with bounded concurrency; never throws on individual failures. */
  async bulk(count, opts = {}) {
    const results = [];
    // each concurrent worker owns a mailbox client so inbox tokens never cross
    const useImap = this.cfg.mailProvider === 'imap';
const { ImapMail, aliasFor } = require('./mail_imap');
    const fails = [];
    const queue = Array.from({ length: count }, (_, i) => i);
    const workers = Array.from({ length: Math.max(1, opts.concurrency || 1) }, async () => {
      while (queue.length) {
        const i = queue.shift();
        if (i > 0) await sleep((opts.spawnDelayMs ?? 2500) * i);
        try {
          const rec = await this.provision({ ...opts, mail: useImap ? new ImapMail(this.cfg) : new MailTm(this.cfg) });
          results.push(rec);
          this.log(`✔ [${results.length + fails.length}/${count}] ${rec.email}`);
        } catch (err) {
          fails.push({ index: i, stage: err.stage, code: err.code || null, error: err.message });
          if (err.code === 'NETWORK_QUOTA') {
            this.log('  network quota reached — stopping the remaining queue');
            queue.length = 0;
          }
          this.log(`✖ [${results.length + fails.length}/${count}] ${err.email || i}: ${err.stage} :: ${err.message}`);
        }
        await sleep(opts.pauseMs ?? 1500);
      }
    });
    await Promise.all(workers);
    return { accounts: results, failures: fails };
  }
}

module.exports = { Creator, mailboxFor };
