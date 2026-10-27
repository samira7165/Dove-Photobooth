/* ─────────────────────────────────────────────────────────────
   The Dove Times Photobooth
   1. Loads a frame PNG and finds its transparent "window".
   2. Shows the live camera inside that window.
   3. On capture: draws the photo into the window, puts the frame on top,
      and offers Download + Print.
   ───────────────────────────────────────────────────────────── */

const CONFIG = {
  defaultFrame: "frames/dove-times-frame.png",
  countdownSeconds: 3,
  fileNamePrefix: "dove-times",
  jpegQuality: 0.95,
  alphaThreshold: 20,       // pixels with alpha below this count as "window"
  cameraIdeal: { width: 1920, height: 1080 },
};

const $ = (id) => document.getElementById(id);
const els = {
  stage: $("stage"), hole: $("hole"), video: $("video"), camMsg: $("camMsg"),
  frameImg: $("frameImg"), resultImg: $("resultImg"),
  countdown: $("countdown"), flash: $("flash"),
  shootPanel: $("shootPanel"), resultPanel: $("resultPanel"),
  captureBtn: $("captureBtn"), photoInput: $("photoInput"),
  downloadBtn: $("downloadBtn"), printBtn: $("printBtn"), retakeBtn: $("retakeBtn"),
  frameInput: $("frameInput"), resetFrameBtn: $("resetFrameBtn"),
  mirrorChk: $("mirrorChk"), frameInfo: $("frameInfo"),
  printImg: $("printImg"), work: $("work"), fullscreenBtn: $("fullscreenBtn"),
};

const state = {
  frame: null,        // { img, w, h, hole: {x,y,w,h} }
  stream: null,
  resultBlob: null,
  resultUrl: null,
  busy: false,
};

/* ── Settings that survive a reload (kiosk convenience) ── */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

/* Uploaded frames are kept in IndexedDB (too big for localStorage) */
const frameDB = {
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("dove-photobooth", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("frames");
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  },
  async put(blob) {
    try {
      const db = await this.open();
      db.transaction("frames", "readwrite").objectStore("frames").put(blob, "custom");
    } catch (e) { console.warn("Could not save frame", e); }
  },
  async get() {
    try {
      const db = await this.open();
      return await new Promise((res) => {
        const r = db.transaction("frames").objectStore("frames").get("custom");
        r.onsuccess = () => res(r.result || null);
        r.onerror = () => res(null);
      });
    } catch { return null; }
  },
  async clear() {
    try {
      const db = await this.open();
      db.transaction("frames", "readwrite").objectStore("frames").delete("custom");
    } catch {}
  },
};

/* ── Frame loading + automatic window detection ── */
function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("Could not load image: " + src));
    img.src = src;
  });
}

// Finds the bounding box of the transparent area in the frame.
function findWindow(img) {
  const c = document.createElement("canvas");
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[row + x * 4 + 3] < CONFIG.alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function setFrame(src, label) {
  const img = await loadImage(src);
  let hole = findWindow(img);
  if (!hole) {
    // No transparent area: put the photo behind the whole frame
    hole = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
    els.frameInfo.textContent = "This frame has no transparent window, so the photo fills the whole page behind it.";
  } else {
    els.frameInfo.textContent =
      `${label}: ${img.naturalWidth}×${img.naturalHeight}px, photo window ${hole.w}×${hole.h}px.`;
  }
  state.frame = { img, w: img.naturalWidth, h: img.naturalHeight, hole };

  // Position the live camera exactly over the window (in % so it scales)
  els.stage.style.setProperty("--ar", `${img.naturalWidth} / ${img.naturalHeight}`);
  Object.assign(els.hole.style, {
    left: (hole.x / img.naturalWidth) * 100 + "%",
    top: (hole.y / img.naturalHeight) * 100 + "%",
    width: (hole.w / img.naturalWidth) * 100 + "%",
    height: (hole.h / img.naturalHeight) * 100 + "%",
  });
  els.frameImg.src = img.src;
}

/* ── Camera ── */
async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showCamMessage("Camera isn't available here. Open this page on https:// or localhost, or upload a photo.");
    return;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: CONFIG.cameraIdeal.width }, height: { ideal: CONFIG.cameraIdeal.height } },
      audio: false,
    });
    els.video.srcObject = state.stream;
    els.camMsg.hidden = true;
    els.captureBtn.disabled = false;
  } catch (e) {
    console.error(e);
    showCamMessage("Camera access was blocked. Allow camera permission in the browser and reload, or upload a photo.");
  }
}
function showCamMessage(msg) {
  els.camMsg.textContent = msg;
  els.camMsg.hidden = false;
  els.captureBtn.disabled = true;
}

/* ── Look options ── */
const tone = () => document.querySelector('input[name="tone"]:checked').value;
const mirror = () => els.mirrorChk.checked;

function applyPreviewStyle() {
  els.video.classList.toggle("mirror", mirror());
  els.video.classList.remove("tone-bw", "tone-sepia");
  if (tone() !== "color") els.video.classList.add("tone-" + tone());
  store.set("tone", tone());
  store.set("mirror", mirror());
}

// Pixel-level tone (works in every browser, unlike ctx.filter on Safari)
function applyTone(ctx, r) {
  const t = tone();
  if (t === "color") return;
  const img = ctx.getImageData(r.x, r.y, r.w, r.h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = Math.max(0, Math.min(255, (g - 128) * 1.08 + 128)); // slight contrast
    if (t === "bw") {
      d[i] = d[i + 1] = d[i + 2] = g;
    } else {
      d[i] = Math.min(255, g * 1.07 + 18);
      d[i + 1] = Math.min(255, g * 0.95 + 10);
      d[i + 2] = Math.min(255, g * 0.78);
    }
  }
  ctx.putImageData(img, r.x, r.y);
}

/* ── Compose: photo into window, frame on top ── */
async function compose(source, srcW, srcH, flip) {
  const { img, w, h, hole } = state.frame;
  const c = els.work;
  c.width = w; c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });

  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);

  // "cover" fit: fill the window, crop the overflow, keep centred
  const scale = Math.max(hole.w / srcW, hole.h / srcH);
  const dw = srcW * scale, dh = srcH * scale;
  const dx = hole.x + (hole.w - dw) / 2;
  const dy = hole.y + (hole.h - dh) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(hole.x, hole.y, hole.w, hole.h);
  ctx.clip();
  if (flip) {
    ctx.translate(hole.x * 2 + hole.w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(source, dx, dy, dw, dh);
  ctx.restore();

  applyTone(ctx, hole);
  ctx.drawImage(img, 0, 0, w, h);

  const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", CONFIG.jpegQuality));
  showResult(blob);
}

function showResult(blob) {
  if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
  state.resultBlob = blob;
  state.resultUrl = URL.createObjectURL(blob);
  els.resultImg.src = state.resultUrl;
  els.printImg.src = state.resultUrl;
  els.resultImg.hidden = false;
  els.shootPanel.hidden = true;
  els.resultPanel.hidden = false;
}

function retake() {
  els.resultImg.hidden = true;
  els.resultPanel.hidden = true;
  els.shootPanel.hidden = false;
  els.photoInput.value = "";
  els.captureBtn.focus();
}

/* ── Countdown + capture ── */
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture() {
  if (state.busy || !state.stream || !state.frame) return;
  state.busy = true;
  els.captureBtn.disabled = true;

  els.countdown.hidden = false;
  for (let n = CONFIG.countdownSeconds; n > 0; n--) {
    els.countdown.textContent = n;
    els.countdown.classList.remove("pop"); void els.countdown.offsetWidth; els.countdown.classList.add("pop");
    await wait(1000);
  }
  els.countdown.hidden = true;

  els.flash.classList.remove("go"); void els.flash.offsetWidth; els.flash.classList.add("go");
  const v = els.video;
  await compose(v, v.videoWidth, v.videoHeight, mirror());

  els.captureBtn.disabled = false;
  state.busy = false;
}

async function useUploadedPhoto(file) {
  if (!file || !state.frame) return;
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    await compose(img, img.naturalWidth, img.naturalHeight, false);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ── Download + print ── */
function download() {
  if (!state.resultBlob) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const a = document.createElement("a");
  a.href = state.resultUrl;
  a.download = `${CONFIG.fileNamePrefix}-${stamp}.jpg`;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function print() {
  if (!state.resultUrl) return;
  if (!els.printImg.complete) await new Promise((r) => (els.printImg.onload = r));
  window.print();
}

/* ── Frame upload (admin) ── */
async function onFrameUpload(file) {
  if (!file) return;
  if (file.type !== "image/png") {
    els.frameInfo.textContent = "Please upload a PNG. JPG files can't have a transparent window.";
    return;
  }
  const url = URL.createObjectURL(file);
  await setFrame(url, "Custom frame");
  await frameDB.put(file);
  els.frameInput.value = "";
}

async function resetFrame() {
  await frameDB.clear();
  await setFrame(CONFIG.defaultFrame, "Default frame");
}

/* ── Boot ── */
async function init() {
  els.captureBtn.disabled = true;

  // restore look settings
  const savedTone = store.get("tone", "bw");
  const radio = document.querySelector(`input[name="tone"][value="${savedTone}"]`);
  if (radio) radio.checked = true;
  els.mirrorChk.checked = store.get("mirror", true);
  applyPreviewStyle();

  // load custom frame if one was uploaded before, otherwise the default
  const saved = await frameDB.get();
  try {
    if (saved) await setFrame(URL.createObjectURL(saved), "Custom frame");
    else await setFrame(CONFIG.defaultFrame, "Default frame");
  } catch (e) {
    console.error(e);
    els.frameInfo.textContent = "Couldn't load the frame. Run the page from a local server (see README).";
  }

  await startCamera();

  els.captureBtn.addEventListener("click", capture);
  els.retakeBtn.addEventListener("click", retake);
  els.downloadBtn.addEventListener("click", download);
  els.printBtn.addEventListener("click", print);
  els.photoInput.addEventListener("change", (e) => useUploadedPhoto(e.target.files[0]));
  els.frameInput.addEventListener("change", (e) => onFrameUpload(e.target.files[0]));
  els.resetFrameBtn.addEventListener("click", resetFrame);
  els.mirrorChk.addEventListener("change", applyPreviewStyle);
  document.querySelectorAll('input[name="tone"]').forEach((r) => r.addEventListener("change", applyPreviewStyle));

  // Kiosk shortcut: Space or Enter takes the photo
  document.addEventListener("keydown", (e) => {
    if ((e.code === "Space" || e.code === "Enter") && !els.shootPanel.hidden &&
        !["INPUT", "BUTTON", "SUMMARY"].includes(document.activeElement.tagName)) {
      e.preventDefault();
      capture();
    }
  });
}

// Full screen toggle. Wired up before init() so it works while the camera prompt is open.
// Hidden where the browser doesn't support it (e.g. iPhone Safari).
function setupFullscreen() {
  if (!document.fullscreenEnabled) { els.fullscreenBtn.hidden = true; return; }
  const sync = () => {
    els.fullscreenBtn.textContent = document.fullscreenElement ? "Exit full screen" : "Full screen";
  };
  els.fullscreenBtn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => {});
  });
  document.addEventListener("fullscreenchange", sync);
}

setupFullscreen();
init();
