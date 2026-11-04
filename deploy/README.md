# Deploy notes (this fork)

Live on the mac mini (192.168.1.110), adapter on port 8792, managed by launchd.

| thing | value |
| --- | --- |
| install dir | `/Users/raksmeilong/Documents/GitHub/kaerpool` |
| launchd label | `com.ollie.kaerpool` |
| adapter base | `http://192.168.1.110:8792/v1` (LAN, so a remote 9Router can reach it) |
| state | `data/accounts.json` (0600, gitignored) |
| routers | `http://192.168.1.200:20128` and `http://127.0.0.1:20128` |

## install / restart

```bash
cp deploy/com.ollie.kaerpool.plist ~/Library/LaunchAgents/
launchctl unload ~/Library/LaunchAgents/com.ollie.kaerpool.plist 2>/dev/null
launchctl load   ~/Library/LaunchAgents/com.ollie.kaerpool.plist
curl -s http://127.0.0.1:8792/health
```

Port 8791 is taken by an unrelated file server on this box, hence 8792 everywhere.

## mailboxes

Kaer rejects disposable domains (`mail.tm` → *"Please use a permanent email address."*).
The `imap` provider creates `local+kaer<hex>@gmail.com` aliases on a real inbox and
reads the 6-digit code straight over IMAP — no third-party mail API.

```bash
export KAER_MAIL=imap
export KAER_IMAP_USER='you@gmail.com'
export KAER_IMAP_PASS='app password'      # Google account → App passwords
node bin/kaerpool.js create 3 --concurrency 2
```

Watch: Kaer rate-limits signups and drops some sends. Failures land as
`verify :: verification code never arrived`; rerun `create` later for the shortfall.

## credit reality check

Accounts from this run carry `free_credit_usd: 0` on `/v1/me`, so the pool answers
`503 no healthy account` until a key has balance (Kaer billing / top-up). The plumbing
is complete — key mint, pool, 9Router node, connection, router key — the pool just
needs funded keys to serve traffic.
