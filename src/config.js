'use strict';

const DEFAULTS = {
  webBase: 'https://app.kaer.ai',
  apiBase: 'https://api.kaer.ai',
  mailBase: 'https://api.mail.tm',
  mailProvider: process.env.KAER_MAIL || 'mail.tm',
  mailDomain: process.env.KAER_MAIL_DOMAIN || 'gmail.com',
  imapHost: process.env.KAER_IMAP_HOST || 'imap.gmail.com',
  imapPort: Number(process.env.KAER_IMAP_PORT || 993),
  imapUser: process.env.KAER_IMAP_USER || '',
  imapPassword: process.env.KAER_IMAP_PASS || '',
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  clientId: '0e5fb411-83ea-4df7-a4ad-4f3864a0c188',
  routerBase: 'http://127.0.0.1:3000',
  routerPassword: process.env.NINE_ROUTER_PASSWORD || 'changeme9router',
  prefix: 'kaer',
  providerName: 'Kaer',
  adapterPort: 8791,
  adapterHost: '127.0.0.1',
  stateFile: './data/accounts.json',
  defaultModel: 'janus-1-flash',
  requestTimeout: 45000,
  chatTimeout: 120000,
  maxAttempts: 3,
  concurrency: 1,
};

function load(overrides = {}) {
  return { ...DEFAULTS, ...overrides };
}

module.exports = { DEFAULTS, load };
