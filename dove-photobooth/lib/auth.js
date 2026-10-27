/* ─────────────────────────────────────────────────────────────
   Admin users, roles and login sessions.
   Users live in DATA_DIR/users.json with scrypt-hashed passwords.

   Roles (each includes everything below it):
     admin   manage users, delete photos
     staff   see submissions, download photos and data
     viewer  see analytics only
   ───────────────────────────────────────────────────────────── */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROLES = ["viewer", "staff", "admin"];
const SESSION_MS = 12 * 60 * 60 * 1000;          // 12 hours
const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;    // 5 wrong passwords → 5 minute lock
const USERNAME_RE = /^[a-z0-9._-]{3,32}$/;
const MIN_PASSWORD = 8;

const roleAtLeast = (role, needed) => ROLES.indexOf(role) >= ROLES.indexOf(needed);

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(user.hash, "hex"));
}

function createAuth(dataDir) {
  const file = path.join(dataDir, "users.json");
  let users = [];
  try { users = JSON.parse(fs.readFileSync(file, "utf8")).users || []; } catch {}

  const save = () => {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify({ users }, null, 2));
    fs.renameSync(tmp, file);
  };

  const sessions = new Map();   // token → { username, expires }
  const fails = new Map();      // ip → { count, until }

  const find = (username) => users.find((u) => u.username === username);
  const publicUser = (u) => ({ username: u.username, role: u.role, createdAt: u.createdAt });
  const adminCount = () => users.filter((u) => u.role === "admin").length;

  function validate(username, password, role) {
    if (username !== undefined && !USERNAME_RE.test(username)) {
      return "Username must be 3–32 characters: lowercase letters, numbers, dot, dash or underscore.";
    }
    if (password !== undefined && (typeof password !== "string" || password.length < MIN_PASSWORD)) {
      return `Password must be at least ${MIN_PASSWORD} characters.`;
    }
    if (role !== undefined && !ROLES.includes(role)) return "Unknown role.";
    return null;
  }

  // First run: create an admin so someone can log in
  function ensureAdmin() {
    if (users.length) return null;
    const username = (process.env.ADMIN_USER || "admin").toLowerCase();
    const password = process.env.ADMIN_PASSWORD || crypto.randomBytes(9).toString("base64url");
    users.push({ username, role: "admin", ...hashPassword(password), createdAt: Date.now() });
    save();
    return { username, password, generated: !process.env.ADMIN_PASSWORD };
  }

  return {
    ROLES,
    roleAtLeast,
    ensureAdmin,

    login(ip, username, password) {
      const f = fails.get(ip);
      if (f && f.until > Date.now()) return { error: "Too many attempts. Try again in a few minutes.", status: 429 };
      const user = find(String(username || "").toLowerCase());
      if (!user || !checkPassword(user, String(password || ""))) {
        const next = { count: (f && f.until > Date.now() ? 0 : f?.count || 0) + 1, until: 0 };
        if (next.count >= MAX_FAILS) { next.until = Date.now() + LOCK_MS; next.count = 0; }
        fails.set(ip, next);
        return { error: "Wrong username or password.", status: 401 };
      }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString("base64url");
      sessions.set(token, { username: user.username, expires: Date.now() + SESSION_MS });
      return { token, user: publicUser(user) };
    },

    logout(token) { sessions.delete(token); },

    // Current user for a session token (role read fresh, so changes apply at once)
    userFor(token) {
      const s = token && sessions.get(token);
      if (!s) return null;
      if (s.expires < Date.now()) { sessions.delete(token); return null; }
      const user = find(s.username);
      if (!user) { sessions.delete(token); return null; }
      return publicUser(user);
    },

    listUsers: () => users.map(publicUser),

    createUser({ username, password, role }) {
      username = String(username || "").toLowerCase();
      const err = validate(username, password, role);
      if (err) return { error: err };
      if (find(username)) return { error: "That username is taken." };
      users.push({ username, role, ...hashPassword(password), createdAt: Date.now() });
      save();
      return { user: publicUser(find(username)) };
    },

    updateUser(username, { role, password }) {
      const user = find(username);
      if (!user) return { error: "No such user.", status: 404 };
      const err = validate(undefined, password, role);
      if (err) return { error: err };
      if (role && role !== "admin" && user.role === "admin" && adminCount() === 1) {
        return { error: "There must be at least one admin." };
      }
      if (role) user.role = role;
      if (password) {
        Object.assign(user, hashPassword(password));
        // Log out their other sessions after a password change
        for (const [t, s] of sessions) if (s.username === username) sessions.delete(t);
      }
      save();
      return { user: publicUser(user) };
    },

    changeOwnPassword(username, current, next) {
      const user = find(username);
      if (!user || !checkPassword(user, String(current || ""))) return { error: "Current password is wrong." };
      const err = validate(undefined, next);
      if (err) return { error: err };
      Object.assign(user, hashPassword(next));
      save();
      return { ok: true };
    },

    deleteUser(username, by) {
      const user = find(username);
      if (!user) return { error: "No such user.", status: 404 };
      if (username === by) return { error: "You can't delete your own account." };
      if (user.role === "admin" && adminCount() === 1) return { error: "There must be at least one admin." };
      users = users.filter((u) => u !== user);
      for (const [t, s] of sessions) if (s.username === username) sessions.delete(t);
      save();
      return { ok: true };
    },
  };
}

module.exports = { createAuth, ROLES };
