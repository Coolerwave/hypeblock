// HypeBlock — keeps "Enable on this site" registrations in sync with settings and permissions.
const api = globalThis.browser || globalThis.chrome;
const JS = ["src/filters.js", "src/adapters.js", "src/content.js"];
const CSS = ["src/content.css"];
const idFor = (host) => "site:" + host;

async function sync() {
  const { settings } = await api.storage.sync.get("settings");
  const sites = (settings && settings.extraSites) || [];
  const want = [];
  for (const host of sites) {
    try {
      if (await api.permissions.contains({ origins: [`*://${host}/*`] })) want.push(host);
    } catch (_) {}
  }
  const existing = await api.scripting.getRegisteredContentScripts();
  const wantIds = new Set(want.map(idFor));
  const stale = existing.filter((s) => !wantIds.has(s.id)).map((s) => s.id);
  if (stale.length) await api.scripting.unregisterContentScripts({ ids: stale });
  const have = new Set(existing.map((s) => s.id));
  const add = want
    .filter((h) => !have.has(idFor(h)))
    .map((h) => ({ id: idFor(h), matches: [`*://${h}/*`], js: JS, css: CSS, runAt: "document_idle" }));
  if (add.length) await api.scripting.registerContentScripts(add);
}

const safeSync = () => sync().catch((e) => console.warn("HypeBlock sync failed", e));
api.runtime.onInstalled.addListener(safeSync);
api.runtime.onStartup.addListener(safeSync);
api.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.settings) safeSync();
});
if (api.permissions.onAdded) api.permissions.onAdded.addListener(safeSync);
if (api.permissions.onRemoved) api.permissions.onRemoved.addListener(safeSync);
