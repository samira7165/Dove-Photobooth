/* ─────────────────────────────────────────────────────────────
   The Dove Times Photobooth
   1. Loads a frame PNG and finds its transparent "window".
   2. Shows the live camera inside that window.
   3. On capture: draws the photo into the window, puts the frame on top,
      uploads it to server.js (which hands back a code), and offers Print.
      Guests enter the code on /download to get their photo.
   ───────────────────────────────────────────────────────────── */

const CONFIG = {
  frame: "frames/dove-times-frame.png",
  countdownSeconds: 3,
  tone: "bw",               // "bw", "sepia" or "color"
  mirror: true,             // selfie view: flip the camera like a mirror
  jpegQuality: 0.95,
  alphaThreshold: 20,       // pixels with alpha below this count as "window"
  cameraIdeal: { width: 1920, height: 1080 },
  // Address shown to guests for the download page. Leave empty to use the
  // Wi-Fi address server.js reports (falls back to this page's own address).
  downloadUrl: "",
};

const $ = (id) => document.getElementById(id);
const els = {
  booth: $("booth"), stage: $("stage"), hole: $("hole"), video: $("video"), camMsg: $("camMsg"),
  frameImg: $("frameImg"), resultImg: $("resultImg"),
  countdown: $("countdown"), flash: $("flash"),
  shootPanel: $("shootPanel"), resultPanel: $("resultPanel"),
  captureBtn: $("captureBtn"), printBtn: $("printBtn"), retakeBtn: $("retakeBtn"),
  photoCode: $("photoCode"), codeHelp: $("codeHelp"), codeError: $("codeError"), downloadUrl: $("downloadUrl"),
  printImg: $("printImg"), work: $("work"),
};

const state = {
  frame: null,        // { img, w, h, hole: {x,y,w,h} }
  stream: null,
  resultUrl: null,
  shot: 0,            // bumps on every photo, so a slow upload can't show a code on the next one
  busy: false,
};

/* ── Saving photos for download (server.js) ── */
async function uploadPhoto(blob) {
  const r = await fetch("api/photos", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: blob });
  if (!r.ok) throw new Error("Upload failed: " + r.status);
  return (await r.json()).code;
}

async function setDownloadUrl() {
  let base = CONFIG.downloadUrl;
  if (!base) {
    // Hosted online: this site's own address works for guests anywhere.
    // Running on a laptop (localhost): use its Wi-Fi address instead.
    base = location.origin;
    if (["localhost", "127.0.0.1"].includes(location.hostname)) {
      try {
        const info = await (await fetch("api/info")).json();
        if (info.lan?.length) base = info.lan[0];
      } catch {}
    }
    base += "/download";
  }
  els.downloadUrl.textContent = base.replace(/^https?:\/\//, "");
}

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

async function setFrame(src) {
  const img = await loadImage(src);
  // No transparent area: put the photo behind the whole frame
  const hole = findWindow(img) || { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
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
    showCamMessage("Camera isn't available here. Open this page on https:// or localhost.");
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
    showCamMessage("Camera access was blocked. Allow camera permission in the browser and reload.");
  }
}
function showCamMessage(msg) {
  els.camMsg.textContent = msg;
  els.camMsg.hidden = false;
  els.captureBtn.disabled = true;
}

/* ── Look ── */
function applyPreviewStyle() {
  els.video.classList.toggle("mirror", CONFIG.mirror);
  if (CONFIG.tone !== "color") els.video.classList.add("tone-" + CONFIG.tone);
}

// Pixel-level tone (works in every browser, unlike ctx.filter on Safari)
function applyTone(ctx, r) {
  const t = CONFIG.tone;
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
  state.resultUrl = URL.createObjectURL(blob);
  els.resultImg.src = state.resultUrl;
  els.printImg.src = state.resultUrl;
  els.resultImg.hidden = false;
  els.shootPanel.hidden = true;
  els.resultPanel.hidden = false;
  els.booth.classList.add("is-result");   // shrinks the template to make room

  els.photoCode.textContent = "······";
  els.codeHelp.hidden = false;
  els.codeError.hidden = true;
  const shot = ++state.shot;
  uploadPhoto(blob).then(
    (code) => { if (shot === state.shot) els.photoCode.textContent = code; },
    (e) => {
      console.error(e);
      if (shot !== state.shot) return;
      els.photoCode.textContent = "—";
      els.codeHelp.hidden = true;
      els.codeError.hidden = false;
    },
  );
}

function retake() {
  els.resultImg.hidden = true;
  els.resultPanel.hidden = true;
  els.shootPanel.hidden = false;
  els.booth.classList.remove("is-result");
  state.shot++;
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
  await compose(v, v.videoWidth, v.videoHeight, CONFIG.mirror);

  els.captureBtn.disabled = false;
  state.busy = false;
}

/* ── Print ── */
async function print() {
  if (!state.resultUrl) return;
  if (!els.printImg.complete) await new Promise((r) => (els.printImg.onload = r));
  window.print();
}

/* ── Boot ── */
async function init() {
  els.captureBtn.disabled = true;
  applyPreviewStyle();
  setDownloadUrl();

  try {
    await setFrame(CONFIG.frame);
  } catch (e) {
    console.error(e);
    showCamMessage("Couldn't load the frame. Run the page from a local server (see README).");
    return;
  }

  await startCamera();

  els.captureBtn.addEventListener("click", capture);
  els.retakeBtn.addEventListener("click", retake);
  els.printBtn.addEventListener("click", print);

  // Kiosk shortcut: Space or Enter takes the photo
  document.addEventListener("keydown", (e) => {
    if ((e.code === "Space" || e.code === "Enter") && !els.shootPanel.hidden &&
        document.activeElement.tagName !== "BUTTON") {
      e.preventDefault();
      capture();
    }
  });
}

init();
