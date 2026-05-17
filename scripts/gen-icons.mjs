// Rasterizes icons/icon.svg into the PNG sizes the manifest references.
// Requires `rsvg-convert` (brew install librsvg). The generated PNGs are
// committed so CI / `npm run build` never depend on this tool.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const icons = resolve(dirname(fileURLToPath(import.meta.url)), "../icons");
const svg = resolve(icons, "icon.svg");

for (const size of [16, 32, 48, 128]) {
  const out = resolve(icons, `icon-${size}.png`);
  execFileSync("rsvg-convert", [
    "-w",
    String(size),
    "-h",
    String(size),
    svg,
    "-o",
    out,
  ]);
  console.log(`✓ icon-${size}.png`);
}
