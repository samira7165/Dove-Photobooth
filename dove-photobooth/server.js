/* ─────────────────────────────────────────────────────────────
   The Dove Times Photobooth server
   Pages:  /  booth · /admin  dashboard (view, download, delete photos)

   Public API (used by the booth)
   - POST /api/photos        saves a photo, returns { code }
   - POST /api/track         { type: "print", code }

   Admin API (login required; role in brackets)
   - POST   /api/admin/login · /api/admin/logout · GET /api/admin/me
   - POST   /api/admin/me/password                 change own password
   - GET    /api/admin/stats              [viewer]  analytics
   - GET    /api/admin/photos             [staff]   submissions
   - GET    /api/admin/photos/CODE/image  [staff]
   - GET    /api/admin/export.csv         [staff]
   - GET    /api/admin/export.zip         [staff]   all photos + CSV (?codes=A,B,… for only those)
   - DELETE /api/admin/photos/CODE        [admin]
   - GET/POST /api/admin/users, PATCH/DELETE /api/admin/users/NAME  [admin]

   Run:  node server.js     (no npm install needed)
   Env:  PORT, PHOTOS_DIR, DATA_DIR, ADMIN_USER, ADMIN_PASSWORD
   ───────────────────────────────────────────────────────────── */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { createDb } = require("./lib/db");
const { createAuth } = require("./lib/auth");
const { writeZip } = require("./lib/zip");

// Running as DovePhotobooth.exe (see build/build-exe.js): pages come from inside
// the exe, and photos/data are kept in folders next to it.
const sea = (() => { try { const s = require("node:sea"); return s.isSea() ? s : null; } catch { return null; } })();

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
const HOME = sea ? path.dirname(process.execPath) : ROOT;
// On a host, point these at a persistent disk/volume so they survive restarts
const PHOTOS = path.resolve(process.env.PHOTOS_DIR || path.join(HOME, "photos"));
const DATA = path.resolve(process.env.DATA_DIR || path.join(HOME, "data"));
const MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB
const MAX_JSON = 64 * 1024;
const CODE_LENGTH = 6;
const CODE_ALPHABET = "0123456789"; // new codes are numbers only
// Also accepts older letter codes so photos saved before still work
const CODE_RE = new RegExp(`^[A-Z0-9]{${CODE_LENGTH}}$`);
const PUBLIC_EVENTS = ["print"];

// Only these file types are served; server code and data never are
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};
const PRIVATE = [PHOTOS, DATA, path.join(ROOT, "lib"), path.join(ROOT, "node_modules")];

fs.mkdirSync(PHOTOS, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const db = createDb(DATA, PHOTOS);
const auth = createAuth(DATA);
const firstAdmin = auth.ensureAdmin();

const photoPath = (code) => path.join(PHOTOS, code + ".jpg");

function newCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  } while (db.hasPhoto(code) || fs.existsSync(photoPath(code)));
  return code;
}

/* ── HTTP helpers ── */
function send(res, status, body, type = "application/json; charset=utf-8", headers = {}) {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store", ...headers });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit = MAX_UPLOAD) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function readJson(req) {
  try { return JSON.parse((await readBody(req, MAX_JSON)).toString("utf8") || "{}"); } catch { return {}; }
}

const isHttps = (req) => req.socket.encrypted || req.headers["x-forwarded-proto"] === "https";
const clientIp = (req) => String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress;

function getCookie(req, name) {
  const m = String(req.headers.cookie || "").match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
function sessionCookie(req, token, maxAgeSec) {
  return `sid=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSec}${isHttps(req) ? "; Secure" : ""}`;
}

const csvCell = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
const iso = (ms) => new Date(ms).toISOString();

function submissionsCsv(photos) {
  const rows = [["code", "created_at", "prints"]];
  for (const p of photos) rows.push([p.code, iso(p.createdAt), p.prints]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

/* ── Public API ── */
async function handlePublicApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/photos") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 413, { error: "Photo is too large." }); }
    // Must be a JPEG (starts with FF D8 FF)
    if (body.length < 3 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return send(res, 400, { error: "Expected a JPG photo." });
    }
    const code = newCode();
    await fsp.writeFile(photoPath(code), body);
    db.addPhoto(code);
    console.log(`Saved photo ${code}`);
    return send(res, 201, { code });
  }

  if (req.method === "POST" && url.pathname === "/api/track") {
    const { type, code } = await readJson(req);
    if (!PUBLIC_EVENTS.includes(type)) return send(res, 400, { error: "Unknown event." });
    db.track(type, typeof code === "string" && CODE_RE.test(code) ? code : null);
    return send(res, 204, "");
  }

  return send(res, 404, { error: "Not found." });
}

/* ── Admin API ── */
async function handleAdminApi(req, res, url) {
  const p = url.pathname.slice("/api/admin".length);

  if (req.method === "POST" && p === "/login") {
    const { username, password } = await readJson(req);
    const r = auth.login(clientIp(req), username, password);
    if (r.error) return send(res, r.status, { error: r.error });
    return send(res, 200, { user: r.user }, undefined, { "Set-Cookie": sessionCookie(req, r.token, 12 * 3600) });
  }

  const token = getCookie(req, "sid");
  const user = auth.userFor(token);
  if (!user) return send(res, 401, { error: "Please log in." });

  // Changes must come from the dashboard itself (a custom header can't be sent cross-site)
  if (req.method !== "GET" && req.headers["x-admin"] !== "1") return send(res, 403, { error: "Forbidden." });

  const need = (role) => {
    if (auth.roleAtLeast(user.role, role)) return true;
    send(res, 403, { error: "Your role can't do that." });
    return false;
  };

  if (req.method === "POST" && p === "/logout") {
    auth.logout(token);
    return send(res, 200, { ok: true }, undefined, { "Set-Cookie": sessionCookie(req, "", 0) });
  }
  if (req.method === "GET" && p === "/me") return send(res, 200, { user });
  if (req.method === "POST" && p === "/me/password") {
    const { current, next } = await readJson(req);
    const r = auth.changeOwnPassword(user.username, current, next);
    return send(res, r.error ? 400 : 200, r);
  }

  if (req.method === "GET" && p === "/stats") {
    if (!need("viewer")) return;
    return send(res, 200, db.stats());
  }

  if (req.method === "GET" && p === "/photos") {
    if (!need("staff")) return;
    return send(res, 200, { photos: db.listPhotos() });
  }

  let m = p.match(/^\/photos\/([A-Z0-9]+)\/image$/);
  if (req.method === "GET" && m) {
    if (!need("staff")) return;
    if (!CODE_RE.test(m[1])) return send(res, 404, { error: "Not found." });
    try {
      const data = await fsp.readFile(photoPath(m[1]));
      const disposition = url.searchParams.has("download") ? `attachment; filename="dove-times-${m[1]}.jpg"` : "inline";
      return send(res, 200, data, "image/jpeg", { "Content-Disposition": disposition, "Cache-Control": "private, max-age=3600" });
    } catch {
      return send(res, 404, { error: "Not found." });
    }
  }

  m = p.match(/^\/photos\/([A-Z0-9]+)$/);
  if (req.method === "DELETE" && m) {
    if (!need("admin")) return;
    if (!CODE_RE.test(m[1])) return send(res, 404, { error: "Not found." });
    await fsp.rm(photoPath(m[1]), { force: true });
    db.removePhoto(m[1]);
    console.log(`Deleted photo ${m[1]} (by ${user.username})`);
    return send(res, 200, { ok: true });
  }

  const stamp = new Date().toISOString().slice(0, 10);

  if (req.method === "GET" && p === "/export.csv") {
    if (!need("staff")) return;
    return send(res, 200, "﻿" + submissionsCsv(db.listPhotos()), "text/csv; charset=utf-8",
      { "Content-Disposition": `attachment; filename="dove-times-submissions-${stamp}.csv"` });
  }

  if (req.method === "GET" && p === "/export.zip") {
    if (!need("staff")) return;
    // ?codes=A,B,C downloads only the photos selected in the dashboard
    const pick = url.searchParams.has("codes") ? new Set(url.searchParams.get("codes").split(",")) : null;
    const photos = pick ? db.listPhotos().filter((ph) => pick.has(ph.code)) : db.listPhotos();
    if (!photos.length) return send(res, 404, { error: "No photos selected." });
    res.writeHead(200, {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dove-times-${pick ? "selected" : "photos"}-${stamp}.zip"`,
      "Cache-Control": "no-store",
    });
    const csv = Buffer.from("﻿" + submissionsCsv(photos), "utf8");
    const entries = [
      { name: "submissions.csv", mtime: Date.now(), read: async () => csv },
      ...photos.map((ph) => ({
        name: `photos/${ph.code}.jpg`, mtime: ph.createdAt, read: () => fsp.readFile(photoPath(ph.code)),
      })),
    ];
    return writeZip(res, entries);
  }

  if (p === "/users" || p.startsWith("/users/")) {
    if (!need("admin")) return;
    const name = decodeURIComponent(p.slice("/users/".length));
    if (req.method === "GET" && p === "/users") return send(res, 200, { users: auth.listUsers() });
    if (req.method === "POST" && p === "/users") {
      const r = auth.createUser(await readJson(req));
      return send(res, r.error ? 400 : 201, r);
    }
    if (req.method === "PATCH" && name) {
      const { role, password } = await readJson(req);
      const r = auth.updateUser(name, { role: role || undefined, password: password || undefined });
      return send(res, r.error ? r.status || 400 : 200, r);
    }
    if (req.method === "DELETE" && name) {
      const r = auth.deleteUser(name, user.username);
      return send(res, r.error ? r.status || 400 : 200, r);
    }
  }

  return send(res, 404, { error: "Not found." });
}

/* ── Static files ── */
async function handleStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  else if (!path.extname(rel)) rel += ".html";   // clean URLs: /admin → admin.html

  if (sea) {
    // Inside the exe only the page files are packed in, so nothing private can be served
    const type = TYPES[path.extname(rel).toLowerCase()];
    let data;
    try { data = Buffer.from(sea.getAsset(rel.replace(/^\/+/, ""))); } catch {}
    if (!type || !data) return send(res, 404, "Not found", "text/plain");
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    return res.end(req.method === "HEAD" ? undefined : data);
  }

  const file = path.normalize(path.join(ROOT, rel));
  const type = TYPES[path.extname(file).toLowerCase()];
  // Stay inside the app folder, and keep server code, data and saved photos private
  if (!type || !file.startsWith(ROOT + path.sep) || file === __filename ||
      PRIVATE.some((dir) => file.startsWith(dir + path.sep))) {
    return send(res, 404, "Not found", "text/plain");
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": type, "X-Content-Type-Options": "nosniff" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

// A double-clicked exe closes its window on exit, so wait for Enter before quitting
function fatal(msg) {
  console.error("\n" + msg);
  if (!sea) process.exit(1);
  console.error("\nPress Enter to close this window.");
  process.stdin.resume();
  process.stdin.once("data", () => process.exit(1));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/admin/")) await handleAdminApi(req, res, url);
    else if (url.pathname.startsWith("/api/")) await handlePublicApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Server error." });
    else res.destroy();
  }
}).listen(PORT, () => {
  console.log(`\nPhotobooth:       http://localhost:${PORT}`);
  console.log(`Admin dashboard:  http://localhost:${PORT}/admin`);
  console.log(`Photos are saved in: ${PHOTOS}`);
  console.log(`Data is saved in:    ${DATA}\n`);
  if (firstAdmin) {
    console.log("First admin account created:");
    console.log(`  username: ${firstAdmin.username}`);
    console.log(`  password: ${firstAdmin.password}`);
    if (firstAdmin.generated) console.log("  (Change it after logging in: \"Change password\" at the top of the dashboard.)");
    console.log("");
  }
  if (sea) {
    console.log("Keep this window open while the photobooth is in use. Close it to stop.\n");
    // Open the booth in the default browser
    if (!process.env.NO_BROWSER) {
      require("node:child_process").spawn("cmd", ["/c", "start", "", `http://localhost:${PORT}`], { detached: true, stdio: "ignore" }).unref();
    }
  }
});

server.on("error", (e) => {
  fatal(e.code === "EADDRINUSE"
    ? `Port ${PORT} is already in use. Is the photobooth already running in another window?`
    : `Couldn't start the server: ${e.message}`);
});

// Save any pending analytics before exiting
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => { db.flush(); process.exit(0); });
