# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

DMarcus is a Manifest V3 Chrome extension — a client-side companion to
[dmarc.mx](https://dmarc.mx) that scans a domain's email security posture
(DMARC, SPF, DKIM, BIMI, MX, MTA-STS, TLS-RPT, security.txt) entirely in the
browser via DNS-over-HTTPS. No backend, no telemetry. Implements
[schmug/dmarcheck#88](https://github.com/schmug/dmarcheck/issues/88).

## Commands

```bash
npm install
npm run build       # esbuild bundle → dist/ (load dist/ as unpacked extension)
npm run typecheck   # tsc --noEmit
npm test            # vitest run
npm run test:watch  # vitest watch
npx vitest run test/doh-client.test.ts            # single test file
npx vitest run -t "name of test"                  # single test by name
npm run lint        # biome check src/ test/
npm run lint:fix    # biome check --write
npm run icons       # regenerate PNG icons from icons/icon.svg (needs librsvg)
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on
Node 22. Run all four locally before opening a PR.

## Architecture

The core insight: dmarcheck's analyzer modules are pure TypeScript with **one**
infrastructure boundary — `src/dns/client.ts`. DMarcus vendors the analyzers +
scoring verbatim and swaps only that file for a DoH adapter.

```
popup / omnibox / context menu / badge
        │  chrome.runtime.sendMessage
        ▼
src/ext/service-worker.ts ── scan() ──▶ src/analyzers/* ──▶ src/dns/client.ts (DoH)
        │
chrome.storage.session (5-min result cache)
chrome.storage.local   (50-entry history)
```

- **`src/orchestrator.ts`** — drives the scan: concurrency model, MX→DKIM
  chaining, MX/MTA-STS cross-check, the A+→S `dmarc.mx`-in-TXT easter egg. A
  Sentry-free clone of dmarcheck's orchestrator.
- **`src/dns/client.ts`** — the only genuine platform divergence. DoH adapter
  over Cloudflare JSON DoH (`cloudflare-dns.com/dns-query`) with Google
  (`dns.google/resolve`) fallback. Preserves dmarcheck's contract exactly:
  **`null` = record genuinely absent (NXDOMAIN/NODATA); a thrown
  `DnsLookupError` = query failure (SERVFAIL/timeout/network).** Analyzers and
  scoring depend on this distinction — never collapse "absent" into "error" or
  vice versa.
- **`src/ext/service-worker.ts`** — hosts the scan engine. Single-flight
  dedupe via the `inFlight` map (popup/badge/omnibox racing the same domain),
  session-cache with 5-min TTL, history push. Survives popup close.
- **`src/ext/popup.ts` / `popup.html` / `popup.css`** — the only DOM surface.
- **`src/ext/shared.ts`** — message types + grade→color palette shared between
  service worker and popup.

## Vendored code — do not reformat or diverge

`src/analyzers/**`, `src/shared/scoring.ts`, `src/shared/parse-tags.ts`,
`src/shared/domain.ts`, and `src/dns/types.ts` are copied **byte-for-byte**
from [schmug/dmarcheck](https://github.com/schmug/dmarcheck). They are
deliberately excluded from biome (`biome.json` `files.includes` `!` entries) so
they stay aligned with upstream.

- Do not run the formatter/linter over them, do not "clean them up," do not
  change their style.
- The only sanctioned mechanical change vs. upstream: `.js` import extensions
  are stripped (this project uses `moduleResolution: bundler`).
- Behavioral fixes belong upstream in dmarcheck, then re-vendored here.
- Migrating this shared core into a `packages/core` package is tracked in
  [DMarcus#7](https://github.com/schmug/DMarcus/issues/7).

## Critical invariants

- **MTA-STS / security.txt policy fetches use `redirect: "manual"`** (NOT
  `"error"`). `"error"` rejects on the no-redirect happy path too. See the
  comment block in `src/analyzers/mta-sts.ts`. This regressed twice upstream;
  treat any change here as high-risk.
- **Bundle must stay browser-pure.** `scripts/build.mjs` sets esbuild
  `external: []` so any accidental Node-builtin import in the graph fails the
  build loudly. Don't add Node-only dependencies to the scan path.
- **Permissions are justified individually** (see README "Permissions
  rationale"). `tabs` (not just `activeTab`) is required for the passive
  badge. Adding permissions or `host_permissions` patterns needs a stated
  reason — keep host patterns as narrow as the current
  `/.well-known/...` path scoping.
- The toolbar badge scans the active tab's domain on every tab switch, so
  browsing drives DoH queries. An opt-out toggle is tracked in
  [DMarcus#8](https://github.com/schmug/DMarcus/issues/8); preserve this
  privacy framing in any badge change.
