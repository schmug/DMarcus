# DMarcus — dmarc.mx companion Chrome extension

Check any domain's email security posture (DMARC, SPF, DKIM, BIMI, MX,
MTA-STS, TLS-RPT, security.txt) **entirely client-side** using
DNS-over-HTTPS. No dmarc.mx API dependency, no rate limits, no server load —
the full scan engine runs in the extension's service worker.

> Companion to [dmarc.mx](https://dmarc.mx). Implements
> [schmug/dmarcheck#88](https://github.com/schmug/dmarcheck/issues/88).

## How it works

The dmarcheck analyzer modules (`src/analyzers/`) are pure TypeScript with
zero platform dependencies. The only infrastructure boundary is
`src/dns/client.ts`. DMarcus vendors the analyzers + scoring **verbatim** and
swaps that one file for a DNS-over-HTTPS adapter:

```
popup / omnibox / context menu / badge
            │  chrome.runtime.sendMessage
            ▼
   service-worker.ts ── scan() ──▶ analyzers/* ──▶ dns/client.ts (DoH)
            │                                          │
            │                              Cloudflare JSON DoH
   chrome.storage.session (5-min TTL)        └─ Google DoH (fallback)
   chrome.storage.local   (history)
```

- **DoH adapter** — `queryTxt()` / `queryMx()` over
  `cloudflare-dns.com/dns-query`, falling back to `dns.google/resolve`.
  Keeps dmarcheck's exact contract: `null` = record absent (NXDOMAIN/NODATA),
  thrown `DnsLookupError` = query failure (SERVFAIL/timeout).
- **Service worker** — hosts the scan engine, dedupes in-flight scans,
  caches results in `chrome.storage.session` for 5 minutes (matching the
  dmarc.mx server cache) and keeps a 50-entry history in
  `chrome.storage.local`.
- **Fully offline** — no telemetry, no analytics, no phone-home. The only
  network traffic is DNS-over-HTTPS and the MTA-STS / security.txt policy
  fetches the scan itself requires.

## Features (MVP / Phase 1)

| Surface | Behavior |
|---|---|
| **Popup** | Domain input (prefilled with the active tab's domain), grade badge, per-protocol pass/fail summary, "View full report on dmarc.mx" link, recent history |
| **Toolbar badge** | The extension icon shows the active tab domain's grade with a color-coded badge |
| **Context menu** | Right-click a link / selected email / page → "Check email security with dmarc.mx" |
| **Omnibox** | Type `dmrc example.com` in the address bar |

## Build & load

```bash
npm install
npm run build         # bundles into dist/
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load
unpacked** → select the `dist/` directory.

```bash
npm run typecheck     # tsc --noEmit
npm test              # vitest (DoH client + orchestrator integration)
npm run lint          # biome
npm run icons         # regenerate PNG icons from icons/icon.svg (needs librsvg)
```

## Permissions rationale

| Permission | Why |
|---|---|
| `storage` | Session result cache + local scan history |
| `activeTab` | Read the current tab's domain when the popup opens |
| `tabs` | Passively update the toolbar grade badge on tab switch — `activeTab` alone only grants URL access after explicit invocation, so it can't power a passive badge |
| `contextMenus` | Right-click "Check email security" entry |
| `host_permissions` | `cloudflare-dns.com` + `dns.google` for DoH; narrow `/.well-known/mta-sts.txt`, `/.well-known/security.txt`, `/security.txt` path patterns for the policy fetches the scan performs |

## Relationship to dmarcheck

The analyzers, scoring, tag parser, and domain normalizer are copied
unmodified from [schmug/dmarcheck](https://github.com/schmug/dmarcheck)
(MIT). Only `src/dns/client.ts` and `src/orchestrator.ts` (Sentry stripped)
diverge, plus the extension layer in `src/ext/`. A future follow-up migrates
the shared core to a `packages/core` monorepo package instead of vendoring.

## License

MIT — see [LICENSE](./LICENSE).
