/*
 * Creekside preview — live WordPress content loader (READ-ONLY).
 *
 * Any element with data-wp-page="<slug>" (and optionally data-wp-id="<id>")
 * gets its static HTML replaced with the matching WordPress page's
 * content.rendered, after sanitizing it. The static HTML stays as the
 * fallback if the request fails or takes longer than TIMEOUT_MS.
 *
 * An element with data-wp-posts gets a list of WordPress posts (if any).
 *
 * Only anonymous GET requests are made to the public WP REST API.
 * No cookies/credentials are sent, nothing is ever written to WordPress.
 */
(function (root) {
  "use strict";

  var WP_ORIGIN = "https://creeksideridingstables.com";
  var API = WP_ORIGIN + "/wp-json/wp/v2";
  var TIMEOUT_MS = 6000;
  var CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  var CACHE_PREFIX = "crk-wp:v1:";

  // WordPress slug / page id  ->  preview page
  var SLUG_TO_PAGE = {
    "home": "index.html",
    "lessons": "lessons.html",
    "riding": "riding.html",
    "prices-offerings": "prices-offerings.html",
    "schedule-your-ride": "schedule-your-ride.html",
    "summer-camps": "summer-camps.html",
    "parties": "parties.html",
    "boarding-at-cheval": "boarding-at-cheval.html",
    "announcements": "announcements.html",
    "contact": "contact.html"
  };
  var ID_TO_PAGE = {
    4: "index.html", 15: "lessons.html", 13: "riding.html",
    6672: "prices-offerings.html", 275: "schedule-your-ride.html",
    17: "summer-camps.html", 225: "parties.html",
    5435: "boarding-at-cheval.html", 8: "announcements.html", 6: "contact.html"
  };

  /* ------------------------------------------------------------------ */
  /* Sanitizer (pure DOM; works in any browser and in jsdom for tests)   */
  /* ------------------------------------------------------------------ */

  // Removed together with everything inside them
  var DROP = {
    SCRIPT: 1, STYLE: 1, LINK: 1, META: 1, BASE: 1, TITLE: 1, HEAD: 1,
    NOSCRIPT: 1, TEMPLATE: 1, OBJECT: 1, EMBED: 1, APPLET: 1, SVG: 1,
    MATH: 1, CANVAS: 1, FORM: 1, INPUT: 1, SELECT: 1, OPTION: 1,
    TEXTAREA: 1, BUTTON: 1, FIELDSET: 1, DIALOG: 1, FRAME: 1, FRAMESET: 1
  };
  // Kept (with filtered attributes). Anything else is unwrapped (children kept).
  var KEEP = {
    P: 1, BR: 1, H1: 1, H2: 1, H3: 1, H4: 1, H5: 1, H6: 1, STRONG: 1, B: 1,
    EM: 1, I: 1, U: 1, S: 1, DEL: 1, INS: 1, SUB: 1, SUP: 1, SMALL: 1,
    MARK: 1, SPAN: 1, A: 1, UL: 1, OL: 1, LI: 1, DL: 1, DT: 1, DD: 1,
    BLOCKQUOTE: 1, HR: 1, IMG: 1, FIGURE: 1, FIGCAPTION: 1, DIV: 1,
    TABLE: 1, THEAD: 1, TBODY: 1, TFOOT: 1, TR: 1, TH: 1, TD: 1,
    CAPTION: 1, PRE: 1, CODE: 1, IFRAME: 1, ADDRESS: 1, CITE: 1, Q: 1
  };
  var ATTRS = {
    "*": ["class", "style", "title", "dir", "lang"],
    A: ["href", "target", "rel"],
    IMG: ["src", "srcset", "sizes", "alt", "width", "height"],
    IFRAME: ["src", "title", "width", "height", "allow", "allowfullscreen"],
    OL: ["start", "type", "reversed"], LI: ["value"],
    TD: ["colspan", "rowspan"], TH: ["colspan", "rowspan", "scope"]
  };
  var CLASS_OK = /^(align(left|right|center|none)|wp-caption(-text)?|gallery(-item|-caption|-icon)?|wp-block-[a-z-]+|has-text-align-[a-z]+)$/;
  var IFRAME_OK = [
    /^https:\/\/(www\.)?youtube(-nocookie)?\.com\/embed\//i,
    /^https:\/\/(www\.)?google\.[a-z.]+\/maps\/embed/i,
    /^https:\/\/maps\.google\.[a-z.]+\//i
  ];
  // Leftover shortcodes from plugins / page builders (the text, not real brackets)
  var SHORTCODE = /\[\/?(bookingpress|booking|appointment|cpabc|cp_|themify|tb_|wpforms|contact-form|caption|gallery|embed|vc_|et_pb|fusion|elementor|insert_php|php)[^\]]*\]/gi;
  var NBSP = "\u00a0";
  var RED = /^(#f00|#ff0000|#e00|#ee0000|#c00|#cc0000|#d00|#dd0000|red|rgb\(\s*255\s*,\s*0\s*,\s*0\s*\))$/i;
  var WHITE = /^(#fff|#ffffff|#fefefe|white|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\))$/i;

  function styleProp(el, prop) {
    var s = el.getAttribute && el.getAttribute("style");
    if (!s) return "";
    var m = s.match(new RegExp("(?:^|;)\\s*" + prop + "\\s*:\\s*([^;]+)", "i"));
    return m ? m[1].trim().replace(/\s*!important$/i, "") : "";
  }

  function unwrap(el) {
    var p = el.parentNode;
    if (!p) return;
    while (el.firstChild) p.insertBefore(el.firstChild, el);
    p.removeChild(el);
  }

  function isJunkText(t) { return /^[\s\u00a0]*s{1,8}[\s\u00a0]*$/.test(t); }

  function absUrl(u) {
    if (!u) return "";
    u = u.trim();
    if (/^\/\//.test(u)) return "https:" + u;
    if (/^\//.test(u)) return WP_ORIGIN + u;
    return u;
  }

  function previewHref(href) {
    var u = absUrl(href);
    var m = u.match(/^https?:\/\/(?:www\.)?creeksideridingstables\.com(\/[^#]*)?(#.*)?$/i);
    if (!m) return null;
    var path = m[1] || "/";
    var hash = m[2] || "";
    var q = path.match(/[?&](?:page_id|p)=(\d+)/);
    if (q) return ID_TO_PAGE[+q[1]] ? ID_TO_PAGE[+q[1]] + hash : null;
    path = path.split("?")[0];
    if (path === "/" || path === "") return "index.html" + hash;
    var seg = path.replace(/^\/+|\/+$/g, "");
    if (seg.indexOf("/") === -1 && SLUG_TO_PAGE[seg]) return SLUG_TO_PAGE[seg] + hash;
    return null;
  }

  function safeHref(href) {
    var u = absUrl(href);
    if (/^(https?:|mailto:|tel:|sms:)/i.test(u) || /^#/.test(u)) return u;
    return null; // javascript:, data:, relative junk, etc.
  }

  function cleanStyle(el, insideLink) {
    var align = styleProp(el, "text-align").toLowerCase();
    var color = styleProp(el, "color").toLowerCase();
    var deco = styleProp(el, "text-decoration").toLowerCase();
    el.removeAttribute("style");
    if (align === "center" || align === "right") el.classList.add("wp-text-" + align);
    if (!insideLink && RED.test(color)) el.classList.add("wp-hl");
    if (deco.indexOf("underline") !== -1 && el.tagName === "SPAN") el.classList.add("wp-u");
  }

  function cleanClasses(el) {
    var keep = [];
    var cls = (el.getAttribute("class") || "").split(/\s+/);
    for (var i = 0; i < cls.length; i++) {
      if (CLASS_OK.test(cls[i]) || /^wp-(text-|hl$|u$)/.test(cls[i])) keep.push(cls[i]);
    }
    if (keep.length) el.setAttribute("class", keep.join(" "));
    else el.removeAttribute("class");
  }

  function sanitizeElement(el, ctx) {
    var tag = el.tagName.toUpperCase();
    var insideLink = !!(el.closest && el.closest("a"));

    // Invisible (white) junk spans: drop the junk text, keep any images inside
    if (tag === "SPAN" && WHITE.test(styleProp(el, "color").toLowerCase())) {
      for (var c = el.firstChild; c; ) {
        var n = c.nextSibling;
        if (c.nodeType === 3 && (isJunkText(c.nodeValue) || !c.nodeValue.trim())) el.removeChild(c);
        c = n;
      }
    }

    // Gmail-pasted emoji images -> the emoji character itself
    if (tag === "IMG" && (el.getAttribute("data-emoji") || /fonts\.gstatic\.com\/s\/e\/notoemoji/.test(el.getAttribute("src") || ""))) {
      var emoji = el.getAttribute("data-emoji") || el.getAttribute("alt") || "";
      el.parentNode.replaceChild(el.ownerDocument.createTextNode(emoji), el);
      return;
    }

    // WordPress post-embed blockquote (its iframe is removed below)
    if (tag === "BLOCKQUOTE" && /wp-embedded-content/.test(el.getAttribute("class") || "")) {
      el.removeAttribute("class");
      el.removeAttribute("data-secret");
      unwrap(el);
      return;
    }

    if (tag === "IFRAME") {
      var src = absUrl(el.getAttribute("src"));
      var ok = IFRAME_OK.some(function (re) { return re.test(src); });
      if (!ok) { el.parentNode.removeChild(el); return; }
    }

    // Filter attributes
    var allowed = ATTRS["*"].concat(ATTRS[tag] || []);
    for (var i = el.attributes.length - 1; i >= 0; i--) {
      var name = el.attributes[i].name.toLowerCase();
      if (allowed.indexOf(name) === -1) el.removeAttribute(el.attributes[i].name);
    }
    cleanStyle(el, insideLink);
    cleanClasses(el);

    if (tag === "A") {
      var href = el.getAttribute("href");
      var local = href && previewHref(href);
      if (local) {
        el.setAttribute("href", local);
        el.removeAttribute("target");
        el.removeAttribute("rel");
      } else {
        var safe = href && safeHref(href);
        if (!safe) { unwrap(el); return; }
        el.setAttribute("href", safe);
        if (/^https?:/i.test(safe)) {
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        }
      }
    } else if (tag === "IMG") {
      var isrc = absUrl(el.getAttribute("src"));
      if (!/^https:\/\//i.test(isrc)) { el.parentNode.removeChild(el); return; }
      el.setAttribute("src", isrc);
      var ss = el.getAttribute("srcset");
      if (ss) {
        el.setAttribute("srcset", ss.split(",").map(function (part) {
          var bits = part.trim().split(/\s+/);
          bits[0] = absUrl(bits[0]);
          return /^https:\/\//i.test(bits[0]) ? bits.join(" ") : "";
        }).filter(Boolean).join(", "));
      }
      el.setAttribute("loading", "lazy");
      el.setAttribute("decoding", "async");
      if (!el.hasAttribute("alt")) el.setAttribute("alt", "");
    } else if (tag === "IFRAME") {
      el.setAttribute("src", absUrl(el.getAttribute("src")));
      el.setAttribute("loading", "lazy");
      el.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
      el.setAttribute("sandbox", "allow-scripts allow-same-origin allow-popups allow-presentation");
      el.removeAttribute("width");
      el.removeAttribute("height");
      if (!el.hasAttribute("title")) el.setAttribute("title", "Embedded video");
      // responsive wrapper
      var p = el.parentNode;
      if (!(p && p.classList && p.classList.contains("wp-embed"))) {
        var wrap = el.ownerDocument.createElement("div");
        wrap.className = "wp-embed";
        p.insertBefore(wrap, el);
        wrap.appendChild(el);
      }
    } else if (tag === "H1") {
      // The page title is the only <h1>; demote content h1s
      var h2 = el.ownerDocument.createElement("h2");
      while (el.firstChild) h2.appendChild(el.firstChild);
      for (var k = 0; k < el.attributes.length; k++) h2.setAttribute(el.attributes[k].name, el.attributes[k].value);
      el.parentNode.replaceChild(h2, el);
    }
  }

  function walk(node, ctx) {
    var child = node.firstChild;
    while (child) {
      var next = child.nextSibling;
      if (child.nodeType === 8) { // comment (<!--more-->, themify markers…)
        node.removeChild(child);
      } else if (child.nodeType === 1) {
        var tag = child.tagName.toUpperCase();
        if (DROP[tag]) {
          if (tag === "FORM" && ctx.formNote && !ctx.formNoted) {
            var note = child.ownerDocument.createElement("p");
            note.className = "note wp-form-note";
            note.textContent = ctx.formNote;
            node.insertBefore(note, child);
            ctx.formNoted = true;
            ctx.removedForms++;
          } else if (tag === "FORM") {
            ctx.removedForms++;
          }
          node.removeChild(child);
        } else if (!KEEP[tag]) {
          walk(child, ctx); // children are sanitized first, then lifted out
          unwrap(child);
        } else {
          walk(child, ctx);
          if (child.parentNode) sanitizeElement(child, ctx);
        }
      } else if (child.nodeType === 3) {
        var t = child.nodeValue.replace(SHORTCODE, "");
        if (t !== child.nodeValue) ctx.shortcodes++;
        child.nodeValue = t;
      }
      child = next;
    }
  }

  // Collapse long runs of &nbsp; (used for column alignment in WP) so text can wrap
  function tidyText(rootEl) {
    var doc = rootEl.ownerDocument;
    var tw = doc.createTreeWalker(rootEl, 4 /* SHOW_TEXT */, null, false);
    var nodes = [];
    while (tw.nextNode()) nodes.push(tw.currentNode);
    nodes.forEach(function (n) {
      n.nodeValue = n.nodeValue.replace(/[ \u00a0]{2,}/g, function (run, off, str) {
        if (run.indexOf(NBSP) === -1) return " ";
        var before = str.slice(0, off).replace(/\s+$/, "");
        var after = str.slice(off + run.length);
        if (run.length >= 6 && before && after.trim() && !/[:.,;(\-\u2013\u2014~]$/.test(before)) return " \u00b7 ";
        return " ";
      });
    });
  }

  var EMPTY_OK = { BR: 1, HR: 1, IMG: 1, IFRAME: 1, TD: 1, TH: 1 };
  function isBlank(el) {
    if (EMPTY_OK[el.tagName]) return false;
    if (el.querySelector("img,iframe,hr,table")) return false;
    return !el.textContent.replace(/[\s\u00a0\u200b]+/g, "");
  }

  function pruneEmpty(rootEl) {
    var changed = true, guard = 0;
    while (changed && guard++ < 10) {
      changed = false;
      var all = rootEl.querySelectorAll("p,h1,h2,h3,h4,h5,h6,div,span,strong,b,em,i,u,li,ul,ol,blockquote,figure,figcaption,a,small,del,s");
      for (var i = all.length - 1; i >= 0; i--) {
        var el = all[i];
        if (!el.parentNode) continue;
        // junk paragraphs that are only "s", "ss", "ssssss"…
        if (/^(P|DIV|SPAN)$/.test(el.tagName) && !el.querySelector("img,iframe") && isJunkText(el.textContent) && el.textContent.trim()) {
          el.parentNode.removeChild(el); changed = true; continue;
        }
        if (isBlank(el)) { el.parentNode.removeChild(el); changed = true; }
      }
      // trim leading/trailing <br> inside blocks, and collapse 3+ <br>
      var brs = rootEl.querySelectorAll("br");
      for (var j = 0; j < brs.length; j++) {
        var br = brs[j], par = br.parentNode;
        if (!par) continue;
        var prev = br.previousSibling, nxt = br.nextSibling;
        while (prev && prev.nodeType === 3 && !prev.nodeValue.replace(/[\s\u00a0]/g, "")) prev = prev.previousSibling;
        while (nxt && nxt.nodeType === 3 && !nxt.nodeValue.replace(/[\s\u00a0]/g, "")) nxt = nxt.nextSibling;
        if (!prev || !nxt || (nxt.nodeName === "BR" && nxt.nextSibling && nxt.nextSibling.nodeName === "BR")) {
          par.removeChild(br); changed = true;
        }
      }
    }
    // top-level stray <br>s and whitespace text between blocks
    for (var c = rootEl.firstChild; c; ) {
      var n = c.nextSibling;
      if (c.nodeName === "BR" || (c.nodeType === 3 && !c.nodeValue.replace(/[\s\u00a0]/g, ""))) rootEl.removeChild(c);
      c = n;
    }
  }

  // Flatten Gmail/Themify wrapper <div>s: unwrap block containers, turn text-only divs into <p>
  var BLOCKS = "p,h1,h2,h3,h4,h5,h6,ul,ol,div,figure,blockquote,table,hr,pre,dl";
  function flattenDivs(rootEl) {
    var divs = rootEl.querySelectorAll("div");
    for (var i = divs.length - 1; i >= 0; i--) {
      var d = divs[i];
      if (!d.parentNode || d.getAttribute("class")) continue;
      if (d.querySelector(BLOCKS)) { unwrap(d); continue; }
      var p = d.ownerDocument.createElement("p");
      while (d.firstChild) p.appendChild(d.firstChild);
      if (d.getAttribute("dir")) p.setAttribute("dir", d.getAttribute("dir"));
      d.parentNode.replaceChild(p, d);
    }
    // a form note can't live inside a heading: move it after the heading
    var notes = rootEl.querySelectorAll(".wp-form-note");
    for (var j = 0; j < notes.length; j++) {
      var h = notes[j].parentNode;
      while (h && h !== rootEl && !/^(H[1-6]|P|SPAN|STRONG|B)$/.test(h.tagName || "")) h = h.parentNode;
      var top = notes[j];
      while (top.parentNode && top.parentNode !== rootEl) top = top.parentNode;
      if (top !== notes[j]) rootEl.insertBefore(notes[j], top.nextSibling);
    }
  }

  /**
   * sanitize(html, doc, opts) -> { node: <div class="wp-live">, stats }
   * doc: a Document used for parsing (DOMParser result or jsdom document)
   */
  function sanitize(html, doc, opts) {
    opts = opts || {};
    var ctx = { formNote: opts.formNote || "", formNoted: false, removedForms: 0, shortcodes: 0 };
    var parsed;
    if (typeof DOMParser !== "undefined" && !opts.parse) {
      parsed = new DOMParser().parseFromString("<!DOCTYPE html><body>" + (html || "") + "</body>", "text/html");
    } else {
      parsed = opts.parse(html || "");
    }
    var body = parsed.body;
    walk(body, ctx);
    flattenDivs(body);
    tidyText(body);
    pruneEmpty(body);
    var out = (doc || parsed).createElement("div");
    out.className = "wp-live";
    var imported = (doc && doc !== parsed) ? doc.importNode(body, true) : body;
    while (imported.firstChild) out.appendChild(imported.firstChild);
    return { node: out, stats: ctx };
  }

  /* ------------------------------------------------------------------ */
  /* Fetch with timeout + sessionStorage cache (GET only)               */
  /* ------------------------------------------------------------------ */

  function cacheGet(key) {
    try {
      var raw = root.sessionStorage.getItem(CACHE_PREFIX + key);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      if (Date.now() - obj.t > CACHE_TTL_MS) return null;
      return obj.d;
    } catch (e) { return null; }
  }
  function cacheSet(key, data) {
    try { root.sessionStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ t: Date.now(), d: data })); } catch (e) {}
  }

  function getJSON(url) {
    var cached = cacheGet(url);
    if (cached) return Promise.resolve(cached);
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer;
    var timeout = new Promise(function (_, reject) {
      timer = setTimeout(function () { if (ctrl) ctrl.abort(); reject(new Error("timeout")); }, TIMEOUT_MS);
    });
    var req = fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-cache",
      headers: { Accept: "application/json" },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
    return Promise.race([req, timeout]).then(function (data) {
      clearTimeout(timer);
      cacheSet(url, data);
      return data;
    }, function (err) { clearTimeout(timer); throw err; });
  }

  var FIELDS = "_fields=id,slug,title,content,modified,link";

  function fetchPage(slug, id) {
    var bySlug = function () {
      return getJSON(API + "/pages?slug=" + encodeURIComponent(slug) + "&" + FIELDS).then(function (arr) {
        if (!arr || !arr.length) throw new Error("no page for slug " + slug);
        return arr[0];
      });
    };
    if (id) {
      return getJSON(API + "/pages/" + encodeURIComponent(id) + "?" + FIELDS).catch(function (e) {
        if (slug) return bySlug();
        throw e;
      });
    }
    return bySlug();
  }

  function decodeEntities(s) {
    var t = document.createElement("textarea");
    t.innerHTML = s || "";
    return t.value;
  }

  function fmtDate(iso) {
    try {
      return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
    } catch (e) { return iso; }
  }

  /* ------------------------------------------------------------------ */
  /* Page wiring                                                         */
  /* ------------------------------------------------------------------ */

  function loadPage(el) {
    var slug = el.getAttribute("data-wp-page");
    var id = el.getAttribute("data-wp-id");
    el.setAttribute("data-wp-state", "loading");
    return fetchPage(slug, id).then(function (page) {
      var res = sanitize(page.content && page.content.rendered, document, {
        formNote: el.getAttribute("data-wp-form-note") || ""
      });
      var live = res.node;
      if (!live.textContent.replace(/[\s\u00a0]+/g, "") && !live.querySelector("img")) {
        throw new Error("empty content");
      }
      var frag = document.createDocumentFragment();
      var h1 = document.createElement("h1");
      h1.textContent = decodeEntities(page.title && page.title.rendered) || "";
      if (h1.textContent) frag.appendChild(h1);
      frag.appendChild(live);
      if (page.modified) {
        var upd = document.createElement("p");
        upd.className = "note wp-updated";
        upd.textContent = "Last updated " + fmtDate(page.modified);
        frag.appendChild(upd);
      }
      el.innerHTML = "";
      el.appendChild(frag);
      el.setAttribute("data-wp-state", "live");
      el.setAttribute("data-wp-loaded-id", page.id);
    }).catch(function (err) {
      el.setAttribute("data-wp-state", "fallback");
      if (root.console) console.info("[wp] keeping static content for", slug || id, "-", err && err.message);
    });
  }

  function loadPosts(el) {
    var n = parseInt(el.getAttribute("data-wp-posts"), 10) || 10;
    return getJSON(API + "/posts?per_page=" + n + "&_embed").then(function (posts) {
      if (!posts || !posts.length) { el.setAttribute("data-wp-state", "empty"); return; }
      var h = document.createElement("h2");
      h.textContent = "Latest news";
      var list = document.createElement("div");
      list.className = "wp-posts";
      posts.forEach(function (post) {
        var art = document.createElement("article");
        art.className = "wp-post";
        var h3 = document.createElement("h3");
        var a = document.createElement("a");
        a.href = safeHref(post.link) || "#";
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = decodeEntities(post.title && post.title.rendered) || "(untitled)";
        h3.appendChild(a);
        var meta = document.createElement("p");
        meta.className = "note";
        meta.textContent = fmtDate(post.date);
        art.appendChild(h3);
        art.appendChild(meta);
        var media = post._embedded && post._embedded["wp:featuredmedia"] && post._embedded["wp:featuredmedia"][0];
        var msrc = media && media.media_details && media.media_details.sizes &&
          ((media.media_details.sizes.medium || media.media_details.sizes.thumbnail || {}).source_url);
        if (msrc && /^https:\/\//.test(msrc)) {
          var img = document.createElement("img");
          img.src = msrc; img.alt = ""; img.loading = "lazy"; img.decoding = "async";
          img.className = "wp-post-thumb";
          art.appendChild(img);
        }
        var ex = sanitize(post.excerpt && post.excerpt.rendered, document, {}).node;
        ex.className = "wp-live wp-excerpt";
        art.appendChild(ex);
        var more = document.createElement("p");
        var ma = a.cloneNode(false);
        ma.textContent = "Read more →";
        more.appendChild(ma);
        art.appendChild(more);
        list.appendChild(art);
      });
      el.innerHTML = "";
      el.appendChild(h);
      el.appendChild(list);
      el.hidden = false;
      el.setAttribute("data-wp-state", "live");
    }).catch(function (err) {
      el.setAttribute("data-wp-state", "fallback");
      if (root.console) console.info("[wp] posts unavailable -", err && err.message);
    });
  }

  function init() {
    if (typeof fetch === "undefined") return;
    var pages = document.querySelectorAll("[data-wp-page],[data-wp-id]");
    for (var i = 0; i < pages.length; i++) loadPage(pages[i]);
    var posts = document.querySelectorAll("[data-wp-posts]");
    for (var j = 0; j < posts.length; j++) loadPosts(posts[j]);
  }

  var api = { sanitize: sanitize, previewHref: previewHref, SLUG_TO_PAGE: SLUG_TO_PAGE, ID_TO_PAGE: ID_TO_PAGE };
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  } else {
    root.CreeksideWP = api;
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})(typeof window !== "undefined" ? window : globalThis);
