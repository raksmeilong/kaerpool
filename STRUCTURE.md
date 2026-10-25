# Structure

```text
                          ┌──────────────────────────────────────────────┐
                          │                kaerpool CLI                  │
                          │        bin/kaerpool.js ─► src/cli.js         │
                          └───────────────────┬──────────────────────────┘
                                              │
        ┌─────────────────────────────────────┼───────────────────────────────────┐
        │                                     │                                   │
        ▼                                     ▼                                   ▼
 ┌───────────────┐                    ┌────────────────┐                  ┌────────────────┐
 │  src/creator  │  account factory   │  src/kaer.js   │  API client      │  src/router.js │
 │  orchestrator │◄──────────────────►│  auth + keys   │                  │  9Router bridge│
 └───────┬───────┘                    └───────┬────────┘                  └───────┬────────┘
         │                                    │                                   │
         │ uses                               │ talks to                          │ talks to
         ▼                                    ▼                                   ▼
 ┌───────────────┐                    ┌────────────────┐                  ┌────────────────┐
 │   src/mail    │  mail.tm inbox     │ api.kaer.ai    │                  │  9Router       │
 │  verification │  code + link       │ /api/apiplat/* │                  │  /api/providers│
 └───────┬───────┘                    │ /v1/*          │                  │  /api/keys     │
         │                            └───────┬────────┘                  └───────┬────────┘
         │                                    │                                   │
         └───────────────┬────────────────────┘                                   │
                         ▼                                                        │
                 ┌───────────────┐      writes      ┌──────────────────┐          │
                 │  src/store    │◄────────────────►│ data/accounts.json│         │
                 │ atomic JSON   │                  │ 0600 permissions  │         │
                 └───────┬───────┘                  └────────┬─────────┘          │
                         │                                   │                    │
                         ▼                                   ▼                    │
                 ┌───────────────┐                    ┌──────────────┐            │
                 │ pool runtime  │  round-robin       │ router.json  │            │
                 │ src/adapter   │  failover + 402    └──────────────┘            │
                 │  :8791/v1     │──────────────────────────────────────────────► │
                 └───────────────┘   OpenAI-compatible endpoint                   │
                                                                                  │
                                   your tools  ──►  http://127.0.0.1:20128/v1  ───┘
```

## Modules

| File | Responsibility |
| --- | --- |
| `bin/kaerpool.js` | executable entrypoint, forwards argv to the CLI |
| `src/cli.js` | command router, flags, pretty output, table renderer |
| `src/config.js` | defaults (base URLs, ports, limits) and env overrides |
| `src/http.js` | zero-dependency HTTP client with brotli/gzip, retries, cookies |
| `src/mail.js` | mail.tm mailbox: create, login, poll, extract code/link |
| `src/kaer.js` | Kaer API client: request code → verify → mint key → `/v1` calls |
| `src/creator.js` | provisioning pipeline + bounded-concurrency bulk queue |
| `src/store.js` | atomic JSON store (0600, corrupt-file backup) |
| `src/adapter.js` | OpenAI-compatible pool (`/v1/models`, `/v1/chat/completions`) |
| `src/router.js` | 9Router bridge: login, provider node, connection, key |
| `src/log.js` | ANSI colours, symbols and the banner |
| `test/smoke.js` | offline checks: parsing, store, pool maths, adapter routes |
