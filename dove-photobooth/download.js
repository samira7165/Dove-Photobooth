/* ─────────────────────────────────────────────────────────────
   Download page: guest enters the code from the booth,
   the photo is fetched from server.js and offered as a download.
   The booth's QR code opens it as a link: /download?code=482915
   ───────────────────────────────────────────────────────────── */

const CODE_LENGTH = 6;

const $ = (id) => document.getElementById(id);
const els = {
  form: $("findForm"), input: $("codeInput"), findBtn: $("findBtn"),
  msg: $("msg"), found: $("found"), photo: $("photo"), downloadLink: $("downloadLink"),
};

let photoUrl = null;

// Upper-case and drop spaces/dashes people sometimes type
const clean = (s) => s.toUpperCase().replace(/[\s-]/g, "");

function showMessage(text, isError) {
  els.msg.textContent = text;
  els.msg.classList.toggle("is-error", !!isError);
}

async function find(code) {
  els.found.hidden = true;
  if (code.length !== CODE_LENGTH) {
    showMessage(`Codes are ${CODE_LENGTH} digits long. Check the code and try again.`, true);
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
    if (r.status === 429) {
      showMessage("Too many wrong codes. Wait 10 minutes, then try again.", true);
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);

    if (photoUrl) URL.revokeObjectURL(photoUrl);
    photoUrl = URL.createObjectURL(await r.blob());
    els.photo.src = photoUrl;
    els.downloadLink.href = photoUrl;
    els.downloadLink.download = `dove-times-${code}.jpg`;
    els.found.hidden = false;
    showMessage("");
    history.replaceState(null, "", "?code=" + code);
  } catch (e) {
    console.error(e);
    showMessage("Couldn't reach the photo desk. Check your internet or Wi-Fi connection and try again.", true);
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

// /download?code=XXXXXX (the booth's QR code) opens straight to the photo
const fromLink = new URLSearchParams(location.search).get("code");
if (fromLink) {
  els.input.value = clean(fromLink);
  find(els.input.value);
}
