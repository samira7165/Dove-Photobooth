/* ─────────────────────────────────────────────────────────────
   Admin dashboard: login, analytics, submissions, users.
   What each role sees is enforced by server.js; this page only
   hides what the role can't use.
   ───────────────────────────────────────────────────────────── */

const PAGE_SIZE = 24;
const ROLES = ["viewer", "staff", "admin"];

const $ = (id) => document.getElementById(id);
const els = {
  loginView: $("loginView"), loginForm: $("loginForm"), loginMsg: $("loginMsg"),
  dashView: $("dashView"), who: $("who"), whoRole: $("whoRole"),
  logoutBtn: $("logoutBtn"), pwBtn: $("pwBtn"), refreshBtn: $("refreshBtn"),
  rangeSeg: $("rangeSeg"), tiles: $("tiles"),
  dayChart: $("dayChart"), dayChartSub: $("dayChartSub"), dayTable: $("dayTable"),
  hourChart: $("hourChart"), hourTable: $("hourTable"), tooltip: $("tooltip"),
  searchInput: $("searchInput"), sortSelect: $("sortSelect"),
  subCount: $("subCount"), photoGrid: $("photoGrid"), pager: $("pager"),
  usersBody: document.querySelector("#usersTable tbody"),
  addUserForm: $("addUserForm"), addUserMsg: $("addUserMsg"),
  pwDialog: $("pwDialog"), pwForm: $("pwForm"), pwMsg: $("pwMsg"), pwCancel: $("pwCancel"),
};

const state = {
  user: null,
  stats: null,
  range: 0,          // days; 0 = all time
  photos: [],
  page: 0,
};

const can = (role) => state.user && ROLES.indexOf(state.user.role) >= ROLES.indexOf(role);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n) => n.toLocaleString();
const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "–");
const fmtDateTime = (ms) => new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const fmtDate = (ms) => new Date(ms).toLocaleDateString([], { day: "numeric", month: "short" });

/* ── API ── */
async function api(path, { method = "GET", body } = {}) {
  const r = await fetch("api/admin/" + path, {
    method,
    headers: { "X-Admin": "1", ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") { showLogin(); throw new Error("logged out"); }
  if (!r.ok) throw Object.assign(new Error(data.error || "Request failed"), { status: r.status });
  return data;
}

/* ── Login / session ── */
function showLogin() {
  state.user = null;
  els.dashView.hidden = true;
  els.loginView.hidden = false;
  $("loginUser").focus();
}

function showDashboard(user) {
  state.user = user;
  els.loginView.hidden = true;
  els.dashView.hidden = false;
  els.who.textContent = user.username;
  els.whoRole.textContent = user.role;
  document.querySelectorAll(".tab[data-role]").forEach((t) => { t.hidden = !can(t.dataset.role); });
  selectTab("overview");
}

els.loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  els.loginMsg.textContent = "";
  try {
    const { user } = await api("login", { method: "POST", body: {
      username: $("loginUser").value.trim(), password: $("loginPass").value,
    } });
    $("loginPass").value = "";
    showDashboard(user);
  } catch (err) {
    els.loginMsg.textContent = err.message;
  }
});

els.logoutBtn.addEventListener("click", async () => {
  try { await api("logout", { method: "POST" }); } catch {}
  showLogin();
});

/* ── Tabs ── */
function selectTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  document.querySelectorAll(".panel-view").forEach((p) => { p.hidden = p.id !== "tab-" + name; });
  if (name === "overview") loadStats();
  if (name === "submissions") loadPhotos();
  if (name === "users") loadUsers();
}
document.querySelectorAll(".tab").forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));

/* ── Overview ── */
const dayKey = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

async function loadStats() {
  try { state.stats = await api("stats"); } catch { return; }
  renderOverview();
}

function renderOverview() {
  const { totals, events } = state.stats;
  const now = Date.now();
  const from = state.range ? startOfDay(now) - (state.range - 1) * 86400000 : 0;
  const inRange = events.filter(([, at]) => at >= from);
  const count = (t) => inRange.reduce((n, [type]) => n + (type === t), 0);

  const photos = count("photo"), prints = count("print"), visits = count("visit");
  const lookups = count("lookup"), fails = count("lookup_fail"), downloads = count("download");
  const tiles = [
    ["Photos taken", fmt(photos), state.range ? "in this period" : "all time"],
    ["Prints", fmt(prints), `${pct(prints, photos)} of photos`],
    ["Download page visits", fmt(visits), ""],
    ["Codes looked up", fmt(lookups), `${fmt(fails)} wrong code${fails === 1 ? "" : "s"}`],
    ["Downloads", fmt(downloads), ""],
    ["Photos downloaded", pct(totals.photosDownloaded, totals.photos),
      `${fmt(totals.photosDownloaded)} of ${fmt(totals.photos)} · all time`],
  ];
  els.tiles.innerHTML = tiles.map(([label, value, sub]) => `
    <div class="tile">
      <p class="tile-label">${esc(label)}</p>
      <p class="tile-value">${esc(value)}</p>
      <p class="tile-sub">${esc(sub)}&nbsp;</p>
    </div>`).join("");

  // Photos per day, every day in the range shown (empty days included)
  const photoTimes = inRange.filter(([t]) => t === "photo").map(([, at]) => at);
  const firstDay = state.range ? from : startOfDay(Math.min(now, ...photoTimes));
  const perDay = new Map();
  for (const at of photoTimes) perDay.set(dayKey(at), (perDay.get(dayKey(at)) || 0) + 1);
  const days = [];
  for (let d = new Date(firstDay); d.getTime() <= now; d.setDate(d.getDate() + 1)) {
    days.push({ label: fmtDate(d.getTime()), value: perDay.get(dayKey(d.getTime())) || 0 });
  }
  els.dayChartSub.textContent = days.length === 1 ? "Today" : `${days[0].label} – ${days.at(-1).label}`;

  const perHour = Array.from({ length: 24 }, (_, h) => ({ label: hourLabel(h), value: 0 }));
  for (const at of photoTimes) perHour[new Date(at).getHours()].value++;

  state.dayData = days;
  state.hourData = perHour;
  drawCharts();
  els.dayTable.innerHTML = dataTable("Day", days);
  els.hourTable.innerHTML = dataTable("Hour", perHour);
}

const hourLabel = (h) => (h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`);

function dataTable(head, rows) {
  return `<table class="table"><thead><tr><th>${head}</th><th class="num">Photos</th></tr></thead><tbody>${
    rows.map((r) => `<tr><td>${esc(r.label)}</td><td class="num">${fmt(r.value)}</td></tr>`).join("")
  }</tbody></table>`;
}

function drawCharts() {
  if (!state.dayData) return;
  barChart(els.dayChart, state.dayData, "photo");
  barChart(els.hourChart, state.hourData, "photo");
}

// Single-series bar chart: thin bars with 4px rounded tops, recessive grid, hover tooltip
function barChart(el, data, unit) {
  const W = Math.max(el.clientWidth, 240), H = 220;
  const m = { top: 8, right: 4, bottom: 24, left: 32 };
  const iw = W - m.left - m.right, ih = H - m.top - m.bottom;
  const max = Math.max(...data.map((d) => d.value));
  const svgNs = 'xmlns="http://www.w3.org/2000/svg"';

  if (!max) {
    el.innerHTML = `<svg ${svgNs} viewBox="0 0 ${W} ${H}" role="img" aria-label="No photos in this period">
      <line class="grid-line" x1="${m.left}" x2="${W - m.right}" y1="${m.top + ih}" y2="${m.top + ih}"/>
      <text class="empty" x="${W / 2}" y="${H / 2}" text-anchor="middle">No photos in this period</text></svg>`;
    return;
  }

  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => m.top + ih - (v / top) * ih;
  const band = iw / data.length;
  const bw = Math.max(2, Math.min(28, band * 0.7));
  const r = Math.min(4, bw / 2);
  const every = Math.ceil(data.length / Math.max(1, Math.floor(iw / 44)));   // label spacing

  let grid = "", bars = "", labels = "";
  for (let v = 0; v <= top; v += step) {
    grid += `<line class="grid-line" x1="${m.left}" x2="${W - m.right}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-text" x="${m.left - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`;
  }
  data.forEach((d, i) => {
    const cx = m.left + band * i + band / 2;
    const x0 = cx - bw / 2, yTop = y(d.value), yBase = m.top + ih;
    if (d.value > 0) {
      const rr = Math.min(r, yBase - yTop);
      bars += `<path class="bar" data-i="${i}" d="M${x0},${yBase} V${yTop + rr} Q${x0},${yTop} ${x0 + rr},${yTop}
        H${x0 + bw - rr} Q${x0 + bw},${yTop} ${x0 + bw},${yTop + rr} V${yBase} Z"/>`;
    }
    // Hit target: the whole column, bigger than the bar
    bars += `<rect class="hit" data-i="${i}" x="${m.left + band * i}" y="${m.top}" width="${band}" height="${ih}"/>`;
    if (i % every === 0) labels += `<text class="axis-text" x="${cx}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>`;
  });

  el.innerHTML = `<svg ${svgNs} viewBox="0 0 ${W} ${H}" role="img"
    aria-label="Bar chart, ${data.length} bars, highest ${fmt(max)}">${grid}${bars}${labels}</svg>`;

  el.querySelectorAll(".hit").forEach((hit) => {
    const i = +hit.dataset.i, d = data[i];
    const bar = el.querySelector(`.bar[data-i="${i}"]`);
    hit.addEventListener("mouseenter", () => {
      bar?.classList.add("is-hover");
      const box = hit.getBoundingClientRect();
      const barTop = bar ? bar.getBoundingClientRect().top : box.bottom;
      els.tooltip.innerHTML = `${esc(d.label)}<br><strong>${fmt(d.value)}</strong> ${unit}${d.value === 1 ? "" : "s"}`;
      els.tooltip.style.left = box.left + box.width / 2 + "px";
      els.tooltip.style.top = barTop + "px";
      els.tooltip.hidden = false;
    });
    hit.addEventListener("mouseleave", () => { bar?.classList.remove("is-hover"); els.tooltip.hidden = true; });
  });
}

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const n = raw / pow;
  return Math.max(1, (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow);
}

els.rangeSeg.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-range]");
  if (!b) return;
  els.rangeSeg.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  state.range = +b.dataset.range;
  if (state.stats) renderOverview();
});
els.refreshBtn.addEventListener("click", loadStats);

let resizeTimer;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(drawCharts, 150); });

/* ── Submissions ── */
async function loadPhotos() {
  try { state.photos = (await api("photos")).photos; } catch { return; }
  state.page = 0;
  renderPhotos();
}

function filteredPhotos() {
  const q = els.searchInput.value.trim().toUpperCase();
  let list = q ? state.photos.filter((p) => p.code.includes(q)) : [...state.photos];
  switch (els.sortSelect.value) {
    case "old": list.sort((a, b) => a.createdAt - b.createdAt); break;
    case "downloads": list.sort((a, b) => b.downloads - a.downloads || b.createdAt - a.createdAt); break;
    case "notdl": list = list.filter((p) => !p.downloads); break;
  }
  return list;
}

function renderPhotos() {
  const list = filteredPhotos();
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages - 1);
  const shown = list.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);

  els.subCount.textContent = `${fmt(list.length)} photo${list.length === 1 ? "" : "s"}` +
    (list.length !== state.photos.length ? ` (of ${fmt(state.photos.length)})` : "");

  els.photoGrid.innerHTML = shown.length ? shown.map((p) => {
    const img = `api/admin/photos/${p.code}/image`;
    return `<article class="shot">
      <a class="thumb" href="${img}" target="_blank" rel="noopener" title="Open full size">
        <img src="${img}" alt="Photo ${p.code}" loading="lazy"></a>
      <div class="shot-body">
        <span class="shot-code">${esc(p.code)}</span>
        <span class="shot-meta">${esc(fmtDateTime(p.createdAt))}</span>
        <span class="shot-stats">
          <span title="Times the code was looked up">${fmt(p.views)} lookups</span>
          <span>${fmt(p.downloads)} downloads</span>
          <span>${fmt(p.prints)} prints</span>
        </span>
        <span class="shot-actions">
          <a class="link-btn" href="${img}?download">Download</a>
          ${can("admin") ? `<button class="link-btn danger" type="button" data-delete="${esc(p.code)}">Delete</button>` : ""}
        </span>
      </div>
    </article>`;
  }).join("") : `<p class="empty-state">No photos${els.searchInput.value ? " match that code" : " yet"}.</p>`;

  els.pager.innerHTML = pages > 1 ? `
    <button class="link-btn" type="button" data-page="-1" ${state.page === 0 ? "disabled" : ""}>← Newer</button>
    <span>Page ${state.page + 1} of ${pages}</span>
    <button class="link-btn" type="button" data-page="1" ${state.page >= pages - 1 ? "disabled" : ""}>Older →</button>` : "";
}

els.searchInput.addEventListener("input", () => { state.page = 0; renderPhotos(); });
els.sortSelect.addEventListener("change", () => { state.page = 0; renderPhotos(); });
els.pager.addEventListener("click", (e) => {
  const b = e.target.closest("[data-page]");
  if (!b || b.disabled) return;
  state.page += +b.dataset.page;
  renderPhotos();
  els.photoGrid.scrollIntoView({ block: "start" });
});
els.photoGrid.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-delete]");
  if (!b) return;
  const code = b.dataset.delete;
  if (!confirm(`Delete photo ${code}? The guest will no longer be able to download it. This can't be undone.`)) return;
  try {
    await api("photos/" + code, { method: "DELETE" });
    state.photos = state.photos.filter((p) => p.code !== code);
    renderPhotos();
  } catch (err) { alert(err.message); }
});

/* ── Users ── */
async function loadUsers() {
  let users;
  try { users = (await api("users")).users; } catch { return; }
  els.usersBody.innerHTML = users.map((u) => {
    const me = u.username === state.user.username;
    return `<tr data-user="${esc(u.username)}">
      <td>${esc(u.username)}${me ? '<span class="you">(you)</span>' : ""}</td>
      <td><select data-role-for="${esc(u.username)}" ${me ? "disabled title=\"You can't change your own role\"" : ""} aria-label="Role for ${esc(u.username)}">
        ${ROLES.map((r) => `<option value="${r}" ${r === u.role ? "selected" : ""}>${r}</option>`).join("")}
      </select></td>
      <td>${esc(fmtDate(u.createdAt))}</td>
      <td class="num">
        <button class="link-btn" type="button" data-reset="${esc(u.username)}">Reset password</button>
        ${me ? "" : `<button class="link-btn danger" type="button" data-remove="${esc(u.username)}">Remove</button>`}
      </td>
    </tr>`;
  }).join("");
}

els.usersBody.addEventListener("change", async (e) => {
  const sel = e.target.closest("[data-role-for]");
  if (!sel) return;
  try { await api("users/" + encodeURIComponent(sel.dataset.roleFor), { method: "PATCH", body: { role: sel.value } }); }
  catch (err) { alert(err.message); }
  loadUsers();
});

els.usersBody.addEventListener("click", async (e) => {
  const reset = e.target.closest("[data-reset]");
  const remove = e.target.closest("[data-remove]");
  try {
    if (reset) {
      const name = reset.dataset.reset;
      const password = prompt(`New password for ${name} (at least 8 characters):`);
      if (!password) return;
      await api("users/" + encodeURIComponent(name), { method: "PATCH", body: { password } });
      alert(`Password for ${name} changed. They'll need to log in again.`);
    }
    if (remove) {
      const name = remove.dataset.remove;
      if (!confirm(`Remove ${name}? They'll lose access to the dashboard immediately.`)) return;
      await api("users/" + encodeURIComponent(name), { method: "DELETE" });
      loadUsers();
    }
  } catch (err) { alert(err.message); }
});

els.addUserForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(els.addUserForm);
  els.addUserMsg.className = "form-msg";
  try {
    await api("users", { method: "POST", body: Object.fromEntries(f) });
    els.addUserMsg.textContent = `Added ${f.get("username").toLowerCase()}.`;
    els.addUserMsg.classList.add("is-ok");
    els.addUserForm.reset();
    loadUsers();
  } catch (err) {
    els.addUserMsg.textContent = err.message;
    els.addUserMsg.classList.add("is-error");
  }
});

/* ── Change own password ── */
els.pwBtn.addEventListener("click", () => {
  els.pwForm.reset();
  els.pwMsg.textContent = "";
  els.pwDialog.showModal();
});
els.pwCancel.addEventListener("click", () => els.pwDialog.close());
els.pwForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = new FormData(els.pwForm);
  els.pwMsg.className = "form-msg";
  try {
    await api("me/password", { method: "POST", body: { current: f.get("current"), next: f.get("next") } });
    els.pwMsg.textContent = "Password changed.";
    els.pwMsg.classList.add("is-ok");
    setTimeout(() => els.pwDialog.close(), 900);
  } catch (err) {
    els.pwMsg.textContent = err.message;
    els.pwMsg.classList.add("is-error");
  }
});

/* ── Boot ── */
(async () => {
  try { showDashboard((await api("me")).user); } catch { showLogin(); }
})();
