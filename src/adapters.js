/*
 * HypeBlock — per-site adapters.
 * Each adapter tells the engine which elements are "posts" on that site,
 * how to read their text, and what to blur or hide.
 *
 * Rule fields:
 *   sel        CSS selector for the unit (post, video card, result...)
 *   extract    el => { text, handles? }        (default: el.textContent)
 *   key        el => stable id for the unit    (default: hash of the text)
 *   target     el => element that gets covered (default: el)
 *   hide       el => element hidden in "hide" mode (default: target)
 *   banner     el => true to blur the target and put a bar above it
 *                    instead of an overlay (for shadow-DOM hosts)
 *   kind       "trend" = hide on any topic mention (X sidebar)
 *              "image" = blur the picture itself; click it to reveal
 *   big        true = give the covered unit a minimum height
 */
(function (root) {
  "use strict";

  const MAX = 4000;
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim().slice(0, MAX);

  // Joins text nodes with spaces. Plain textContent glues neighbours together
  // ("New" badge + "GTA 6" -> "NewGTA 6"), which breaks whole-word matching.
  function spaced(el) {
    if (!el) return "";
    const parts = [];
    let len = 0;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n && len < MAX; n = walker.nextNode()) {
      const t = n.nodeValue;
      if (t && t.trim()) {
        parts.push(t);
        len += t.length + 1;
      }
    }
    return clean(parts.join(" "));
  }
  const textOf = (el, sel) =>
    sel ? clean(Array.from(el.querySelectorAll(sel), spaced).join(" \n ")) : spaced(el);
  const hrefOf = (el, sel) => {
    const a = el.querySelector(sel);
    return a ? a.getAttribute("href") : "";
  };

  const X = {
    id: "x",
    site: "x",
    hosts: /(^|\.)(x|twitter)\.com$/,
    throttle: 120,
    videoSelector: '[data-testid="videoPlayer"]',
    rules: [
      {
        sel: 'article[data-testid="tweet"]',
        big: true,
        key(el) {
          const time = el.querySelector('a[href*="/status/"] time');
          const link = time && time.closest("a");
          return link ? link.getAttribute("href") : null;
        },
        extract(el) {
          const parts = [];
          el.querySelectorAll('[data-testid="tweetText"], [data-testid="card.wrapper"]').forEach((n) => parts.push(spaced(n)));
          el.querySelectorAll("img[alt]").forEach((n) => {
            const a = n.getAttribute("alt");
            if (a && a !== "Image") parts.push(a);
          });
          const handles = [];
          el.querySelectorAll('[data-testid="User-Name"] a[href^="/"]').forEach((a) => {
            const h = a.getAttribute("href").split("/")[1];
            if (h) handles.push(h);
          });
          return { text: clean(parts.join("\n")), handles };
        },
        hide: (el) => el.closest('[data-testid="cellInnerDiv"]') || el
      },
      { sel: '[data-testid="trend"]', kind: "trend" }
    ]
  };

  const YOUTUBE = {
    id: "youtube",
    site: "youtube",
    hosts: /(^|\.)youtube\.com$/,
    throttle: 200,
    rules: [
      {
        // Video cards: home grid, search, sidebar, shorts shelves, playlists, channels
        sel: [
          "ytd-rich-item-renderer",
          "ytd-video-renderer",
          "ytd-compact-video-renderer",
          "ytd-grid-video-renderer",
          "ytd-reel-item-renderer",
          "ytd-playlist-renderer",
          "ytd-radio-renderer",
          "ytd-channel-renderer",
          "yt-lockup-view-model",
          "ytm-shorts-lockup-view-model",
          "ytm-shorts-lockup-view-model-v2",
          ".ytp-videowall-still",
          ".ytp-autonav-endscreen-upnext-container",
          ".ytp-ce-element"
        ].join(","),
        key: (el) => hrefOf(el, 'a[href*="/watch"], a[href*="/shorts/"], a[href*="/playlist"], a[href^="/@"]') + "|" + clean(el.textContent).slice(0, 80),
        extract: (el) => ({ text: spaced(el) })
      },
      {
        sel: "ytd-comment-thread-renderer, ytd-comment-view-model",
        extract: (el) => ({ text: textOf(el, "#content-text, #author-text") })
      }
    ]
  };

  const REDDIT = {
    id: "reddit",
    site: "reddit",
    hosts: /(^|\.)reddit\.com$/,
    throttle: 200,
    rules: [
      {
        sel: "shreddit-post",
        key: (el) => el.getAttribute("permalink") || el.id,
        extract: (el) => ({
          text: clean([el.getAttribute("post-title"), el.getAttribute("subreddit-prefixed-name"), spaced(el)].join(" \n ")),
          handles: [el.getAttribute("author")].filter(Boolean)
        }),
        target: (el) => el.closest("article") || el,
        banner: (el) => !el.closest("article")
      },
      {
        sel: "shreddit-comment",
        key: (el) => el.getAttribute("thingid"),
        target: (el) => el.querySelector(':scope > [slot="comment"]') || el,
        extract: (el) => ({
          text: textOf(el.querySelector(':scope > [slot="comment"]') || el),
          handles: [el.getAttribute("author")].filter(Boolean)
        }),
        banner: (el) => !el.querySelector(':scope > [slot="comment"]')
      },
      {
        // search results and other post links on new Reddit
        sel: '[data-testid="search-post-unit"], search-telemetry-tracker[data-testid="search-sdui-post"], faceplate-tracker[noun="post"]'
      },
      // old.reddit.com
      { sel: ".thing.link", extract: (el) => ({ text: textOf(el, "a.title, .md, .subreddit") }) },
      {
        sel: ".thing.comment",
        target: (el) => el.querySelector(":scope > .entry") || el,
        extract: (el) => ({ text: textOf(el.querySelector(":scope > .entry") || el, ".md") })
      }
    ]
  };

  const GOOGLE = {
    id: "google",
    site: "google",
    hosts: /(^|\.)google\.[a-z.]+$/,
    throttle: 250,
    rules: [
      {
        // Regular results, video results, "Top stories", "People also ask"
        sel: "#rso .MjjYud, #rso > div > .g, #botstuff .MjjYud, #search g-inner-card, #search .related-question-pair, #search video-voyager, #rhs"
      }
    ]
  };

  const GENERIC = {
    id: "generic",
    site: null,
    hosts: /.*/,
    throttle: 400,
    rules: [
      { sel: 'article, [role="article"]' },
      { sel: "h1, h2, h3, h4, p, li, blockquote, figcaption, dd, td" },
      // Cover art and screenshots: judged by their alt text / title
      {
        sel: "img[alt], img[title]",
        kind: "image",
        key: (el) => "img:" + (el.currentSrc || el.src) + "|" + (el.alt || el.title),
        extract: (el) => ({ text: clean((el.alt || "") + " " + (el.title || "")) })
      }
    ]
  };

  const ADAPTERS = [X, YOUTUBE, REDDIT, GOOGLE];

  // Hosts covered by the extension's install-time permissions.
  const BUILTIN = /(^|\.)(x\.com|twitter\.com|youtube\.com|reddit\.com)$|^www\.google\.com$/;

  function pick(host) {
    const adapter = ADAPTERS.find((a) => a.hosts.test(host)) || GENERIC;
    return { adapter, builtin: BUILTIN.test(host) };
  }

  root.HypeBlockAdapters = { pick, ADAPTERS, GENERIC, BUILTIN, textOf };
})(typeof globalThis !== "undefined" ? globalThis : this);
