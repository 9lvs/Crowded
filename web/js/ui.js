/* Shared UI helpers and components. No framework. Builds DOM nodes directly so user or
   server text is always inserted as text, never as HTML. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});

  // ---------- DOM builder ----------
  // h("div", {class: "x", onclick: fn, "aria-label": "y"}, child, "text", [more])
  function h(tag, attrs) {
    var svgTags = { svg: 1, path: 1, rect: 1, circle: 1, line: 1, g: 1, text: 1, polyline: 1 };
    var el = svgTags[tag]
      ? document.createElementNS("http://www.w3.org/2000/svg", tag)
      : document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k.indexOf("on") === 0 && typeof v === "function") {
          el.addEventListener(k.slice(2), v);
        } else if (k === "class") {
          el.setAttribute("class", v);
        } else if (k === "text") {
          el.textContent = v;
        } else if (k === "html") {
          // Only for trusted, constant markup such as icons below.
          el.innerHTML = v;
        } else if (v === true) {
          el.setAttribute(k, "");
        } else {
          el.setAttribute(k, String(v));
        }
      });
    }
    for (var i = 2; i < arguments.length; i++) append(el, arguments[i]);
    return el;
  }

  function append(el, child) {
    if (child === null || child === undefined || child === false) return;
    if (Array.isArray(child)) {
      child.forEach(function (c) {
        append(el, c);
      });
    } else if (typeof child === "string" || typeof child === "number") {
      el.appendChild(document.createTextNode(String(child)));
    } else {
      el.appendChild(child);
    }
  }

  function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // ---------- Icons (constant, trusted markup) ----------
  var I = {
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    signout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg>'
  };

  function icon(name) {
    var span = h("span", { class: "ic", "aria-hidden": "true", html: I[name] || "" });
    return span.firstChild;
  }

  // ---------- Formatters ----------
  var CROWD_LABEL = { easy: "Easy", busy: "Busy", packed: "Packed" };
  var LINE_SIZES = [
    { value: "none", label: "None", sub: "0" },
    { value: "short", label: "Short", sub: "1 to 10" },
    { value: "medium", label: "Medium", sub: "11 to 25" },
    { value: "long", label: "Long", sub: "26 to 50" },
    { value: "very_long", label: "Huge", sub: "50+" }
  ];

  function fmtPrice(cents) {
    if (cents === null || cents === undefined) return null;
    var dollars = cents / 100;
    return "$" + (cents % 100 === 0 ? String(dollars) : dollars.toFixed(2));
  }

  function fmtClock(totalSeconds) {
    var s = Math.max(0, Math.floor(totalSeconds));
    var hrs = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    var mm = (hrs > 0 && m < 10 ? "0" : "") + m;
    var ss = (sec < 10 ? "0" : "") + sec;
    return (hrs > 0 ? hrs + ":" : "") + mm + ":" + ss;
  }

  function fmtAgo(iso) {
    if (!iso) return "never";
    var diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 15) return "just now";
    if (diff < 60) return Math.floor(diff) + " sec ago";
    if (diff < 3600) return Math.floor(diff / 60) + " min ago";
    if (diff < 86400) return Math.floor(diff / 3600) + " hr ago";
    var days = Math.floor(diff / 86400);
    return days + (days === 1 ? " day ago" : " days ago");
  }

  // ---------- Specials ----------
  var SPECIAL_KINDS = [
    { value: "happy_hour", label: "Happy hour" },
    { value: "drink", label: "Drink" },
    { value: "food", label: "Food" },
    { value: "cover", label: "Cover" },
    { value: "event", label: "Event" }
  ];
  var DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  var DAY_LONG = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  function kindLabel(kind) {
    for (var i = 0; i < SPECIAL_KINDS.length; i++) if (SPECIAL_KINDS[i].value === kind) return SPECIAL_KINDS[i].label;
    return "Special";
  }

  // "17:00" -> "5 PM", "21:30" -> "9:30 PM"
  function fmtTime12(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return "";
    var hr = Number(m[1]);
    var h12 = hr % 12 === 0 ? 12 : hr % 12;
    return h12 + (m[2] === "00" ? "" : ":" + m[2]) + (hr < 12 ? " AM" : " PM");
  }

  function fmtWindow(s) {
    return fmtTime12(s.start_local) + " to " + fmtTime12(s.end_local);
  }

  function coverText(s) {
    if (s.price_cents === null || s.price_cents === undefined) return "Cover";
    return s.price_cents === 0 ? "Free cover" : "Cover " + fmtPrice(s.price_cents);
  }

  // One quiet line for a Tonight row. Prefer something happening now, then cover, then a count.
  // Returns null when the bar has nothing tonight.
  function specialsLine(bar) {
    var list = bar.specials_tonight || [];
    if (!list.length) return null;
    function name(s) {
      if (s.kind === "cover") return coverText(s);
      return s.kind === "happy_hour" ? "Happy hour" : s.title;
    }
    var i;
    for (i = 0; i < list.length; i++) {
      if (list[i].is_now) return name(list[i]) + " now until " + fmtTime12(list[i].end_local);
    }
    var cover = bar.cover_tonight || null;
    if (!cover) {
      for (i = 0; i < list.length; i++) {
        if (list[i].kind === "cover") {
          cover = list[i];
          break;
        }
      }
    }
    if (cover) return coverText(cover) + " from " + fmtTime12(cover.start_local);
    if (list.length === 1) return list[0].title + " from " + fmtTime12(list[0].start_local);
    return list.length + " specials tonight";
  }

  function fmtHour(hour) {
    if (hour === 0) return "12a";
    if (hour === 12) return "12p";
    return hour < 12 ? hour + "a" : hour - 12 + "p";
  }

  function fmtDate(d) {
    return d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
  }

  // ---------- Components ----------

  // Crowd level: label text plus a 3 segment meter. Never color alone.
  function crowd(level, opts) {
    opts = opts || {};
    var label = level ? CROWD_LABEL[level] : "Unknown";
    var m = h(
      "span",
      { class: "meter" + (opts.large ? " meter--lg" : ""), "data-level": level || "none", "aria-hidden": "true" },
      h("span", { class: "meter__seg" }),
      h("span", { class: "meter__seg" }),
      h("span", { class: "meter__seg" })
    );
    if (opts.large || opts.meterOnly) return m;
    return h("span", { class: "crowd", role: "img", "aria-label": "Crowd: " + label }, m, h("span", { "aria-hidden": "true" }, label));
  }

  // Short pass verdict for list rows. Secondary information, so it is plain text.
  function verdictShort(v) {
    var r = v ? v.recommendation : "no_data";
    if (r === "buy_pass") {
      var p = fmtPrice(v.pass_price_cents);
      return "Pass" + (p ? " " + p : "") + " worth it";
    }
    if (r === "wait_it_out") return "Skip the pass";
    if (r === "no_pass_available") return "No pass sold";
    return "No pass call yet";
  }

  function verdictLine(v) {
    var strong = v && v.recommendation === "buy_pass";
    return h("span", { class: "verdict-line" + (strong ? " verdict-line--strong" : ""), text: verdictShort(v) });
  }

  // Typographic wordmark. Optional small suffix such as "for staff".
  function wordmark(suffix) {
    return h(
      "p",
      { class: "wordmark" },
      h("span", { class: "wordmark__name", text: "Crowded" }),
      suffix ? h("span", { class: "wordmark__suffix", text: suffix }) : null
    );
  }

  // Toast
  var toastEl = null;
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) {
      toastEl = h("div", { class: "toast", role: "status", "aria-live": "polite" });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    // force reflow so the transition runs
    void toastEl.offsetWidth;
    toastEl.classList.add("is-open");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("is-open");
    }, 2600);
  }

  // Bottom sheet. content is a node. Returns {close}.
  function sheet(opts) {
    var lastFocus = document.activeElement;
    var scrim = h("div", { class: "scrim" });
    var titleId = "sheet-title-" + Math.random().toString(36).slice(2, 8);
    var panel = h(
      "div",
      { class: "sheet", role: "dialog", "aria-modal": "true", "aria-labelledby": titleId },
      h("div", { class: "sheet__grab", "aria-hidden": "true" }),
      h("h2", { class: "sheet__title", id: titleId, text: opts.title }),
      opts.body ? h("p", { class: "sheet__body", text: opts.body }) : null,
      opts.content || null
    );
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      scrim.classList.remove("is-open");
      panel.classList.remove("is-open");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () {
        scrim.remove();
        panel.remove();
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }, 330);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === "Escape") close();
    }
    scrim.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    document.body.appendChild(scrim);
    document.body.appendChild(panel);
    void panel.offsetWidth;
    scrim.classList.add("is-open");
    panel.classList.add("is-open");
    var first = panel.querySelector("button, input");
    if (first) first.focus({ preventScroll: true });
    return { close: close, el: panel };
  }

  // Segmented control. options: [{value,label,sub}]. Returns {el, get, set}.
  function segmented(opts) {
    var value = opts.value === undefined ? null : opts.value;
    var buttons = [];
    var el = h("div", {
      class: "seg" + (opts.wrap ? " seg--wrap" : ""),
      role: "radiogroup",
      "aria-label": opts.label
    });
    opts.options.forEach(function (o) {
      var b = h(
        "button",
        {
          type: "button",
          class: "seg__opt",
          role: "radio",
          "aria-checked": String(o.value === value),
          onclick: function () {
            set(opts.toggle && value === o.value ? null : o.value);
            if (opts.onChange) opts.onChange(value);
          }
        },
        h("span", { text: o.label }),
        o.sub ? h("small", { text: o.sub }) : null
      );
      b._value = o.value;
      buttons.push(b);
      el.appendChild(b);
    });
    function set(v) {
      value = v;
      buttons.forEach(function (b) {
        b.setAttribute("aria-checked", String(b._value === v));
      });
    }
    return {
      el: el,
      get: function () {
        return value;
      },
      set: set
    };
  }

  // Timer ring. Returns {el, update(elapsedSec, targetSec)}.
  function timerRing() {
    var R = 54;
    var CIRC = 2 * Math.PI * R;
    var prog = h("circle", { class: "ring__prog", cx: 60, cy: 60, r: R, "stroke-dasharray": CIRC.toFixed(2), "stroke-dashoffset": CIRC.toFixed(2) });
    var time = h("div", { class: "ring__time wait-num", "aria-hidden": "true", text: "0:00" });
    var sub = h("div", { class: "ring__sub", text: "" });
    var live = h("span", { class: "sr-only", "aria-live": "polite" });
    var el = h(
      "div",
      { class: "ring" },
      h("svg", { viewBox: "0 0 120 120", "aria-hidden": "true" }, h("circle", { class: "ring__track", cx: 60, cy: 60, r: R }), prog),
      h("div", { class: "ring__center" }, time, sub, live)
    );
    var lastMinute = -1;
    function update(elapsed, target, subText) {
      time.textContent = fmtClock(elapsed);
      sub.textContent = subText || "";
      var frac = target > 0 ? Math.min(elapsed / target, 1) : (elapsed % 3600) / 3600;
      prog.setAttribute("stroke-dashoffset", (CIRC * (1 - frac)).toFixed(2));
      prog.classList.toggle("is-over", target > 0 && elapsed > target);
      var m = Math.floor(elapsed / 60);
      if (m !== lastMinute) {
        lastMinute = m;
        live.textContent = m + " minutes in line";
      }
    }
    return { el: el, update: update };
  }

  // Read location ONCE for this action. Never watches. Resolves null if denied or slow.
  function locationOnce() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) return resolve(null);
      var done = false;
      var t = setTimeout(function () {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 5000);
      try {
        navigator.geolocation.getCurrentPosition(
          function (pos) {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          },
          function () {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(null);
          },
          { enableHighAccuracy: false, timeout: 4500, maximumAge: 60000 }
        );
      } catch (e) {
        done = true;
        clearTimeout(t);
        resolve(null);
      }
    });
  }

  function storage(key, value) {
    try {
      if (value === undefined) return window.localStorage.getItem(key);
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      return null;
    }
    return null;
  }

  function haptic() {
    try {
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) {
      /* ignore */
    }
  }

  C.ui = {
    h: h,
    append: append,
    clear: clear,
    icon: icon,
    crowd: crowd,
    verdictLine: verdictLine,
    verdictShort: verdictShort,
    wordmark: wordmark,
    toast: toast,
    sheet: sheet,
    segmented: segmented,
    timerRing: timerRing,
    locationOnce: locationOnce,
    storage: storage,
    haptic: haptic,
    fmtPrice: fmtPrice,
    fmtClock: fmtClock,
    fmtAgo: fmtAgo,
    fmtHour: fmtHour,
    fmtDate: fmtDate,
    SPECIAL_KINDS: SPECIAL_KINDS,
    DAY_SHORT: DAY_SHORT,
    DAY_LONG: DAY_LONG,
    kindLabel: kindLabel,
    fmtTime12: fmtTime12,
    fmtWindow: fmtWindow,
    coverText: coverText,
    specialsLine: specialsLine,
    CROWD_LABEL: CROWD_LABEL,
    LINE_SIZES: LINE_SIZES
  };
})();
