// Bundles the TypeScript entrypoints and assembles a loadable extension in
// dist/. Run `npm run build`, then load dist/ as an unpacked extension.

import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(root, "dist");

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await build({
  entryPoints: {
    "service-worker": resolve(root, "src/ext/service-worker.ts"),
    popup: resolve(root, "src/ext/popup.ts"),
  },
  outdir: dist,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: true,
  // Fail loudly if anything in the graph pulls a Node builtin — the whole
  // point of the DoH client is to keep the bundle browser-pure.
  external: [],
  logLevel: "info",
});

for (const asset of ["manifest.json", "popup.html", "popup.css", "icons"]) {
  await cp(resolve(root, asset), resolve(dist, asset), { recursive: true });
}

console.log("✓ Built extension → dist/");
