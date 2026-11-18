(() => {
  "use strict";

  const U = globalThis.HypeBlock;
  const api = globalThis.browser || globalThis.chrome;
  const $ = (id) => document.getElementById(id);
  const A = globalThis.HypeBlockAdapters;
  const ORIGINS = ["https://x.com/*", "https://twitter.com/*", "https://*.youtube.com/*", "https://*.reddit.com/*", "https://www.google.com/*"];
  const JS = ["src/filters.js", "src/adapters.js", "src/content.js"];
  let currentTab = null;

  let settings = U.normalizeSettings(null);

  function save() {
    return api.storage.sync.set({ settings });
  }

  function segmented(name, current, onChange) {
    const seg = document.createElement("div");
    seg.className = "seg";
    for (const [value, label] of [["off", "Off"], ["spoilers", "Spoilers"], ["mute", "Mute"]]) {
      const l = document.createElement("label");
      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = value;
      input.checked = current === value;
      input.addEventListener("change", () => onChange(value));
      const span = document.createElement("span");
      span.textContent = label;
      l.append(input, span);
      seg.append(l);
    }
    return seg;
  }

  function topicRow(name, mode, onChange, onDelete) {
    const row = document.createElement("div");
    row.className = "topic";
    const n = document.createElement("span");
    n.className = "name";
    n.textContent = name;
    row.append(n, segmented("t-" + Math.random().toString(36).slice(2), mode, onChange));
    if (onDelete) {
      const del = document.createElement("button");
      del.className = "del";
      del.type = "button";
      del.title = "Remove";
      del.textContent = "✕";
      del.addEventListener("click", onDelete);
      row.append(del);
    }
    return row;
  }

  function renderTopics() {
    const box = $("topics");
    box.textContent = "";
    for (const p of U.PRESET_TOPICS) {
      box.append(
        topicRow(p.name, settings.topics[p.id] || "off", (mode) => {
          settings.topics[p.id] = mode;
          save();
        })
      );
    }
    settings.customTopics.forEach((c, i) => {
      box.append(
        topicRow(
          c.name,
          c.mode,
          (mode) => {
            settings.customTopics[i].mode = mode;
            save();
          },
          () => {
            settings.customTopics.splice(i, 1);
            save();
            renderTopics();
          }
        )
      );
    });
  }

  function render() {
    document.body.classList.toggle("off", !settings.enabled);
    $("enabled").checked = settings.enabled;
    document.querySelectorAll('input[name="action"]').forEach((r) => (r.checked = r.value === settings.action));
    $("blockAllVideos").checked = settings.blockAllVideos;
    $("hideTrends").checked = settings.hideTrends;
    $("spoilerTerms").value = settings.spoilerTerms.join(", ");
    $("blockedAccounts").value = settings.blockedAccounts.map((h) => "@" + h.replace(/^@/, "")).join(", ");
    document.querySelectorAll("[data-site]").forEach((c) => (c.checked = settings.sites[c.dataset.site] !== false));
    renderTopics();
    renderSites();
  }

  // ---------- other sites ----------

  function renderSites() {
    const box = $("extra");
    box.textContent = "";
    for (const host of settings.extraSites) {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.append(host);
      const x = document.createElement("button");
      x.type = "button";
      x.title = "Turn off on this site";
      x.textContent = "✕";
      x.addEventListener("click", () => disableSite(host));
      chip.append(x);
      box.append(chip);
    }
    renderHere();
  }

  function renderHere() {
    const here = $("here");
    let host = null;
    try {
      const u = new URL(currentTab && currentTab.url);
      if (u.protocol === "http:" || u.protocol === "https:") host = u.hostname;
    } catch (_) {}
    if (!host || A.BUILTIN.test(host)) {
      here.hidden = true;
      return;
    }
    here.hidden = false;
    $("hereHost").textContent = host;
    const on = settings.extraSites.includes(host);
    $("hereBtn").textContent = on ? "Turn off here" : "Enable on this site";
    $("hereBtn").classList.toggle("on", on);
    $("hereBtn").onclick = () => (on ? disableSite(host) : enableSite(host));
  }

  async function enableSite(host) {
    // Must run straight from the click so the browser shows its permission prompt.
    let ok = false;
    try {
      ok = await api.permissions.request({ origins: [`*://${host}/*`] });
    } catch (_) {}
    if (!ok) return;
    if (!settings.extraSites.includes(host)) settings.extraSites.push(host);
    await save();
    try {
      await api.scripting.insertCSS({ target: { tabId: currentTab.id }, files: ["src/content.css"] });
      await api.scripting.executeScript({ target: { tabId: currentTab.id }, files: JS });
    } catch (_) { /* page will pick it up on next load */ }
    renderSites();
  }

  async function disableSite(host) {
    settings.extraSites = settings.extraSites.filter((h) => h !== host);
    await save();
    try {
      await api.permissions.remove({ origins: [`*://${host}/*`] });
    } catch (_) {}
    renderSites();
  }

  async function renderStats() {
    const { stats } = await api.storage.local.get("stats");
    const today = new Date().toISOString().slice(0, 10);
    $("today").textContent = stats && stats.date === today ? stats.count : 0;
    $("total").textContent = (stats && stats.total) || 0;
  }

  async function checkPermission() {
    if (!api.permissions || !api.permissions.contains) return;
    try {
      const ok = await api.permissions.contains({ origins: ORIGINS });
      $("perm").hidden = ok;
    } catch (_) {}
  }

  // ---------- events ----------

  $("enabled").addEventListener("change", (e) => {
    settings.enabled = e.target.checked;
    document.body.classList.toggle("off", !settings.enabled);
    save();
  });

  document.querySelectorAll('input[name="action"]').forEach((r) =>
    r.addEventListener("change", () => {
      settings.action = r.value;
      save();
    })
  );

  $("blockAllVideos").addEventListener("change", (e) => {
    settings.blockAllVideos = e.target.checked;
    save();
  });

  document.querySelectorAll("[data-site]").forEach((c) =>
    c.addEventListener("change", () => {
      settings.sites[c.dataset.site] = c.checked;
      save();
    })
  );

  $("hideTrends").addEventListener("change", (e) => {
    settings.hideTrends = e.target.checked;
    save();
  });

  $("spoilerTerms").addEventListener("change", (e) => {
    settings.spoilerTerms = U.parseList(e.target.value);
    save();
  });

  $("blockedAccounts").addEventListener("change", (e) => {
    settings.blockedAccounts = U.parseList(e.target.value).map((h) => h.replace(/^@/, ""));
    save();
  });

  $("resetTerms").addEventListener("click", () => {
    settings.spoilerTerms = U.DEFAULT_SPOILER_TERMS.slice();
    $("spoilerTerms").value = settings.spoilerTerms.join(", ");
    save();
  });

  $("addTopic").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = $("newName").value.trim();
    if (!name) return;
    const keywords = U.parseList($("newKeywords").value);
    if (!keywords.length) keywords.push(name);
    settings.customTopics.push({ id: "c" + Date.now(), name, keywords, mode: "spoilers" });
    $("newName").value = "";
    $("newKeywords").value = "";
    save();
    renderTopics();
  });

  $("grant").addEventListener("click", async () => {
    try {
      await api.permissions.request({ origins: ORIGINS });
    } catch (_) {}
    checkPermission();
  });

  // ---------- init ----------

  Promise.all([
    api.storage.sync.get("settings"),
    api.tabs.query({ active: true, currentWindow: true }).catch(() => [])
  ]).then(([{ settings: stored }, tabs]) => {
    currentTab = tabs && tabs[0];
    settings = U.normalizeSettings(stored);
    render();
  });
  renderStats();
  checkPermission();
})();
