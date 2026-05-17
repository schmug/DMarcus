# Chrome Web Store listing — permission justifications

Copy-paste targets for the CWS Developer Dashboard. Keep in sync with
`manifest.json` and the README "Permissions rationale" table.

## Single purpose

DMarcus checks a domain's email-security posture (DMARC, SPF, DKIM, BIMI, MX,
MTA-STS, TLS-RPT, security.txt) entirely client-side using DNS-over-HTTPS. It
performs no other function, runs no backend, and collects no user data.

## Per-permission justifications

### `storage`

Caches scan results in `chrome.storage.session` for a 5-minute TTL to avoid
redundant DNS queries when the user reopens the popup, and keeps a capped
50-entry local scan history in `chrome.storage.local`. No data leaves the
device.

### `activeTab`

When the user opens the popup or uses the context-menu/omnibox action, the
extension reads the active tab's hostname so it can scan that domain. Access is
granted only on explicit user invocation.

### `tabs`

Powers the passive toolbar badge that shows the email-security grade for the
site being viewed and updates on tab switch. `activeTab` alone only exposes a
tab's URL after an explicit click, so it cannot drive a badge that refreshes
automatically as the user navigates. Only the hostname is read; no page content
is accessed.

### `contextMenus`

Adds a single right-click menu item, "Check email security," so the user can
scan the current site's domain without opening the popup.

## Host-permission justification

`https://cloudflare-dns.com/*` and `https://dns.google/*` are the two
DNS-over-HTTPS resolvers used to look up DMARC/SPF/DKIM/BIMI/MX/TXT records
(Google is a fallback for Cloudflare). The narrow path patterns
`https://*/.well-known/mta-sts.txt`, `https://*/.well-known/security.txt`, and
`https://*/security.txt` are required because the MTA-STS and security.txt
checks must fetch those specific well-known policy files from the scanned
domain. Patterns are scoped to those exact file paths — no broad page access —
and no page content or browsing data is read or transmitted.

## Remote code

Not used. All code is bundled in the extension package (esbuild, no externals).
The extension only makes data requests (DNS-over-HTTPS lookups and fetches of
`.well-known` policy text files); it does not load or execute any remotely
hosted scripts.

## Data usage (privacy tab)

Does not collect or transmit any user data. All scanning happens locally in the
browser; results and history are stored only on the user's device. No
analytics, no telemetry, no servers.
