'use strict';

const zlib = require('node:zlib');
const { URL } = require('node:url');

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

class HttpError extends Error {
  constructor(message, status, body, headers) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.body = body;
    this.headers = headers;
    this.json = null;
    try {
      this.json = JSON.parse(body);
    } catch {
      /* not json */
    }
  }
}

function decode(res, buf) {
  const enc = String(res.headers['content-encoding'] || '').toLowerCase();
  if (enc.includes('br')) return zlib.brotliDecompressSync(buf);
  if (enc.includes('gzip')) return zlib.gunzipSync(buf);
  if (enc.includes('deflate')) return zlib.inflateSync(buf);
  return buf;
}

/**
 * Minimal fetch replacement on node:https — keeps the tool zero-dependency and
 * lets us control redirects, cookies and timeouts precisely.
 */
function request(url, opts = {}) {
  const {
    method = 'GET',
    headers = {},
    body,
    timeout = 30000,
    redirect = true,
    maxRedirects = 5,
    raw = false,
  } = opts;

  return new Promise((resolve, reject) => {
    let attempt = 0;
    const go = (target, redirectsLeft) => {
      const u = new URL(target);
      const lib = u.protocol === 'http:' ? require('node:http') : require('node:https');
      let payload = body;
      const h = {
        'user-agent': DEFAULT_UA,
        'accept-encoding': 'gzip, deflate, br',
        ...headers,
      };
      if (payload && typeof payload !== 'string' && !Buffer.isBuffer(payload)) {
        payload = JSON.stringify(payload);
        if (!h['content-type']) h['content-type'] = 'application/json';
      }
      if (payload) h['content-length'] = Buffer.byteLength(payload);

      const req = lib.request(
        {
          protocol: u.protocol,
          hostname: u.hostname,
          port: u.port || (u.protocol === 'http:' ? 80 : 443),
          path: u.pathname + u.search,
          method,
          headers: h,
        },
        (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            let text;
            try {
              text = decode(res, Buffer.concat(chunks)).toString('utf8');
            } catch {
              text = Buffer.concat(chunks).toString('utf8');
            }
            const location = res.headers.location;
            if (redirect && location && [301, 302, 303, 307, 308].includes(res.statusCode) && redirectsLeft > 0) {
              const next = new URL(location, target).toString();
              const nextMethod = res.statusCode === 303 || (res.statusCode <= 302 && method === 'POST') ? 'GET' : method;
              return go(next, redirectsLeft - 1, nextMethod);
            }
            const out = {
              status: res.statusCode,
              headers: res.headers,
              text,
              json: null,
              url: target,
            };
            try {
              out.json = JSON.parse(text);
            } catch {
              /* not json */
            }
            if (res.statusCode >= 400) {
              const msg =
                (out.json && (out.json.error?.message || out.json.message || out.json.error)) ||
                `HTTP ${res.statusCode} ${target}`;
              const err = new HttpError(String(msg), res.statusCode, text, res.headers);
              if (raw) return resolve(out);
              err.response = out;
              return reject(err);
            }
            resolve(out);
          });
        }
      );
      req.setTimeout(timeout, () => {
        req.destroy(new Error(`timeout after ${timeout}ms ${method} ${target}`));
      });
      req.on('error', (err) => {
        attempt += 1;
        if (attempt < 2 && /ECONNRESET|ETIMEDOUT|EAI_AGAIN/.test(err.code || '')) return go(target, redirectsLeft);
        reject(err);
      });
      if (payload) req.write(payload);
      req.end();
    };
    go(url, maxRedirects);
  });
}

/** Parses Set-Cookie headers into a name->value map plus a Cookie header string. */
function cookiesFrom(res) {
  const raw = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [].concat(res.headers['set-cookie'] || []);
  const jar = {};
  for (const line of raw.filter(Boolean)) {
    const [pair] = line.split(';');
    const idx = pair.indexOf('=');
    if (idx > 0) jar[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim();
  }
  return jar;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Retries a promise-returning fn with exponential backoff. */
async function retry(fn, { attempts = 3, baseMs = 800, log } = {}) {
  let last;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fn(i);
    } catch (err) {
      last = err;
      if (err.status && err.status < 500 && err.status !== 429) throw err;
      if (log) log(`  retry ${i + 1}/${attempts}: ${err.message}`);
      await sleep(baseMs * 2 ** i);
    }
  }
  throw last;
}

module.exports = { request, cookiesFrom, HttpError, retry, sleep };
