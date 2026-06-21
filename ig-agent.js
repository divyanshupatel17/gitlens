// ig-agent.js
// Injected on demand into the active instagram.com tab. Runs entirely with the
// user's own logged-in session (same-origin requests, cookies included).
//
// Message API (from the side panel):
//   { cmd: "session" }                           -> { ok, username, viewerId, counts }
//   { cmd: "sync", list, max, mode }             -> loads one list up to `max`,
//                                                   mode "all" | "non" (non-mutual only);
//                                                   streams progress, then "syncDone"
//   { cmd: "act", action, users, delay, max }    -> streams progress, then "actDone"
//   { cmd: "stop" }                              -> aborts the running loop
//
// Reliable signals (matching the original Followers Cleaner):
//  - Followers come from the GraphQL endpoint, whose node carries
//    `followed_by_viewer` = "do I follow this follower back". That inline flag
//    is the trustworthy mutual signal and lets us collect only the people we
//    don't follow back while paging.
//  - For Following, each account is verified with friendships/show/{id}/ whose
//    `followed_by` ("do they follow me") is reliable (show_many's is not).

(function () {
  if (window.__iglensAgent) return;
  window.__iglensAgent = true;

  const CHANNEL = "iglens";
  const FALLBACK_APP_ID = "936619743392459";
  const FOLLOWERS_QUERY_ID = "17851374694183129"; // edge_followed_by

  let stopRequested = false;

  function emit(p) { chrome.runtime.sendMessage({ channel: CHANNEL, ...p }).catch(() => {}); }
  function cookie(name) {
    const m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  function scrape(re) { const m = document.documentElement.innerHTML.match(re); return m ? m[1] : null; }
  function getSession() {
    const viewerId = cookie("ds_user_id") || scrape(/"viewerId":"(\d+)"/) || scrape(/"id":"(\d+)"/);
    const csrf = cookie("csrftoken") || scrape(/"csrf_token":"([^"]+)"/);
    const appId = scrape(/"X-IG-App-ID":"(\d+)"/) || scrape(/"app_id":"(\d+)"/) || FALLBACK_APP_ID;
    return { viewerId, csrf, appId };
  }
  function apiHeaders(extra) {
    const { csrf, appId } = getSession();
    const h = { "x-ig-app-id": appId, "x-asbd-id": "129477", "x-requested-with": "XMLHttpRequest" };
    if (csrf) h["x-csrftoken"] = csrf;
    return Object.assign(h, extra || {});
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rnd = (a, b) => a + Math.floor(Math.random() * (b - a));

  async function resolveProfile(viewerId) {
    const p = { username: null, follower_count: null, following_count: null };
    try {
      const res = await fetch("https://www.instagram.com/api/v1/users/" + viewerId + "/info/",
        { headers: apiHeaders(), credentials: "include" });
      if (res.ok) {
        const d = await res.json();
        if (d && d.user) { p.username = d.user.username; p.follower_count = d.user.follower_count; p.following_count = d.user.following_count; }
      }
    } catch (_) {}
    if (!p.username) p.username = scrape(/"username":"([^"]+)"/);
    return p;
  }

  // Reliable per-account reciprocal status.
  async function showSingle(pk) {
    try {
      const res = await fetch("https://www.instagram.com/api/v1/friendships/show/" + pk + "/",
        { headers: apiHeaders(), credentials: "include" });
      if (!res.ok) return null;
      const d = await res.json().catch(() => null);
      if (!d) return null;
      return { following: !!d.following, followed_by: !!d.followed_by };
    } catch (_) { return null; }
  }

  // ---- Followers via GraphQL (followed_by_viewer is inline) ----
  async function loadFollowers(max, mode) {
    const { viewerId } = getSession();
    if (!viewerId) { emit({ type: "syncError", list: "followers", message: "Not logged in to Instagram." }); return; }

    const users = [];
    const seen = new Set();
    let after = "", hasNext = true, scanned = 0, retries = 0, reachedEnd = false;

    while (users.length < max && hasNext) {
      if (stopRequested) break;
      const url = "https://www.instagram.com/graphql/query/?query_id=" + FOLLOWERS_QUERY_ID +
        "&id=" + viewerId + "&first=50&after=" + encodeURIComponent(after);

      let res;
      try { res = await fetch(url, { headers: apiHeaders(), credentials: "include" }); }
      catch (e) { if (retries++ < 2) { await sleep(3000); continue; } break; }

      if (res.status === 429 || res.status === 400 || res.status >= 500) {
        if (retries++ < 2) { await sleep(4000 + retries * 4000); continue; }
        break;
      }
      if (!res.ok) break;
      retries = 0;

      const data = await res.json().catch(() => null);
      const conn = data && data.data && data.data.user && data.data.user.edge_followed_by;
      if (!conn) { emit({ type: "syncError", list: "followers", message: "Instagram blocked the followers request — try again shortly." }); return; }

      hasNext = conn.page_info.has_next_page;
      after = conn.page_info.end_cursor || "";

      for (const e of conn.edges) {
        const n = e.node;
        if (seen.has(n.id)) continue;
        seen.add(n.id);
        scanned++;
        if (n.requested_by_viewer) continue;
        const mutual = !!n.followed_by_viewer; // do I follow this follower back?
        if (mode === "non" && mutual) continue; // keep only the ones I don't follow back
        users.push({
          pk: String(n.id), username: n.username, full_name: n.full_name || "",
          profile_pic_url: n.profile_pic_url || "", mutual,
        });
        if (users.length >= max) break;
      }

      emit({ type: "syncProgress", list: "followers", phase: "loading", loaded: users.length, scanned });
      if (!hasNext) { reachedEnd = true; break; }
      if (users.length >= max) break;
      await sleep(rnd(2000, 4000));
    }

    emit({ type: "syncDone", list: "followers", users, incomplete: !reachedEnd, mode });
  }

  // ---- Following via REST list + reliable per-account verification ----
  async function loadFollowing(max, mode) {
    const { viewerId } = getSession();
    if (!viewerId) { emit({ type: "syncError", list: "following", message: "Not logged in to Instagram." }); return; }

    const endpoint = "https://www.instagram.com/api/v1/friendships/" + viewerId + "/following/";
    const out = [];
    const seen = new Set();
    let nextMaxId = "", retries = 0, reachedEnd = false, scanned = 0;
    const scanCap = mode === "non" ? Math.max(max * 8, 800) : max;

    while (out.length < max && scanned < scanCap) {
      if (stopRequested) break;
      const url = endpoint + "?count=50&search_surface=follow_list_page" +
        (nextMaxId ? "&max_id=" + encodeURIComponent(nextMaxId) : "");

      let res;
      try { res = await fetch(url, { headers: apiHeaders(), credentials: "include" }); }
      catch (e) { if (retries++ < 2) { await sleep(3000); continue; } break; }

      if (res.status === 429 || res.status === 400 || res.status >= 500) {
        if (retries++ < 2) { await sleep(4000 + retries * 4000); continue; }
        break;
      }
      if (!res.ok) break;
      retries = 0;

      const data = await res.json().catch(() => null);
      const batch = data && Array.isArray(data.users) ? data.users : [];

      for (const u of batch) {
        if (stopRequested) break;
        if (!u || seen.has(u.pk)) continue;
        seen.add(u.pk);
        scanned++;

        const st = await showSingle(String(u.pk));
        const mutual = st ? st.followed_by : null; // do they follow me back?
        await sleep(rnd(120, 260));

        if (mode === "non" && mutual === true) {
          emit({ type: "syncProgress", list: "following", phase: "verifying", loaded: out.length, scanned, total: scanCap });
          continue;
        }
        out.push({
          pk: String(u.pk), username: u.username, full_name: u.full_name || "",
          profile_pic_url: u.profile_pic_url || "", mutual,
        });
        emit({ type: "syncProgress", list: "following", phase: "verifying", loaded: out.length, scanned, total: scanCap });
        if (out.length >= max) break;
      }

      nextMaxId = data ? data.next_max_id : "";
      if (!nextMaxId || batch.length === 0) { reachedEnd = true; break; }
      await sleep(rnd(700, 1300));
    }

    emit({ type: "syncDone", list: "following", users: out, incomplete: !reachedEnd, mode });
  }

  function syncList(list, max, mode) {
    stopRequested = false;
    if (list === "following") return loadFollowing(max, mode);
    return loadFollowers(max, mode);
  }

  // ---- Remove (remove_follower) / Unfollow (destroy) ----
  async function runAction(action, users, delaySec, max) {
    stopRequested = false;
    const path = action === "unfollow" ? "destroy" : "remove_follower";
    const total = Math.min(users.length, max);
    const MAX_CONSECUTIVE_FAILS = 4;
    const base = Math.max(2, delaySec || 30);
    let done = 0, failed = 0, consecutiveFails = 0;

    const rollout = scrape(/"rollout_hash":"([^"]+)"/);
    const headers = apiHeaders({ "content-type": "application/x-www-form-urlencoded" });
    if (rollout) headers["x-instagram-ajax"] = rollout;
    const claim = sessionStorage.getItem("www-claim-v2");
    if (claim) headers["x-ig-www-claim"] = claim;

    const normalWait = () => Math.max(1000, Math.round((base + (Math.random() * 5 - 2)) * 1000));
    const failWait = () => Math.round((base + 5 + Math.random() * 6) * 1000);

    for (let i = 0; i < total; i++) {
      if (stopRequested) { emit({ type: "actDone", action, done, failed, stopped: true }); return; }
      const user = users[i];
      emit({ type: "actProgress", action, done, failed, total, current: user, state: "working" });

      let okThisOne = false, softFail = false, message = "";
      try {
        const res = await fetch("https://www.instagram.com/api/v1/friendships/" + path + "/" + user.pk + "/",
          { method: "POST", headers, credentials: "include", body: "" });
        if (res.status === 404) {
          okThisOne = true; done++;
          emit({ type: "actProgress", action, done, failed, total, current: user, state: "gone" });
        } else if (!res.ok) {
          softFail = true; message = "HTTP " + res.status;
        } else {
          const body = await res.json().catch(() => null);
          if (body && body.status === "ok") {
            okThisOne = true; done++;
            emit({ type: "actProgress", action, done, failed, total, current: user, state: "ok" });
          } else { softFail = true; message = body && body.feedback_required ? "Instagram asked to slow down" : "Rejected"; }
        }
      } catch (err) { softFail = true; message = err.message; }

      if (softFail) {
        failed++; consecutiveFails++;
        emit({ type: "actProgress", action, done, failed, total, current: user, state: "fail", message });
        if (consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
          emit({ type: "actError", action, done, failed,
            message: "Stopped after " + consecutiveFails + " failures in a row — Instagram is likely rate-limiting. Try again later with a longer delay." });
          return;
        }
      } else if (okThisOne) { consecutiveFails = 0; }

      if (i < total - 1) await sleep(softFail ? failWait() : normalWait());
    }

    emit({ type: "actDone", action, done, failed, stopped: false });
  }

  chrome.runtime.onMessage.addListener((msg, _s, sendResponse) => {
    if (!msg || msg.channel !== CHANNEL) return;
    if (msg.cmd === "session") {
      const { viewerId } = getSession();
      if (!viewerId) { sendResponse({ ok: false }); return true; }
      resolveProfile(viewerId).then((p) => sendResponse({ ok: true, viewerId, username: p.username,
        counts: { followers: p.follower_count, following: p.following_count } }));
      return true;
    }
    if (msg.cmd === "sync") { syncList(msg.list, msg.max || 200, msg.mode || "all"); sendResponse({ ok: true }); return true; }
    if (msg.cmd === "act") { runAction(msg.action, msg.users || [], msg.delay, msg.max || 200); sendResponse({ ok: true }); return true; }
    if (msg.cmd === "stop") { stopRequested = true; sendResponse({ ok: true }); return true; }
  });

  emit({ type: "agentReady" });
})();
