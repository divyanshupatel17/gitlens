// IGLens side panel — UI + orchestration. All Instagram requests run in the
// injected agent (ig-agent.js); this file drives it and renders results.
//
// New model: each list (followers / following) is synced independently up to a
// user-defined max, and the reciprocal "mutual" status is verified for ONLY the
// accounts that were loaded — so partial loads are always correct.

const REPO_URL = "https://github.com/itzdivyanshupatel/iglens";
const CHANNEL = "iglens";

const DEFAULTS = { maxLoad: 200, maxActions: 100, delay: 45 };

const TAB_META = {
  followers: { title: "Followers", action: "remove", verb: "Remove" },
  following: { title: "Following", action: "unfollow", verb: "Unfollow" },
};

const state = {
  session: null,
  counts: { followers: null, following: null },
  followers: [], // [{pk, username, full_name, profile_pic_url, mutual:bool|null}]
  following: [],
  incomplete: { followers: false, following: false },
  syncedAt: { followers: null, following: null },
  keep: [],
  settings: { ...DEFAULTS },
  theme: "dark",
  loadMode: "all", // all | non (only load non-mutual)
};

let activeTab = "followers";
let filter = "all"; // all | mutual | non
let igTabId = null;
const syncWaiters = {};
let busy = false;
let actionRunning = false;
const rowByPk = {};

const $ = (id) => document.getElementById(id);
const lc = (u) => (u.username || "").toLowerCase();

/* ---------- storage ---------- */
async function load() {
  const d = await chrome.storage.local.get([
    "session", "counts", "followers", "following", "incomplete",
    "syncedAt", "keep", "settings", "theme", "loadMode",
  ]);
  state.session = d.session || null;
  state.counts = d.counts || { followers: null, following: null };
  state.followers = d.followers || [];
  state.following = d.following || [];
  state.incomplete = d.incomplete || { followers: false, following: false };
  state.syncedAt = d.syncedAt || { followers: null, following: null };
  state.keep = d.keep || [];
  state.settings = { ...DEFAULTS, ...(d.settings || {}) };
  state.theme = d.theme || "dark";
  state.loadMode = d.loadMode || "all";
}
function save() {
  chrome.storage.local.set({
    session: state.session, counts: state.counts,
    followers: state.followers, following: state.following,
    incomplete: state.incomplete, syncedAt: state.syncedAt,
    keep: state.keep, settings: state.settings, theme: state.theme, loadMode: state.loadMode,
  });
}

/* ---------- agent plumbing ---------- */
async function findIgTab() {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && active.url && active.url.startsWith("https://www.instagram.com")) return active;
  const tabs = await chrome.tabs.query({ url: "https://www.instagram.com/*" });
  return tabs[0] || null;
}
async function injectAgent(tabId) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ["ig-agent.js"] });
}
function sendToAgent(tabId, msg) {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, { channel: CHANNEL, ...msg }, (resp) => {
      resolve(chrome.runtime.lastError ? null : resp);
    });
  });
}
// Resolves on syncDone; rejects on syncError or a 60s silence (watchdog).
function syncAwait(tabId, list, max, mode) {
  return new Promise((resolve, reject) => {
    const w = {};
    const arm = () => {
      clearTimeout(w.timer);
      w.timer = setTimeout(() => { delete syncWaiters[list]; reject(new Error("Timed out — please retry.")); }, 90000);
    };
    w.resolve = (v) => { clearTimeout(w.timer); resolve(v); };
    w.reject = (e) => { clearTimeout(w.timer); reject(e); };
    w.arm = arm;
    syncWaiters[list] = w;
    arm();
    sendToAgent(tabId, { cmd: "sync", list, max, mode });
  });
}

/* ---------- status ---------- */
function setStatus(kind, text) {
  $("statusDot").className = "dot " + (kind === "ok" ? "dot-ok" : kind === "bad" ? "dot-bad" : "dot-idle");
  $("statusText").textContent = text;
}
function renderAccount() {
  const row = $("accountRow");
  if (state.session && state.session.username) {
    row.hidden = false;
    $("accountName").textContent = state.session.username;
    const t = state.syncedAt.followers || state.syncedAt.following;
    $("lastSync").textContent = t ? "synced " + timeAgo(t) : "";
  } else row.hidden = true;
}
function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  return Math.floor(s / 86400) + "d ago";
}
async function refreshConnection() {
  const tab = await findIgTab();
  igTabId = tab ? tab.id : null;
  if (tab) { setStatus("ok", "Instagram tab connected"); $("openIgBtn").hidden = true; }
  else { setStatus("idle", "Open Instagram to sync"); $("openIgBtn").hidden = false; }
  setSyncDisabled(false);
  renderAccount();
}
function setSyncDisabled(v) {
  $("syncFollowersBtn").disabled = v;
  $("syncFollowingBtn").disabled = v;
}

/* ---------- progress ---------- */
function showProgress(label) { $("progress").hidden = false; $("progressLabel").textContent = label; $("barFill").style.width = "0%"; }
function setProgress(label, frac) { $("progressLabel").textContent = label; if (frac != null) $("barFill").style.width = Math.min(100, Math.round(frac * 100)) + "%"; }
function hideProgress() { $("progress").hidden = true; }

/* ---------- sync one list ---------- */
async function syncOne(list) {
  if (busy) return;
  const tab = await findIgTab();
  if (!tab) { setStatus("bad", "No Instagram tab found"); $("openIgBtn").hidden = false; return; }
  igTabId = tab.id;
  busy = true;
  setSyncDisabled(true);
  try {
    await injectAgent(tab.id);
    const s = await sendToAgent(tab.id, { cmd: "session" });
    if (!s || !s.ok) { setStatus("bad", "Log in to Instagram, then retry"); return; }
    state.session = { username: s.username, viewerId: s.viewerId };
    state.counts = s.counts || state.counts;
    renderAccount();

    const max = Number(state.settings.maxLoad) || DEFAULTS.maxLoad;
    showProgress("Loading " + list + (state.loadMode === "non" ? " (non-mutual)…" : "…"));
    const r = await syncAwait(tab.id, list, max, state.loadMode);
    state[list] = r.users || [];
    state.incomplete[list] = !!r.incomplete;
    state.syncedAt[list] = Date.now();
    save();
    if (TAB_META[activeTab]) activeTab = list;
    render();
    setStatus("ok", "Synced " + state[list].length + " " + list);
    renderAccount();
  } catch (err) {
    setStatus("bad", err.message || "Sync failed");
  } finally {
    busy = false;
    hideProgress();
    setSyncDisabled(false);
  }
}

/* ---------- rendering ---------- */
function hasData() { return state.followers.length > 0 || state.following.length > 0; }
function mutualCount(list) { return state[list].filter((u) => u.mutual === true).length; }

function render() {
  $("sFollowers").textContent = countLabel("followers");
  $("sFollowing").textContent = countLabel("following");
  $("sMutualF").textContent = state.followers.length ? mutualCount("followers") : "—";
  $("sMutualG").textContent = state.following.length ? mutualCount("following") : "—";

  // tabs
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === activeTab));
  document.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.filter === filter));
  document.querySelectorAll(".seg").forEach((s) => s.classList.toggle("active", s.dataset.mode === state.loadMode));

  // info note (per active tab)
  const note = $("infoNote");
  if (state.incomplete[activeTab] && state[activeTab].length) {
    note.hidden = false;
    note.textContent =
      "Loaded " + state[activeTab].length + " " + activeTab +
      " (hit your max). Raise “Max accounts to load” in Settings to load more.";
  } else note.hidden = true;

  renderList();
  renderActionButton();
}
function countLabel(list) {
  const loaded = state[list].length;
  if (!loaded) return "—";
  const total = state.counts ? state.counts[list] : null;
  return total ? loaded.toLocaleString() + " / " + Number(total).toLocaleString() : loaded.toLocaleString();
}

function filteredUsers() {
  const q = $("search").value.trim().toLowerCase();
  let users = state[activeTab] || [];
  if (filter === "mutual") users = users.filter((u) => u.mutual === true);
  else if (filter === "non") users = users.filter((u) => u.mutual === false);
  if (q) users = users.filter((u) => (u.username || "").toLowerCase().includes(q) || (u.full_name || "").toLowerCase().includes(q));
  return users;
}

function renderList() {
  const list = $("list");
  list.innerHTML = "";
  for (const k in rowByPk) delete rowByPk[k];

  const users = filteredUsers();
  if (!users.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.innerHTML = state[activeTab].length
      ? "No accounts match this filter."
      : "Open Instagram, then click <b>Sync " + activeTab + "</b>.";
    list.appendChild(empty);
    return;
  }
  const keepSet = new Set(state.keep);
  const frag = document.createDocumentFragment();
  for (const u of users) frag.appendChild(makeRow(u, keepSet.has(lc(u))));
  list.appendChild(frag);
}

function avatarGradient(username) {
  let h = 0;
  for (let i = 0; i < username.length; i++) h = (h * 31 + username.charCodeAt(i)) % 360;
  return "linear-gradient(135deg, hsl(" + h + ",55%,55%), hsl(" + ((h + 40) % 360) + ",55%,42%))";
}

function makeRow(u, kept) {
  const row = document.createElement("div");
  row.className = "row";
  if (u.pk) rowByPk[u.pk] = row;

  const av = document.createElement("div");
  av.className = "avatar";
  av.style.background = avatarGradient(u.username || "?");
  const ini = document.createElement("span");
  ini.textContent = (u.username || "?").charAt(0).toUpperCase();
  av.appendChild(ini);
  if (u.profile_pic_url) {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    img.alt = "";
    img.onerror = () => img.remove();
    img.src = u.profile_pic_url;
    av.appendChild(img);
  }
  row.appendChild(av);

  const who = document.createElement("div");
  who.className = "who";
  const a = document.createElement("a");
  a.href = "https://www.instagram.com/" + u.username + "/";
  a.target = "_blank"; a.rel = "noopener";
  a.textContent = "@" + u.username;
  who.appendChild(a);
  if (u.full_name) {
    const nm = document.createElement("span");
    nm.className = "name"; nm.textContent = u.full_name;
    who.appendChild(nm);
  }
  row.appendChild(who);

  // mutual badge
  const badge = document.createElement("span");
  if (u.mutual === true) { badge.className = "badge mutual"; badge.textContent = "Mutual"; }
  else if (u.mutual === false) { badge.className = "badge non"; badge.textContent = "Non-mutual"; }
  else { badge.className = "badge"; badge.textContent = "?"; }
  badge.title = activeTab === "followers"
    ? (u.mutual ? "You follow them back" : "You don't follow them back")
    : (u.mutual ? "They follow you back" : "They don't follow you back");
  row.appendChild(badge);

  const star = document.createElement("button");
  star.className = "star" + (kept ? " on" : "");
  star.textContent = kept ? "★" : "☆";
  star.title = kept ? "Remove from kept" : "Keep (never touch this account)";
  star.addEventListener("click", () => toggleKeep(u));
  row.appendChild(star);

  return row;
}

function actionTargets() {
  const keepSet = new Set(state.keep);
  return (state[activeTab] || []).filter((u) => u.mutual === false && u.pk && !keepSet.has(lc(u)));
}

function renderActionButton() {
  const meta = TAB_META[activeTab];
  const btn = $("actionBtn");
  const targets = actionTargets();
  const max = Number(state.settings.maxActions) || DEFAULTS.maxActions;
  const willRun = Math.min(targets.length, max);
  btn.hidden = false;
  btn.textContent = targets.length > max
    ? meta.verb + " non-mutual (" + willRun + " of " + targets.length + ")"
    : meta.verb + " non-mutual (" + targets.length + ")";
  btn.disabled = actionRunning || busy || targets.length === 0;
}

/* ---------- keep ---------- */
function toggleKeep(u) {
  const name = lc(u);
  const i = state.keep.indexOf(name);
  if (i >= 0) state.keep.splice(i, 1); else state.keep.push(name);
  save(); render();
}

/* ---------- actions ---------- */
async function runAction() {
  const meta = TAB_META[activeTab];
  if (actionRunning || busy) return;
  const tab = await findIgTab();
  if (!tab) { setStatus("bad", "Open Instagram to run this"); $("openIgBtn").hidden = false; return; }
  igTabId = tab.id;

  const max = Number(state.settings.maxActions) || DEFAULTS.maxActions;
  const users = actionTargets().slice(0, max);
  if (!users.length) return;

  const ok = confirm(
    meta.verb + " " + users.length + " non-mutual account(s)?\n\n" +
    "Runs one at a time with a ~" + state.settings.delay +
    "s delay (± a few seconds) to stay within Instagram's limits. Keep the Instagram tab open."
  );
  if (!ok) return;

  await injectAgent(tab.id);
  actionRunning = true;
  renderActionButton();
  showProgress(meta.verb + "ing 0 / " + users.length);
  sendToAgent(tab.id, { cmd: "act", action: meta.action, users, delay: Number(state.settings.delay) || DEFAULTS.delay, max });
}
function applyActionResult(action, user) {
  const list = action === "unfollow" ? "following" : "followers";
  state[list] = state[list].filter((u) => u.pk !== user.pk);
}

/* ---------- export ---------- */
function exportCurrent() {
  const meta = TAB_META[activeTab];
  const users = filteredUsers();
  if (!users.length) { setStatus("idle", "Nothing to export"); return; }
  const tag = filter === "all" ? meta.title : meta.title + " · " + filter;
  const header = "# IGLens export — " + tag + " (" + users.length + ")\n# " + new Date().toISOString() + "\n# " + REPO_URL + "\n";
  const body = users.map((u) => u.username + (u.full_name ? "  —  " + u.full_name : "") + (u.mutual === true ? "  [mutual]" : u.mutual === false ? "  [non-mutual]" : "")).join("\n");
  const blob = new Blob([header + body + "\n"], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "iglens-" + activeTab + "-" + filter + "-" + new Date().toISOString().slice(0, 10) + ".txt";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- theme ---------- */
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  $("themeToggle").textContent = state.theme === "dark" ? "◑ Light" : "◐ Dark";
}

/* ---------- settings ---------- */
function fillSettings() {
  $("setMaxLoad").value = state.settings.maxLoad;
  $("setMaxActions").value = state.settings.maxActions;
  $("setDelay").value = state.settings.delay;
}
function settingsMsg(t) { const el = $("settingsMsg"); el.textContent = t; el.hidden = false; setTimeout(() => (el.hidden = true), 2500); }
function clamp(v, min, max, fb) { return isNaN(v) ? fb : Math.max(min, Math.min(max, v)); }

/* ---------- agent messages ---------- */
chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.channel !== CHANNEL) return;
  const w = syncWaiters[msg.list];

  switch (msg.type) {
    case "syncProgress": {
      if (w) w.arm();
      const total = state.counts ? state.counts[msg.list] : null;
      const max = Number(state.settings.maxLoad) || DEFAULTS.maxLoad;
      if (msg.phase === "verifying") {
        // following: checked `scanned` accounts, found `loaded` to show
        setProgress("Checking following… found " + (msg.loaded || 0) + " (scanned " + (msg.scanned || 0) + ")",
          Math.min(0.98, (msg.loaded || 0) / max));
      } else {
        const frac = Math.min(0.98, (msg.loaded || 0) / max);
        setProgress("Loading " + msg.list + "… " + msg.loaded + (total ? " of " + total + " total" : ""), frac);
      }
      break;
    }
    case "syncDone":
      if (w) { w.resolve(msg); delete syncWaiters[msg.list]; }
      break;
    case "syncError":
      if (w) { w.reject(new Error(msg.message)); delete syncWaiters[msg.list]; }
      break;

    case "actProgress": {
      const total = msg.total || 0;
      const verb = msg.action === "unfollow" ? "Unfollowing " : "Removing ";
      const failTxt = msg.failed ? " · " + msg.failed + " failed" : "";
      setProgress(verb + msg.done + " / " + total + failTxt, total ? msg.done / total : 0);
      if (msg.current && msg.current.pk && rowByPk[msg.current.pk]) {
        const row = rowByPk[msg.current.pk];
        row.classList.toggle("busy", msg.state === "working");
        if (msg.state === "ok" || msg.state === "gone") { row.classList.remove("busy"); row.classList.add("done"); applyActionResult(msg.action, msg.current); }
        else if (msg.state === "fail") { row.classList.remove("busy"); row.classList.add("fail"); }
      }
      break;
    }
    case "actError":
      actionRunning = false; hideProgress(); render(); save();
      setStatus("bad", msg.message || "Action stopped");
      break;
    case "actDone":
      actionRunning = false; hideProgress(); render(); save();
      setStatus("ok", (msg.stopped ? "Stopped after " : "Done — ") + msg.done + " processed" + (msg.failed ? " · " + msg.failed + " failed" : ""));
      break;
  }
});

/* ---------- wire up ---------- */
function init() {
  $("repoLink").href = REPO_URL;
  $("footerRepo").href = REPO_URL;
  applyTheme();

  $("syncFollowersBtn").addEventListener("click", () => syncOne("followers"));
  $("syncFollowingBtn").addEventListener("click", () => syncOne("following"));
  $("openIgBtn").addEventListener("click", () => chrome.tabs.create({ url: "https://www.instagram.com/" }));
  $("exportBtn").addEventListener("click", exportCurrent);
  $("actionBtn").addEventListener("click", runAction);
  $("stopBtn").addEventListener("click", async () => { if (igTabId) await sendToAgent(igTabId, { cmd: "stop" }); });
  $("search").addEventListener("input", renderList);

  document.querySelectorAll(".tab").forEach((el) =>
    el.addEventListener("click", () => { activeTab = el.dataset.tab; $("search").value = ""; render(); }));
  document.querySelectorAll(".chip").forEach((el) =>
    el.addEventListener("click", () => { filter = el.dataset.filter; render(); }));
  document.querySelectorAll(".seg").forEach((el) =>
    el.addEventListener("click", () => { state.loadMode = el.dataset.mode; save(); render(); }));

  $("themeToggle").addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); save(); });

  $("settingsToggle").addEventListener("click", () => { const d = $("settingsDrawer"); d.hidden = !d.hidden; if (!d.hidden) fillSettings(); });
  $("saveSettings").addEventListener("click", () => {
    state.settings = {
      maxLoad: clamp(+$("setMaxLoad").value, 10, 20000, DEFAULTS.maxLoad),
      maxActions: clamp(+$("setMaxActions").value, 1, 200, DEFAULTS.maxActions),
      delay: clamp(+$("setDelay").value, 2, 600, DEFAULTS.delay),
    };
    save(); render(); settingsMsg("Settings saved.");
  });
  $("resetSettings").addEventListener("click", () => { state.settings = { ...DEFAULTS }; fillSettings(); save(); settingsMsg("Defaults restored."); });
  $("clearData").addEventListener("click", () => {
    if (!confirm("Clear cached followers/following and kept list from this device?")) return;
    state.followers = []; state.following = []; state.keep = [];
    state.counts = { followers: null, following: null };
    state.incomplete = { followers: false, following: false };
    state.syncedAt = { followers: null, following: null };
    save(); render(); settingsMsg("Cached data cleared.");
  });
}

(async function main() {
  await load();
  init();
  render();
  await refreshConnection();
})();
