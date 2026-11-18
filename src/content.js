/*
 * HypeBlock — engine. Runs on X, YouTube, Reddit, Google and any site the user enables.
 * Everything happens locally in the page. Nothing is sent anywhere.
 */
(() => {
  "use strict";
  if (globalThis.__hypeblockLoaded) return; // can be injected twice (manifest + "Enable on this site")
  globalThis.__hypeblockLoaded = true;

  const U = globalThis.HypeBlock;
  const A = globalThis.HypeBlockAdapters;
  const api = globalThis.browser || globalThis.chrome;
  const host = location.hostname;
  const { adapter, builtin } = A.pick(host);

  let settings = U.normalizeSettings(null);
  let compiled = U.compile(settings);
  let rev = 0;
  const revealed = new Set();
  const revealedVideos = new WeakSet();
  const state = new WeakMap(); // element -> { target, hide, cover, banner }
  const counted = new Set();
  let pendingHits = 0;
  let flushTimer = null;

  const FLAG_SEL = ".hypeblock-flagged, .hypeblock-hidden, .hypeblock-banner-blur, .hypeblock-img-blur";

  function isActive() {
    if (!settings.enabled) return false;
    if (adapter.site && settings.sites[adapter.site] === false) return false;
    if (builtin) return true;
    return U.siteListed(settings, host);
  }

  // ---------- helpers ----------

  function hash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36) + ":" + s.length;
  }

  function ensurePositioned(el, rec) {
    if (getComputedStyle(el).position === "static") {
      el.style.position = "relative";
      rec.positioned = true;
    }
  }

  function pauseVideosIn(el) {
    el.querySelectorAll("video").forEach((v) => {
      try { v.pause(); } catch (_) {}
    });
  }

  // Labels are drawn with CSS ::before from data attributes, so our covers
  // add no text to the page and never trigger a match themselves.
  function makeCover(kindLabel, detail, buttonText, compact, onReveal) {
    const cover = document.createElement("div");
    cover.className = "hypeblock-cover" + (compact ? " hypeblock-compact" : "");
    const badge = document.createElement("span");
    badge.className = "hypeblock-badge";
    badge.dataset.label = kindLabel;
    const what = document.createElement("span");
    what.className = "hypeblock-detail";
    what.dataset.label = detail;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hypeblock-reveal";
    btn.dataset.label = buttonText;
    cover.append(badge, what, btn);
    const stop = (e) => e.stopPropagation();
    cover.addEventListener("mousedown", stop);
    cover.addEventListener("pointerdown", stop);
    cover.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.target.closest(".hypeblock-reveal")) onReveal();
    });
    return cover;
  }

  // ---------- stats ----------

  function countHit(key) {
    if (counted.has(key)) return;
    counted.add(key);
    pendingHits++;
    if (!flushTimer) flushTimer = setTimeout(flushStats, 1500);
  }

  async function flushStats() {
    flushTimer = null;
    const add = pendingHits;
    pendingHits = 0;
    if (!add) return;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const { stats } = await api.storage.local.get("stats");
      const count = (stats && stats.date === today ? stats.count : 0) + add;
      const total = ((stats && stats.total) || 0) + add;
      await api.storage.local.set({ stats: { date: today, count, total } });
    } catch (_) { /* extension was reloaded */ }
  }

  // ---------- units ----------

  function clearUnit(el) {
    const rec = state.get(el);
    if (!rec) return;
    state.delete(el);
    if (rec.cover) rec.cover.remove();
    if (rec.banner) rec.banner.remove();
    if (rec.target) {
      rec.target.classList.remove("hypeblock-flagged", "hypeblock-big", "hypeblock-small", "hypeblock-banner-blur");
      if (rec.positioned) rec.target.style.position = "";
    }
    if (rec.hide) rec.hide.classList.remove("hypeblock-hidden");
    if (rec.img) {
      rec.img.classList.remove("hypeblock-img-blur");
      rec.img.removeEventListener("click", rec.onImgClick, true);
    }
  }

  function processUnit(rule, el) {
    // Skip units inside something we already covered.
    const parent = el.parentElement;
    if (parent && parent.closest(FLAG_SEL)) return;

    const data = rule.extract ? rule.extract(el) : { text: A.textOf(el) };
    const key = (rule.key && rule.key(el)) || hash(data.text || "");
    const sig = rev + "|" + key;
    const rec = state.get(el);

    if (el.dataset.hypeblockSig === sig) {
      // The site may have re-rendered and dropped our cover. Put it back.
      if (rec && rec.cover && !rec.cover.isConnected) {
        el.dataset.hypeblockSig = "";
        processUnit(rule, el);
      }
      return;
    }
    clearUnit(el);
    el.dataset.hypeblockSig = sig;
    if (revealed.has(key)) return;

    const target = rule.target ? rule.target(el) : el;
    const hideEl = rule.hide ? rule.hide(el) : target;

    if (rule.kind === "trend") {
      if (settings.hideTrends && U.matchTopic(compiled, data.text)) {
        hideEl.classList.add("hypeblock-hidden");
        state.set(el, { hide: hideEl });
      }
      return;
    }

    const res = U.match(compiled, data);
    if (!res) return;
    countHit(key);
    pauseVideosIn(target);

    if (settings.action === "hide") {
      hideEl.classList.add("hypeblock-hidden");
      state.set(el, { hide: hideEl });
      return;
    }

    if (rule.kind === "image") {
      if (settings.action === "hide") {
        el.classList.add("hypeblock-hidden");
        state.set(el, { hide: el });
        return;
      }
      const onImgClick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        revealed.add(key);
        clearUnit(el);
      };
      el.classList.add("hypeblock-img-blur");
      el.title = el.title || "HypeBlock: click to show";
      el.addEventListener("click", onImgClick, true);
      state.set(el, { img: el, onImgClick });
      return;
    }

    const kindLabel = res.kind === "spoiler" ? "Possible spoiler" : res.kind === "account" ? "Muted account" : "Muted topic";
    const reveal = () => {
      revealed.add(key);
      clearUnit(el);
    };
    const r = { target };

    if (rule.banner && rule.banner(el)) {
      target.classList.add("hypeblock-banner-blur");
      r.banner = makeCover(kindLabel, res.label, "Show", true, reveal);
      r.banner.classList.add("hypeblock-banner");
      target.before(r.banner);
    } else {
      const h = target.getBoundingClientRect().height;
      const compact = !rule.big && h < 110;
      ensurePositioned(target, r);
      target.classList.add("hypeblock-flagged");
      if (compact && h < 44) target.classList.add("hypeblock-small");
      if (rule.big) target.classList.add("hypeblock-big");
      r.cover = makeCover(kindLabel, res.label, "Show anyway", compact, reveal);
      target.appendChild(r.cover);
    }
    state.set(el, r);
  }

  // ---------- X: block all videos ----------

  function processVideos() {
    document.querySelectorAll(adapter.videoSelector).forEach((player) => {
      if (revealedVideos.has(player) || player.closest(FLAG_SEL)) return;
      if (player.dataset.hypeblockVid === String(rev) && player.querySelector(":scope > .hypeblock-cover")) return;
      clearVideo(player);
      player.dataset.hypeblockVid = String(rev);
      const r = {};
      ensurePositioned(player, r);
      if (r.positioned) player.dataset.hypeblockPos = "1";
      player.classList.add("hypeblock-vid-blocked");
      pauseVideosIn(player);
      player.appendChild(
        makeCover("Video hidden", "HypeBlock is blocking all videos", "Play anyway", false, () => {
          revealedVideos.add(player);
          clearVideo(player);
        })
      );
    });
  }

  function clearVideo(player) {
    player.classList.remove("hypeblock-vid-blocked");
    player.querySelectorAll(":scope > .hypeblock-cover").forEach((c) => c.remove());
    if (player.dataset.hypeblockPos) {
      player.style.position = "";
      delete player.dataset.hypeblockPos;
    }
    delete player.dataset.hypeblockVid;
  }

  // Autoplay guard: stop videos that sit under a cover.
  document.addEventListener(
    "play",
    (e) => {
      const v = e.target;
      if (!(v instanceof HTMLVideoElement) || !isActive()) return;
      if (v.closest(FLAG_SEL + ", .hypeblock-vid-blocked")) {
        try { v.pause(); } catch (_) {}
      }
    },
    true
  );

  // ---------- main loop ----------

  function resetAll() {
    document.querySelectorAll("[data-hypeblock-sig]").forEach((el) => {
      clearUnit(el);
      delete el.dataset.hypeblockSig;
    });
    document.querySelectorAll(".hypeblock-cover").forEach((c) => c.remove());
    document.querySelectorAll(".hypeblock-hidden, .hypeblock-flagged, .hypeblock-banner-blur, .hypeblock-img-blur").forEach((n) =>
      n.classList.remove("hypeblock-hidden", "hypeblock-flagged", "hypeblock-big", "hypeblock-small", "hypeblock-banner-blur", "hypeblock-img-blur")
    );
    document.querySelectorAll(".hypeblock-vid-blocked, [data-hypeblock-vid]").forEach(clearVideo);
  }

  function scan() {
    if (!isActive()) return;
    for (const rule of adapter.rules) {
      document.querySelectorAll(rule.sel).forEach((el) => processUnit(rule, el));
    }
    if (adapter.videoSelector && settings.blockAllVideos) processVideos();
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
    }, adapter.throttle || 200);
  }

  function applySettings(raw) {
    settings = U.normalizeSettings(raw);
    compiled = U.compile(settings);
    rev++;
    resetAll();
    scan();
  }

  api.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.settings) applySettings(changes.settings.newValue);
  });

  api.storage.sync
    .get("settings")
    .then(({ settings: stored }) => applySettings(stored))
    .catch(() => applySettings(null));

  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
