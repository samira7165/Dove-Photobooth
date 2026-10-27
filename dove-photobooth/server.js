/* ─────────────────────────────────────────────────────────────
   The Dove Times Photobooth server
   - Serves the booth (index.html) and the download page (download.html).
   - POST /api/photos      saves a photo, returns { code }
   - GET  /api/photos/CODE returns that photo as a JPG
   - GET  /api/info        returns the address guests can open on their phones
   Run:  node server.js     (no npm install needed)
   ───────────────────────────────────────────────────────────── */

const http = require("node:http");
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT) || 8000;
const ROOT = __dirname;
// On a host, point PHOTOS_DIR at a persistent disk/volume so photos survive restarts
const PHOTOS = path.resolve(process.env.PHOTOS_DIR || path.join(ROOT, "photos"));
const MAX_UPLOAD = 25 * 1024 * 1024; // 25 MB
const CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O or 1/I
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

fs.mkdirSync(PHOTOS, { recursive: true });

const photoPath = (code) => path.join(PHOTOS, code + ".jpg");

function newCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(CODE_LENGTH), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  } while (fs.existsSync(photoPath(code)));
  return code;
}

// Wi-Fi / LAN addresses, so guests' phones can reach the download page
// Wi-Fi first; virtual adapters (VirtualBox's 192.168.56.x, WSL, Docker…) last,
// since phones can't reach those.
function lanUrls() {
  const virtual = /virtual|vbox|vmware|vethernet|hyper-v|wsl|docker/i;
  const rank = ({ name, address }) =>
    /wi-?fi|wlan|wireless/i.test(name) ? 0 :
    virtual.test(name) || address.startsWith("192.168.56.") ? 2 : 1;
  return Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => addrs.map((a) => ({ ...a, name })))
    .filter((a) => a.family === "IPv4" && !a.internal)
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => `http://${a.address}:${PORT}`);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_UPLOAD) { reject(new Error("too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "POST" && url.pathname === "/api/photos") {
    let body;
    try { body = await readBody(req); } catch { return send(res, 413, { error: "Photo is too large." }); }
    // Must be a JPEG (starts with FF D8 FF)
    if (body.length < 3 || body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff) {
      return send(res, 400, { error: "Expected a JPG photo." });
    }
    const code = newCode();
    await fsp.writeFile(photoPath(code), body);
    console.log(`Saved photo ${code}`);
    return send(res, 201, { code });
  }

  const m = url.pathname.match(/^\/api\/photos\/([^/]+)$/);
  if (req.method === "GET" && m) {
    const code = decodeURIComponent(m[1]).toUpperCase();
    if (!CODE_RE.test(code)) return send(res, 404, { error: "Not found." });
    try {
      const data = await fsp.readFile(photoPath(code));
      return send(res, 200, data, "image/jpeg");
    } catch {
      return send(res, 404, { error: "Not found." });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/info") {
    return send(res, 200, { lan: lanUrls() });
  }

  return send(res, 404, { error: "Not found." });
}

async function handleStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", "text/plain");
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  else if (!path.extname(rel)) rel += ".html";   // clean URLs: /download → download.html
  const file = path.normalize(path.join(ROOT, rel));
  // Stay inside the app folder, and keep saved photos and server code private
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(PHOTOS + path.sep) || file === __filename) {
    return send(res, 404, "Not found", "text/plain");
  }
  try {
    const data = await fsp.readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    send(res, 404, "Not found", "text/plain");
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await handleApi(req, res, url);
    else await handleStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) send(res, 500, { error: "Server error." });
  }
}).listen(PORT, () => {
  console.log(`\nPhotobooth (this computer):  http://localhost:${PORT}`);
  console.log(`Download page:               http://localhost:${PORT}/download`);
  for (const u of lanUrls()) console.log(`Download page (Wi-Fi):       ${u}/download`);
  console.log(`Photos are saved in: ${PHOTOS}\n`);
});
