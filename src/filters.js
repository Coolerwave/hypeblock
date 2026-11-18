/*
 * HypeBlock — shared filter logic.
 * Used by the content script (x.com), the popup, and the Node tests.
 */
(function (root) {
  "use strict";

  // Preset topics. Keywords are matched as whole words, case-insensitive,
  // with flexible spacing ("gta 6" also matches "GTA6", "#gta6", "gta-6").
  const PRESET_TOPICS = [
    {
      id: "gta6",
      name: "GTA 6",
      keywords: [
        "gta 6", "gta vi", "gtavi", "grand theft auto 6", "grand theft auto vi",
        "leonida", "jason duval", "lucia caminos", "jason and lucia", "lucia and jason"
      ]
    },
    {
      id: "witcher4",
      name: "The Witcher 4",
      keywords: ["witcher 4", "witcher iv", "the witcher 4", "witcher4"]
    },
    {
      id: "eldenring",
      name: "Elden Ring",
      keywords: ["elden ring", "nightreign", "shadow of the erdtree", "erdtree", "malenia", "radahn", "messmer"]
    },
    {
      id: "silksong",
      name: "Hollow Knight: Silksong",
      keywords: ["silksong", "hollow knight", "pharloom"]
    },
    {
      id: "rerequiem",
      name: "Resident Evil Requiem",
      keywords: ["resident evil requiem", "re requiem", "re9", "resident evil 9", "grace ashcroft"]
    },
    {
      id: "wolverine",
      name: "Marvel's Wolverine",
      keywords: ["marvel's wolverine", "marvels wolverine", "wolverine ps5", "insomniac wolverine"]
    },
    {
      id: "bond",
      name: "007 First Light",
      keywords: ["007 first light", "first light 007", "007firstlight"]
    }
  ];

  // Words that turn "someone mentions the game" into "someone might be spoiling it".
  const DEFAULT_SPOILER_TERMS = [
    "spoiler", "spoilers", "spoiled", "spoiling", "spoilt",
    "ending", "endings", "true ending", "secret ending", "final mission", "last mission",
    "final boss", "last boss", "finale", "epilogue", "post credits", "post-credits",
    "plot twist", "twist", "betrayal", "betrays", "dies", "died", "death of", "killed off", "kills",
    "cutscene", "cutscenes", "story recap", "full story", "whole story", "lore dump",
    "leak", "leaks", "leaked", "datamine", "datamined", "dataminers",
    "just finished", "just beat", "beat the game", "finished the game", "100%",
    "спойлер", "спойлеры", "концовка", "концовку", "финал", "слив", "слили",
    "спойлери", "кінцівка"
  ];

  const DEFAULT_SETTINGS = {
    enabled: true,
    action: "blur",            // "blur" | "hide"
    blockAllVideos: false,     // true = every video on X is covered until you click
    hideTrends: true,          // hide trends that mention a muted/shielded topic
    topics: {                  // per preset: "off" | "spoilers" | "mute"
      gta6: "spoilers",
      witcher4: "spoilers",
      eldenring: "spoilers",
      silksong: "spoilers",
      rerequiem: "spoilers",
      wolverine: "spoilers",
      bond: "spoilers"
    },
    customTopics: [],          // [{ id, name, keywords: [], mode }]
    spoilerTerms: DEFAULT_SPOILER_TERMS.slice(),
    blockedAccounts: [],       // handles without "@"
    sites: { x: true, youtube: true, reddit: true, google: true },
    extraSites: []             // other hosts the user turned on, e.g. "www.ign.com"
  };

  function clone(x) {
    return JSON.parse(JSON.stringify(x));
  }

  function normalizeSettings(stored) {
    const s = Object.assign(clone(DEFAULT_SETTINGS), stored || {});
    s.topics = Object.assign(clone(DEFAULT_SETTINGS.topics), (stored && stored.topics) || {});
    if (!Array.isArray(s.customTopics)) s.customTopics = [];
    if (!Array.isArray(s.spoilerTerms)) s.spoilerTerms = DEFAULT_SPOILER_TERMS.slice();
    if (!Array.isArray(s.blockedAccounts)) s.blockedAccounts = [];
    s.sites = Object.assign(clone(DEFAULT_SETTINGS.sites), (stored && stored.sites) || {});
    if (!Array.isArray(s.extraSites)) s.extraSites = [];
    if (s.action !== "hide") s.action = "blur";
    return s;
  }

  function escapeRe(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function termToPattern(term) {
    const t = String(term || "").trim().toLowerCase().replace(/^[#@]+/, "");
    if (!t) return null;
    return t.split(/[\s_\-]+/).filter(Boolean).map(escapeRe).join("[\\s_\\-]*");
  }

  // Whole-word matcher that understands any alphabet (Latin, Cyrillic, ...).
  function compileList(terms) {
    const parts = (terms || []).map(termToPattern).filter(Boolean);
    if (!parts.length) return null;
    parts.sort((a, b) => b.length - a.length);
    return new RegExp("(?<![\\p{L}\\p{N}])(?:" + parts.join("|") + ")(?![\\p{L}\\p{N}])", "iu");
  }

  function parseList(text) {
    return String(text || "")
      .split(/[\n,]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }

  function compile(settingsIn) {
    const settings = normalizeSettings(settingsIn);
    const topics = [];
    for (const p of PRESET_TOPICS) {
      const mode = settings.topics[p.id] || "off";
      if (mode === "off") continue;
      const re = compileList(p.keywords);
      if (re) topics.push({ id: p.id, name: p.name, mode, re });
    }
    for (const c of settings.customTopics) {
      if (!c || c.mode === "off") continue;
      const re = compileList(c.keywords);
      if (re) topics.push({ id: c.id, name: c.name || c.keywords[0], mode: c.mode === "mute" ? "mute" : "spoilers", re });
    }
    // Mute rules win over spoiler rules, so check them first.
    topics.sort((a, b) => (a.mode === "mute" ? 0 : 1) - (b.mode === "mute" ? 0 : 1));
    return {
      topics,
      spoilerRe: compileList(settings.spoilerTerms),
      accounts: new Set(settings.blockedAccounts.map((h) => String(h).trim().replace(/^@/, "").toLowerCase()).filter(Boolean))
    };
  }

  /**
   * @param compiled result of compile()
   * @param input { text: string, handles: string[] }
   * @returns null | { kind: "account" | "muted" | "spoiler", label: string }
   */
  function match(compiled, input) {
    const text = (input && input.text) || "";
    const handles = (input && input.handles) || [];
    for (const h of handles) {
      const handle = String(h).replace(/^@/, "").toLowerCase();
      if (compiled.accounts.has(handle)) return { kind: "account", label: "@" + handle };
    }
    if (!text) return null;
    let spoilerChecked = false;
    let hasSpoilerWord = false;
    for (const t of compiled.topics) {
      if (!t.re.test(text)) continue;
      if (t.mode === "mute") return { kind: "muted", label: t.name };
      if (!spoilerChecked) {
        hasSpoilerWord = !!(compiled.spoilerRe && compiled.spoilerRe.test(text));
        spoilerChecked = true;
      }
      if (hasSpoilerWord) return { kind: "spoiler", label: t.name };
    }
    return null;
  }

  // For trends / search suggestions: any mention of an active topic counts.
  function matchTopic(compiled, text) {
    if (!text) return null;
    for (const t of compiled.topics) if (t.re.test(text)) return t.name;
    return null;
  }

  function siteListed(settings, host) {
    return (settings.extraSites || []).some((h) => h === host);
  }

  const api = {
    siteListed,
    PRESET_TOPICS,
    DEFAULT_SPOILER_TERMS,
    DEFAULT_SETTINGS,
    normalizeSettings,
    compile,
    match,
    matchTopic,
    parseList
  };

  root.HypeBlock = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
