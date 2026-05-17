// Composes Chrome Web Store screenshots (1280×800) from raw popup captures.
// The narrow popup capture is framed on the dmarcheck-brand #0a0a0f field
// with the DMarcus wordmark — same visual language as scripts/gen-promo.mjs.
//
// Each store/screenshot-N-src.png (raw capture, any size) becomes
// store/screenshot-N-1280x800.png. Requires `rsvg-convert` (brew install
// librsvg). Both src and output PNGs are committed so submission never
// depends on this tool.
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = resolve(root, "store");

const W = 1280;
const H = 800;
const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

// Popup is framed on the left at a fixed height; its width is derived from
// the actual capture's aspect ratio so re-takes at any resolution stay
// correct without editing this file.
const shotH = 700;
const shotX = 96;
const shotY = Math.round((H - shotH) / 2); // 50

/** Read intrinsic dimensions from a PNG's IHDR (bytes 16–23, big-endian). */
function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const srcs = readdirSync(storeDir)
  .filter((f) => /^screenshot-\d+-src\.png$/.test(f))
  .sort();

if (srcs.length === 0) {
  console.error(
    "No store/screenshot-N-src.png captures found. Capture the popup first.",
  );
  process.exit(1);
}

for (const src of srcs) {
  const n = src.match(/^screenshot-(\d+)-src\.png$/)[1];
  const raw = readFileSync(resolve(storeDir, src));
  const { w: srcW, h: srcH } = pngSize(raw);
  const shotW = Math.round((shotH * srcW) / srcH);
  const textX = shotX + shotW + 96;
  const b64 = raw.toString("base64");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#0a0a0f"/>
  <rect x="${shotX - 1}" y="${shotY - 1}" width="${shotW + 2}" height="${shotH + 2}" rx="15" fill="none" stroke="#27272a" stroke-width="2"/>
  <clipPath id="r"><rect x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" rx="14"/></clipPath>
  <image x="${shotX}" y="${shotY}" width="${shotW}" height="${shotH}" clip-path="url(#r)" preserveAspectRatio="xMidYMid slice" xlink:href="data:image/png;base64,${b64}"/>
  <text font-family="${SANS}" font-weight="800" fill="#e4e4e7" font-size="76" x="${textX}" y="312">DMarcus</text>
  <text font-family="${SANS}" fill="#a1a1aa" font-size="30" x="${textX + 2}" y="362">Email security, entirely client-side</text>
  <text font-family="${SANS}" fill="#a1a1aa" font-size="30" x="${textX + 2}" y="404">DMARC · SPF · DKIM · BIMI · MTA-STS</text>
  <text font-family="${SANS}" fill="#f97316" font-size="26" x="${textX + 2}" y="470">Companion to dmarc.mx — no server, no tracking</text>
</svg>`;

  const svgPath = resolve(storeDir, `.screenshot-${n}.svg`);
  const out = resolve(storeDir, `screenshot-${n}-1280x800.png`);
  writeFileSync(svgPath, svg);
  // -b flattens any alpha to the brand field (CWS prefers no transparency).
  execFileSync("rsvg-convert", [
    "-w",
    String(W),
    "-h",
    String(H),
    "-b",
    "#0a0a0f",
    svgPath,
    "-o",
    out,
  ]);
  unlinkSync(svgPath);
  console.log(`✓ screenshot-${n}-1280x800.png`);
}
