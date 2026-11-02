/* ─────────────────────────────────────────────────────────────
   Builds dist/DovePhotobooth.exe — a single file that runs the whole
   photobooth (booth, download page, admin dashboard) without Node installed.

   Uses Node's built-in "single executable application" feature:
   1. bundle server.js + lib/*.js into one script
   2. pack the pages, styles, scripts and frame in as assets
   3. inject both into a copy of node.exe (with postject, fetched by npx)

   Run:  npm run build:exe       (needs internet once, for postject)
   ───────────────────────────────────────────────────────────── */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync, execSync } = require("node:child_process");

const APP = path.resolve(__dirname, "..");
const DIST = path.join(APP, "dist");
const EXE = path.join(DIST, process.platform === "win32" ? "DovePhotobooth.exe" : "dove-photobooth");
const BUNDLE = path.join(DIST, "bundle.js");
const BLOB = path.join(DIST, "sea-prep.blob");
const CONFIG = path.join(DIST, "sea-config.json");

// Files the browser loads; everything else (server code, data, photos) stays out
const ASSET_EXT = [".html", ".css", ".js", ".png", ".jpg", ".svg", ".ico"];
const SKIP = new Set(["lib", "build", "dist", "data", "photos", "node_modules", "server.js"]);

const step = (msg) => console.log(`\n▸ ${msg}`);
// npx is a .cmd script on Windows, so it runs through the shell as one quoted command line;
// node.exe runs directly (its path has a space in "Program Files")
const run = (cmd, args) => (cmd === "npx"
  ? execSync([cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" "), { stdio: "inherit" })
  : execFileSync(cmd, args, { stdio: "inherit" }));

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

/* 1. Bundle the server: each lib module becomes a function, require() is routed to them */
step("Bundling server code");
const modules = fs.readdirSync(path.join(APP, "lib"))
  .filter((f) => f.endsWith(".js"))
  .map((f) => `  "./lib/${path.basename(f, ".js")}": function (module, exports, require) {\n` +
    fs.readFileSync(path.join(APP, "lib", f), "utf8") + "\n  },");
const bundle = `"use strict";
const __modules = {
${modules.join("\n")}
};
const __cache = {};
function __require(name) {
  if (!(name in __modules)) return require(name);
  if (!__cache[name]) {
    const m = { exports: {} };
    __cache[name] = m;
    __modules[name](m, m.exports, __require);
  }
  return __cache[name].exports;
}
(function (require, __filename, __dirname) {
${fs.readFileSync(path.join(APP, "server.js"), "utf8")}
})(__require, process.execPath, require("node:path").dirname(process.execPath));
`;
fs.writeFileSync(BUNDLE, bundle);

/* 2. Assets: every page file, keyed by its URL path (forward slashes) */
step("Packing pages and frame");
const assets = {};
(function walk(dir, rel = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!rel && SKIP.has(e.name)) continue;
    if (e.name.startsWith(".") || e.name.startsWith("_")) continue;
    const key = rel ? `${rel}/${e.name}` : e.name;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, key);
    else if (ASSET_EXT.includes(path.extname(e.name).toLowerCase())) assets[key] = full;
  }
})(APP);
console.log("  " + Object.keys(assets).join("\n  "));

fs.writeFileSync(CONFIG, JSON.stringify({
  main: BUNDLE,
  output: BLOB,
  disableExperimentalSEAWarning: true,
  assets,
}, null, 2));

/* 3. Build the blob and inject it into a copy of node.exe */
step("Creating executable");
run(process.execPath, ["--experimental-sea-config", CONFIG]);
if (process.argv.includes("--no-inject")) {
  console.log(`\nStopped before injecting (--no-inject). Bundle and blob are in ${path.relative(APP, DIST)}/`);
  process.exit(0);
}
fs.copyFileSync(process.execPath, EXE);

step("Injecting app into executable (postject)");
run("npx", ["--yes", "postject@1.0.0-alpha.6", EXE, "NODE_SEA_BLOB", BLOB,
  "--sentinel-fuse", "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2"]);

for (const f of [BUNDLE, BLOB, CONFIG]) fs.rmSync(f);
const mb = (fs.statSync(EXE).size / 1024 / 1024).toFixed(0);
console.log(`\n✔ Built ${path.relative(APP, EXE)} (${mb} MB)`);
console.log("  Double-click it to start. Photos and data are saved in folders next to it.\n");
