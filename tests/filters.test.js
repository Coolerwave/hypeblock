const test = require("node:test");
const assert = require("node:assert");
const U = require("../src/filters.js");

const base = U.compile(U.DEFAULT_SETTINGS);
const m = (text, compiled = base, handles = []) => U.match(compiled, { text, handles });

test("plain GTA 6 hype passes in spoiler mode", () => {
  assert.strictEqual(m("GTA 6 is out tomorrow, who's staying up?"), null);
  assert.strictEqual(m("#GTA6 preload is live"), null);
});

test("GTA 6 + spoiler word gets shielded, in every spelling", () => {
  for (const t of [
    "GTA 6 ending is insane, Lucia...",
    "gta6 leaked final mission",
    "#GTAVI the twist with Jason",
    "Grand Theft Auto VI: who dies at the end? (spoilers)",
    "спойлер по GTA VI: концовка",
    "just beat gta-6 lol"
  ]) {
    const r = m(t);
    assert.ok(r, "should match: " + t);
    assert.strictEqual(r.kind, "spoiler");
    assert.strictEqual(r.label, "GTA 6");
  }
});

test("no false positives from substrings", () => {
  assert.strictEqual(m("my gta60 build ending soon"), null);   // gta60 ≠ gta 6
  assert.strictEqual(m("bending the rules in Leonidas"), null); // not "ending", not "leonida"
});

test("mute mode hides any mention", () => {
  const c = U.compile({ topics: { gta6: "mute" } });
  const r = m("Rockstar posted new GTA VI screenshots", c);
  assert.deepStrictEqual(r, { kind: "muted", label: "GTA 6" });
});

test("off mode ignores topic", () => {
  const c = U.compile({ topics: { gta6: "off" } });
  assert.strictEqual(m("GTA 6 ending spoilers", c), null);
});

test("custom topics and blocked accounts", () => {
  const c = U.compile({
    customTopics: [{ id: "c1", name: "Battlefield", keywords: ["battlefield 6", "bf6"], mode: "mute" }],
    blockedAccounts: ["@LeakAccount"]
  });
  assert.deepStrictEqual(m("BF6 season 2 is live", c), { kind: "muted", label: "Battlefield" });
  assert.deepStrictEqual(m("hello", c, ["leakaccount"]), { kind: "account", label: "@leakaccount" });
});

test("trends matcher", () => {
  assert.strictEqual(U.matchTopic(base, "Trending in Gaming\n#GTA6\n512K posts"), "GTA 6");
  assert.strictEqual(U.matchTopic(base, "Trending\nMonday"), null);
});

test("parseList", () => {
  assert.deepStrictEqual(U.parseList("a, b\n\nc ,"), ["a", "b", "c"]);
});

test("'no spoilers' is not a spoiler", () => {
  assert.strictEqual(m("GTA 6 day one: first 30 minutes (no spoilers)"), null);
  assert.strictEqual(m("GTA 6 review, spoiler-free"), null);
  assert.strictEqual(m("Обзор GTA 6 без спойлеров"), null);
  assert.ok(m("GTA 6 no spoilers here... jk the ending: Jason dies"));
});
