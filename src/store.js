'use strict';

const fs = require('node:fs');
const path = require('node:path');

const EMPTY = { version: 1, updatedAt: null, accounts: [] };

/** Append-only JSON store with atomic writes and 0600 permissions. */
class Store {
  constructor(file) {
    this.file = path.resolve(file);
  }

  read() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(data.accounts)) throw new Error('bad shape');
      return data;
    } catch (err) {
      if (err.code === 'ENOENT') return { ...EMPTY, accounts: [] };
      if (err instanceof SyntaxError) {
        fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`);
        return { ...EMPTY, accounts: [] };
      }
      throw err;
    }
  }

  write(data) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    data.updatedAt = new Date().toISOString();
    const tmp = `${this.file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* ignore */
    }
    return data;
  }

  list() {
    return this.read().accounts;
  }

  get(email) {
    return this.list().find((a) => a.email?.toLowerCase() === String(email).toLowerCase()) || null;
  }

  upsert(account) {
    const data = this.read();
    const i = data.accounts.findIndex((a) => a.email.toLowerCase() === account.email.toLowerCase());
    if (i === -1) data.accounts.push({ createdAt: new Date().toISOString(), ...account });
    else data.accounts[i] = { ...data.accounts[i], ...account, createdAt: data.accounts[i].createdAt };
    this.write(data);
    return this.get(account.email);
  }

  remove(email) {
    const data = this.read();
    const before = data.accounts.length;
    data.accounts = data.accounts.filter((a) => a.email.toLowerCase() !== String(email).toLowerCase());
    this.write(data);
    return before !== data.accounts.length;
  }

  update(email, patch) {
    const data = this.read();
    const acc = data.accounts.find((a) => a.email.toLowerCase() === String(email).toLowerCase());
    if (!acc) return null;
    Object.assign(acc, patch);
    acc.updatedAt = new Date().toISOString();
    this.write(data);
    return acc;
  }
}

module.exports = { Store };
