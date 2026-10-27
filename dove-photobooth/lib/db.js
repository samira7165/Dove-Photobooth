/* ─────────────────────────────────────────────────────────────
   Submissions + analytics, kept in DATA_DIR/db.json.
   {
     photos: { CODE: { createdAt, views, downloads, prints } },
     events: [ { t: type, c: code|null, at: ms } ]
   }
   Event types: photo, print, visit, lookup, lookup_fail, download
   ───────────────────────────────────────────────────────────── */

const fs = require("node:fs");
const path = require("node:path");

const EVENT_TYPES = ["photo", "print", "visit", "lookup", "lookup_fail", "download"];

function createDb(dataDir, photosDir) {
  const file = path.join(dataDir, "db.json");
  let data = { photos: {}, events: [] };
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  data.photos ||= {};
  data.events ||= [];

  // Photos saved before analytics existed: add them, dated by file time
  for (const name of fs.readdirSync(photosDir)) {
    const code = path.basename(name, ".jpg");
    if (!name.endsWith(".jpg") || data.photos[code]) continue;
    const at = fs.statSync(path.join(photosDir, name)).mtimeMs;
    data.photos[code] = { createdAt: at, views: 0, downloads: 0, prints: 0 };
    data.events.push({ t: "photo", c: code, at });
  }

  let timer = null;
  function saveNow() {
    clearTimeout(timer); timer = null;
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, file);   // atomic, so a crash never leaves half a file
  }
  const save = () => { if (!timer) timer = setTimeout(saveNow, 300); };
  saveNow();

  return {
    EVENT_TYPES,
    flush: () => { if (timer) saveNow(); },

    hasPhoto: (code) => !!data.photos[code],

    addPhoto(code) {
      const at = Date.now();
      data.photos[code] = { createdAt: at, views: 0, downloads: 0, prints: 0 };
      data.events.push({ t: "photo", c: code, at });
      save();
    },

    removePhoto(code) {
      delete data.photos[code];
      save();
    },

    // Records an event and bumps the photo's own counter where there is one
    track(t, code = null) {
      const p = code && data.photos[code];
      if (p) {
        if (t === "lookup") p.views++;
        else if (t === "download") p.downloads++;
        else if (t === "print") p.prints++;
      }
      data.events.push({ t, c: p ? code : null, at: Date.now() });
      save();
    },

    listPhotos() {
      return Object.entries(data.photos)
        .map(([code, p]) => ({ code, ...p }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    stats() {
      const count = (t) => data.events.reduce((n, e) => n + (e.t === t), 0);
      const photos = Object.values(data.photos);
      return {
        totals: {
          photos: photos.length,
          prints: count("print"),
          visits: count("visit"),
          lookups: count("lookup"),
          failedLookups: count("lookup_fail"),
          downloads: count("download"),
          photosDownloaded: photos.filter((p) => p.downloads > 0).length,
        },
        // Compact [type, time] pairs; the dashboard groups them in the viewer's time zone
        events: data.events.map((e) => [e.t, e.at]),
      };
    },
  };
}

module.exports = { createDb };
