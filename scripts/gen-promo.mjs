// Generates the Chrome Web Store promotional tiles from on-brand SVG.
// Matches the dmarcheck OG-card visual language (see dmarcheck
// scripts/generate-icons.mjs `ogSvg`): #0a0a0f field, the DMarcus mascot
// (orange @ + white eyes + three #ea580c legs), wordmark + companion line.
//
// Requires `rsvg-convert` (brew install librsvg), same as gen-icons.mjs.
// Outputs committed to store/ so submission never depends on this tool.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const storeDir = resolve(root, "store");
mkdirSync(storeDir, { recursive: true });

// DMarcus mascot as a reusable <g>, authored at the dmarcheck OG scale
// (@ font-size 180) so proportions match the canonical brand exactly.
// Caller positions it via a translate/scale transform.
const mascot = `
  <g>
    <text x="40" y="100" font-family="monospace" font-size="180" fill="#f97316" text-anchor="middle">@</text>
    <circle cx="0" cy="10" r="22" fill="#ffffff"/>
    <circle cx="75" cy="10" r="22" fill="#ffffff"/>
    <circle cx="5" cy="16" r="11" fill="#0a0a0f"/>
    <circle cx="80" cy="16" r="11" fill="#0a0a0f"/>
    <rect x="-10" y="160" width="16" height="32" rx="6" fill="#ea580c"/>
    <rect x="30" y="160" width="16" height="26" rx="6" fill="#ea580c"/>
    <rect x="70" y="160" width="16" height="32" rx="6" fill="#ea580c"/>
  </g>`;

const SANS =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

/** Build a promo tile SVG. mascotTransform places the shared mascot group. */
function promo({ w, h, mascotTransform, title, sub, tag }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#0a0a0f"/>
  <g transform="${mascotTransform}">${mascot}</g>
  <text font-family="${SANS}" font-weight="800" fill="#e4e4e7" font-size="${title.size}" x="${title.x}" y="${title.y}">DMarcus</text>
  <text font-family="${SANS}" fill="#a1a1aa" font-size="${sub.size}" x="${sub.x}" y="${sub.y}">${sub.text}</text>
  <text font-family="${SANS}" fill="#f97316" font-size="${tag.size}" x="${tag.x}" y="${tag.y}">${tag.text}</text>
</svg>`;
}

const tiles = [
  {
    name: "promo-small-440x280",
    w: 440,
    h: 280,
    // Mascot scaled to ~0.7 of OG, left-anchored and vertically centered.
    mascotTransform: "translate(70 70) scale(0.7)",
    title: { x: 195, y: 122, size: 52 },
    sub: { x: 196, y: 158, size: 19, text: "Email security, client-side" },
    tag: { x: 196, y: 192, size: 17, text: "Companion to dmarc.mx" },
  },
  {
    name: "promo-marquee-1400x560",
    w: 1400,
    h: 560,
    mascotTransform: "translate(170 175) scale(1.3)",
    title: { x: 560, y: 250, size: 110 },
    sub: {
      x: 564,
      y: 320,
      size: 38,
      text: "Email security scanning, entirely client-side",
    },
    tag: {
      x: 564,
      y: 384,
      size: 32,
      text: "Companion to dmarc.mx — no server, no tracking",
    },
  },
];

for (const t of tiles) {
  const svgPath = resolve(storeDir, `${t.name}.svg`);
  const pngPath = resolve(storeDir, `${t.name}.png`);
  writeFileSync(svgPath, promo(t));
  execFileSync("rsvg-convert", [
    "-w",
    String(t.w),
    "-h",
    String(t.h),
    svgPath,
    "-o",
    pngPath,
  ]);
  console.log(`✓ ${t.name}.png (${t.w}×${t.h})`);
}
