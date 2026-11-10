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

  var DRINK_WAITS = [
    { value: "under_5", label: "Under 5 min" },
    { value: "5_to_10", label: "5 to 10" },
    { value: "10_to_20", label: "10 to 20" },
    { value: "over_20", label: "Over 20" }
  ];
  var DRINK_LABEL = { under_5: "Under 5 min", "5_to_10": "5 to 10 min", "10_to_20": "10 to 20 min", over_20: "Over 20 min" };

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
  var DEAL_CATEGORIES = [
    { value: "beer", label: "Beer" },
    { value: "pitchers", label: "Pitchers" },
    { value: "shots", label: "Shots" },
    { value: "mixers", label: "Mixers" },
    { value: "wine", label: "Wine" },
    { value: "food", label: "Food" },
    { value: "other", label: "Other" }
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

  // "21:00" -> "9", "21:30" -> "9:30". No AM or PM, for compact deal headers.
  function fmtTimeShort(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return "";
    var hr = Number(m[1]) % 12;
    return (hr === 0 ? 12 : hr) + (m[2] === "00" ? "" : ":" + m[2]);
  }

  // Lowercase a menu name for a one line summary, but keep ALL CAPS words such as FAKE.
  function shortName(name) {
    return String(name || "")
      .split(" ")
      .map(function (w) {
        return w.length > 1 && w === w.toUpperCase() && /[A-Z]/.test(w) ? w : w.toLowerCase();
      })
      .join(" ");
  }

  function itemLabel(item) {
    return item.price_label + " " + shortName(item.name);
  }

  var GROUP_TITLE = {
    happy_hour: "Happy hour",
    drink: "Drink special",
    food: "Food",
    cover: "Cover",
    event: "Event"
  };

  function flatItems(list) {
    var out = [];
    list.forEach(function (s) {
      (s.items || []).forEach(function (i) {
        out.push(i);
      });
    });
    return out;
  }

  // Minutes since noon, so 2 AM sorts after 9 PM.
  function nightOrder(hhmm) {
    var m = /^(\d{2}):(\d{2})$/.exec(hhmm || "");
    if (!m) return 0;
    return (Number(m[1]) * 60 + Number(m[2]) - 720 + 1440) % 1440;
  }

  // One quiet deal line for a Tonight row, built from specials_tonight.
  // Returns {head, text, plus} or null. The caller truncates text and keeps plus visible.
  function dealsLine(bar) {
    var list = bar.specials_tonight || [];
    if (!list.length) return null;
    var deals = list.filter(function (s) {
      return s.kind !== "cover" && s.kind !== "event";
    });
    var withItems = deals.filter(function (s) {
      return s.items && s.items.length;
    });
    var allNight = flatItems(
      withItems.filter(function (s) {
        return s.all_day;
      })
    );
    var timed = withItems.filter(function (s) {
      return !s.all_day;
    });
    var nowTimed = timed
      .filter(function (s) {
        return s.is_now;
      })
      .sort(function (a, b) {
        return (a.kind === "happy_hour" ? 0 : 1) - (b.kind === "happy_hour" ? 0 : 1);
      });
    var later = timed
      .filter(function (s) {
        return !s.is_now;
      })
      .sort(function (a, b) {
        return nightOrder(a.start_local) - nightOrder(b.start_local);
      });
    var pool;
    if (nowTimed.length) {
      pool = flatItems(nowTimed).concat(allNight);
      return line(GROUP_TITLE[nowTimed[0].kind] + " now:", pool, 2, 0);
    }
    if (later.length) {
      var first = later[0];
      var grp = flatItems(
        later.filter(function (s) {
          return s.start_local === first.start_local;
        })
      );
      return line(GROUP_TITLE[first.kind] + " at " + fmtTimeShort(first.start_local) + ":", grp, 1, allNight.length);
    }
    if (allNight.length) return line("All night:", allNight, 2, 0);

    // Older specials without items: use the title.
    var legacy = deals.filter(function (s) {
      return !(s.items && s.items.length);
    });
    var k;
    for (k = 0; k < legacy.length; k++) {
      if (legacy[k].is_now) return { head: "", text: legacy[k].title + " now until " + fmtTime12(legacy[k].end_local), plus: "" };
    }
    if (legacy.length) return { head: "", text: legacy[0].title + " from " + fmtTime12(legacy[0].start_local), plus: "" };

    var cover = bar.cover_tonight || null;
    if (!cover) {
      for (k = 0; k < list.length; k++) {
        if (list[k].kind === "cover") {
          cover = list[k];
          break;
        }
      }
    }
    if (cover) return { head: "", text: coverText(cover) + (cover.is_now ? " now" : " from " + fmtTime12(cover.start_local)), plus: "" };
    var ev = list[0];
    return { head: "", text: ev.title + (ev.is_now ? " now" : " from " + fmtTime12(ev.start_local)), plus: "" };

    function line(head, items, shown, extra) {
      var n = items.length - shown + extra;
      return {
        head: head,
        text: items.slice(0, shown).map(itemLabel).join(", "),
        plus: n > 0 ? "+" + n : ""
      };
    }
  }

  function dealsLineText(d) {
    return d ? (d.head ? d.head + " " : "") + d.text + (d.plus ? " " + d.plus : "") : "";
  }

  // Price list groups for the bar page. tonight=true adds Now and Starts at status.
  // Returns [{key, title, now, status, items:[{name, price, note, plain}], meta}].
  function dealGroups(specials, tonight) {
    var groups = [];
    var allDay = null;
    specials.forEach(function (s) {
      var rows = dealRows(s);
      if (s.all_day) {
        if (!allDay) {
          allDay = { key: "all-night", title: "All night", now: !!tonight, status: "", items: [], meta: s, order: -1 };
          groups.push(allDay);
        }
        allDay.items = allDay.items.concat(rows);
        if (s.updated_at > allDay.meta.updated_at) allDay.meta = s;
        return;
      }
      var title = GROUP_TITLE[s.kind] || "Special";
      if (s.kind !== "event") title += " " + fmtTimeShort(s.start_local) + " to " + fmtTimeShort(s.end_local);
      var status = "";
      if (tonight) status = s.is_now ? "Until " + fmtTimeShort(s.end_local) : "Starts at " + fmtTimeShort(s.start_local);
      groups.push({ key: s.id, title: title, now: !!(tonight && s.is_now), status: status, items: rows, meta: s, order: nightOrder(s.start_local) });
    });
    groups.sort(function (a, b) {
      return a.order - b.order;
    });
    return groups;
  }

  function dealRows(s) {
    if (s.items && s.items.length) {
      return s.items.map(function (i) {
        return { name: i.name, price: i.price_label, note: i.note || "" };
      });
    }
    if (s.kind === "event") return [{ name: s.title + " from " + fmtTime12(s.start_local), price: "", note: s.details || "", plain: true }];
    var price = s.price_cents === null || s.price_cents === undefined ? "" : s.price_cents === 0 ? "Free" : fmtPrice(s.price_cents);
    return [{ name: s.title, price: price, note: s.details || "" }];
  }

  function postedBy(s) {
    return (s.posted_by === "admin" ? "Posted by Crowded" : "Posted by the bar") + " \u00b7 Updated " + fmtAgo(s.updated_at);
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
    if (opts.cols) el.style.setProperty("grid-template-columns", "repeat(" + opts.cols + ", 1fr)");
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
    dealsLine: dealsLine,
    dealsLineText: dealsLineText,
    dealGroups: dealGroups,
    postedBy: postedBy,
    fmtTimeShort: fmtTimeShort,
    itemLabel: itemLabel,
    DEAL_CATEGORIES: DEAL_CATEGORIES,
    CROWD_LABEL: CROWD_LABEL,
    LINE_SIZES: LINE_SIZES,
    DRINK_WAITS: DRINK_WAITS,
    DRINK_LABEL: DRINK_LABEL
  };
})();
