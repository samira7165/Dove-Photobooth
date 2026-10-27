/* ─────────────────────────────────────────────────────────────
   Download page: guest enters the code from the booth,
   the photo is fetched from server.js and offered as a download.
   Also works as a link: /download?code=R86F2U
   ───────────────────────────────────────────────────────────── */

const CODE_LENGTH = 6;

const $ = (id) => document.getElementById(id);
const els = {
  form: $("findForm"), input: $("codeInput"), findBtn: $("findBtn"),
  msg: $("msg"), found: $("found"), photo: $("photo"), downloadLink: $("downloadLink"),
};

let photoUrl = null;
let foundCode = null;

// Analytics for the admin dashboard; never blocks or breaks the page
function track(type, code) {
  fetch("api/track", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type, code }), keepalive: true,
  }).catch(() => {});
}

// Upper-case and drop spaces/dashes people sometimes type
const clean = (s) => s.toUpperCase().replace(/[\s-]/g, "");

function showMessage(text, isError) {
  els.msg.textContent = text;
  els.msg.classList.toggle("is-error", !!isError);
}

async function find(code) {
  els.found.hidden = true;
  if (code.length !== CODE_LENGTH) {
    showMessage(`Codes are ${CODE_LENGTH} characters long. Check the code and try again.`, true);
    return;
  }

  els.findBtn.disabled = true;
  showMessage("Looking for your photo…");
  try {
    const r = await fetch("api/photos/" + encodeURIComponent(code));
    if (r.status === 404) {
      showMessage(`No photo found for ${code}. Check the code and try again.`, true);
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(await r.blob());
    els.photo.src = photoUrl;
    els.downloadLink.href = photoUrl;
    els.downloadLink.download = `dove-times-${code}.jpg`;
    foundCode = code;
    els.found.hidden = false;
    showMessage("");
    history.replaceState(null, "", "?code=" + code);
  } catch (e) {
    console.error(e);
    showMessage("Couldn't reach the photo desk. Check you're on the event Wi-Fi and try again.", true);
  } finally {
    els.findBtn.disabled = false;
  }
}

els.input.addEventListener("input", () => {
  const v = clean(els.input.value);
  if (v !== els.input.value) els.input.value = v;
});

els.form.addEventListener("submit", (e) => {
  e.preventDefault();
  find(clean(els.input.value));
});

els.downloadLink.addEventListener("click", () => track("download", foundCode));
track("visit");

// /download?code=XXXXXX opens straight to the photo
const fromLink = new URLSearchParams(location.search).get("code");
if (fromLink) {
  els.input.value = clean(fromLink);
  find(els.input.value);
}
