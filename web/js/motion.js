/* Motion: press feedback, screen transitions, edge swipe back, sheet drag and number ticks.
   All timing comes from the motion tokens in css/tokens.css (shared with the iOS app).
   Only transform and opacity move. will-change is set only while something moves.
   No inline style attributes: movement uses el.style.setProperty and the Web Animations API. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var docEl = document.documentElement;

  var EDGE_PX = 24; // a back swipe must start this close to the left edge
  var LOCK_PX = 10; // movement before we decide horizontal or vertical
  var FINISH_AT = 0.35; // release past this share of the width to go back
  var FLING = 0.5; // px per ms that counts as a fling
  var PRESS_MIN_MS = 90; // a quick tap stays visibly pressed this long

  // ---------- environment ----------
  function mq(q) {
    try {
      return window.matchMedia(q).matches;
    } catch (e) {
      return false;
    }
  }

  function reduced() {
    return mq("(prefers-reduced-motion: reduce)");
  }

  function cssValue(name) {
    try {
      return getComputedStyle(docEl).getPropertyValue(name).trim();
    } catch (e) {
      return "";
    }
  }

  function ms(name, fallback) {
    var v = cssValue(name);
    var n = parseFloat(v);
    if (isNaN(n)) return fallback;
    return /ms$/.test(v) ? n : /s$/.test(v) ? n * 1000 : n;
  }

  function num(name, fallback) {
    var n = parseFloat(cssValue(name));
    return isNaN(n) ? fallback : n;
  }

  function ease(which) {
    return cssValue(which === "exit" ? "--ease-exit" : "--ease-enter") || (which === "exit" ? "cubic-bezier(0.4, 0, 1, 1)" : "cubic-bezier(0.2, 0, 0, 1)");
  }

  var ua = navigator.userAgent || "";
  var isIOS = /iP(hone|od|ad)/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

  function standalone() {
    return mq("(display-mode: standalone)") || navigator.standalone === true;
  }

  function touchCapable() {
    return "ontouchstart" in window || navigator.maxTouchPoints > 0;
  }

  // Mobile Safari in a browser tab has its own edge swipe that runs history back. Ours would
  // fight it, so the custom gesture runs only as a home screen app or on other touch devices.
  function customSwipe() {
    return touchCapable() && (standalone() || !isIOS);
  }

  function swipeMode() {
    return customSwipe() ? "custom" : isIOS && touchCapable() ? "native" : "off";
  }
  docEl.setAttribute("data-edge-swipe", swipeMode());

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* ignore */
    }
  }

  // ---------- press feedback ----------
  // CSS :active does the press for mouse and keyboard. Pointer events add .is-pressed so a
  // quick touch still shows it, and it springs back on release.
  var pressed = null;
  var pressedAt = 0;

  function pressTarget(node) {
    var el = node && node.closest ? node.closest(".tap") : null;
    if (!el || el.disabled || el.getAttribute("aria-disabled") === "true") return null;
    return el;
  }

  function release(now) {
    if (!pressed) return;
    var el = pressed;
    pressed = null;
    var wait = now ? 0 : Math.max(0, PRESS_MIN_MS - (Date.now() - pressedAt));
    if (!wait) el.classList.remove("is-pressed");
    else
      setTimeout(function () {
        if (pressed !== el) el.classList.remove("is-pressed");
      }, wait);
  }

  document.addEventListener(
    "pointerdown",
    function (e) {
      if (e.button) return;
      var el = pressTarget(e.target);
      release(true);
      if (!el) return;
      pressed = el;
      pressedAt = Date.now();
      el.classList.add("is-pressed");
    },
    { passive: true }
  );
  document.addEventListener("pointerup", function () { release(false); }, { passive: true });
  document.addEventListener("pointercancel", function () { release(true); }, { passive: true });
  document.addEventListener(
    "pointerout",
    function (e) {
      if (pressed && (!e.relatedTarget || !pressed.contains(e.relatedTarget)) && e.pointerType === "mouse") release(true);
    },
    { passive: true }
  );
  // A drag that turns into a scroll is not a press.
  window.addEventListener("scroll", function () { release(true); }, { passive: true });

  // A light tick on primary actions. The door keeps its own stronger vibration.
  document.addEventListener(
    "click",
    function (e) {
      var el = e.target && e.target.closest ? e.target.closest(".btn--primary") : null;
      if (el && !el.disabled) vibrate(8);
    },
    true
  );

  // ---------- animation helpers ----------
  function animate(el, frames, duration, easing) {
    if (!el || !el.animate) return null;
    try {
      return el.animate(frames, { duration: duration, easing: easing, fill: "forwards" });
    } catch (e) {
      return null;
    }
  }

  function done(anims) {
    return Promise.all(
      anims
        .filter(function (a) {
          return a;
        })
        .map(function (a) {
          return a.finished.catch(function () {});
        })
    );
  }

  function tx(px) {
    return "translate3d(" + px + "px, 0, 0)";
  }

  function txPct(pct) {
    return "translate3d(" + pct + "%, 0, 0)";
  }

  // Pin a layer to the viewport so it can move, keeping what was on screen in place.
  function pin(layer, scrollTop, role) {
    layer.classList.add("is-moving", role === "top" ? "is-top" : "is-under");
    layer.scrollTop = scrollTop || 0;
  }

  function unpin(layer) {
    layer.classList.remove("is-moving", "is-top", "is-under", "is-fade");
    layer.style.removeProperty("transform");
    layer.style.removeProperty("opacity");
    var shade = layer.querySelector(":scope > .layer__shade");
    if (shade) shade.remove();
  }

  function shadeOf(layer) {
    var s = layer.querySelector(":scope > .layer__shade");
    if (!s) {
      s = document.createElement("div");
      s.className = "layer__shade";
      s.setAttribute("aria-hidden", "true");
      layer.appendChild(s);
    }
    return s;
  }

  function cancelAll(anims) {
    anims.forEach(function (a) {
      if (a) {
        try {
          a.cancel();
        } catch (e) {
          /* ignore */
        }
      }
    });
  }

  // ---------- screen transitions ----------
  // type: "push" (new slides in from the right), "back" (reverse), "fade" (tab crossfade),
  // "none". Old layer is removed when it ends. Returns a promise.
  var active = null;

  function settle() {
    if (active) active.finish();
  }

  function swap(oldLayer, newLayer, type, opts) {
    opts = opts || {};
    settle();
    var toScroll = opts.toScroll || 0;
    if (!oldLayer || type === "none") {
      if (oldLayer) oldLayer.remove();
      window.scrollTo(0, toScroll);
      return Promise.resolve();
    }
    if (reduced() && (type === "push" || type === "back")) type = "fade";
    var fromScroll = opts.fromScroll === undefined ? window.scrollY : opts.fromScroll;
    var anims = [];
    var dim = num("--push-dim", 0.12);
    var shift = num("--push-shift", -25);
    var screenMs = ms("--motion-screen", 240);
    var enter = ease("enter");

    if (type === "push") {
      pin(oldLayer, fromScroll, "under");
      pin(newLayer, toScroll, "top");
      anims.push(animate(newLayer, [{ transform: txPct(100) }, { transform: txPct(0) }], screenMs, enter));
      anims.push(animate(oldLayer, [{ transform: txPct(0) }, { transform: txPct(shift) }], screenMs, enter));
      anims.push(animate(shadeOf(oldLayer), [{ opacity: 0 }, { opacity: dim }], screenMs, enter));
    } else if (type === "back") {
      pin(oldLayer, fromScroll, "top");
      pin(newLayer, toScroll, "under");
      anims.push(animate(oldLayer, [{ transform: txPct(0) }, { transform: txPct(100) }], screenMs, enter));
      anims.push(animate(newLayer, [{ transform: txPct(shift) }, { transform: txPct(0) }], screenMs, enter));
      anims.push(animate(shadeOf(newLayer), [{ opacity: dim }, { opacity: 0 }], screenMs, enter));
    } else {
      // Crossfade: the new screen fades in over the old one, so the background never flashes.
      pin(oldLayer, fromScroll, "under");
      pin(newLayer, toScroll, "top");
      newLayer.classList.add("is-fade");
      anims.push(animate(newLayer, [{ opacity: 0 }, { opacity: 1 }], ms("--motion-fade", 160), enter));
    }

    var finished = false;
    var me = {
      finish: function () {
        if (finished) return;
        finished = true;
        if (active === me) active = null;
        oldLayer.remove();
        unpin(newLayer);
        cancelAll(anims);
        window.scrollTo(0, toScroll);
        if (opts.onDone) opts.onDone();
      }
    };
    active = me;
    return done(anims).then(me.finish);
  }

  // ---------- edge swipe back ----------
  // opts: canStart() -> bool, layer() -> current layer, begin() -> under layer (rendered
  // previous screen), commit() runs the history back, cancel() drops the under layer,
  // onDone() after the finish animation.
  var edgeTouch = { active: false, endedAt: 0 };

  // True right after a touch that started at the left edge in iOS Safari. That swipe is the
  // browser's own back gesture, which already animated, so the router should not slide again.
  function nativeBackSwipe() {
    if (swipeMode() !== "native") return false;
    return edgeTouch.active || Date.now() - edgeTouch.endedAt < 800;
  }

  window.addEventListener(
    "touchstart",
    function (e) {
      if (e.touches.length === 1 && e.touches[0].clientX <= EDGE_PX) edgeTouch.active = true;
    },
    { passive: true, capture: true }
  );
  ["touchend", "touchcancel"].forEach(function (ev) {
    window.addEventListener(
      ev,
      function () {
        if (edgeTouch.active) {
          edgeTouch.active = false;
          edgeTouch.endedAt = Date.now();
        }
      },
      { passive: true, capture: true }
    );
  });

  function edgeSwipe(opts) {
    var g = null;

    function begin(t) {
      settle();
      var top = opts.layer();
      if (!top) return false;
      var y = window.scrollY;
      var under = opts.begin();
      if (!under) return false;
      g.top = top;
      g.under = under;
      g.scroll = y;
      g.width = top.getBoundingClientRect().width || window.innerWidth;
      g.reduced = reduced();
      g.dim = num("--push-dim", 0.12);
      g.shift = num("--push-shift", -25) / 100;
      pin(top, y, "top");
      pin(under, 0, "under");
      g.shade = shadeOf(under);
      move(t.clientX - g.x0);
      return true;
    }

    function move(dx) {
      var w = g.width;
      var p = Math.max(0, Math.min(1, dx / w));
      g.p = p;
      if (g.reduced) {
        // No movement in Reduce Motion: the screen fades to show the one underneath.
        g.top.style.setProperty("opacity", String(1 - p * 0.6));
        g.shade.style.setProperty("opacity", "0");
        return;
      }
      g.top.style.setProperty("transform", tx(p * w));
      g.under.style.setProperty("transform", tx(g.shift * w * (1 - p)));
      g.shade.style.setProperty("opacity", String(g.dim * (1 - p)));
    }

    function velocity() {
      var s = g.samples;
      var last = s[s.length - 1];
      for (var i = s.length - 1; i >= 0; i--) {
        if (last.t - s[i].t >= 60 || i === 0) {
          var dt = last.t - s[i].t;
          return dt > 0 ? (last.x - s[i].x) / dt : 0;
        }
      }
      return 0;
    }

    function finish() {
      var v = velocity();
      var go = g.p > FINISH_AT || (v > FLING && g.p > 0.05);
      if (v < -0.2) go = false;
      var top = g.top;
      var under = g.under;
      var shade = g.shade;
      var w = g.width;
      var p = g.p;
      var red = g.reduced;
      var shift = g.shift;
      var dim = g.dim;
      var scroll = g.scroll;
      var screenMs = ms("--motion-screen", 240);
      var enter = ease("enter");
      var anims = [];
      var dur = Math.max(120, Math.round(screenMs * (go ? 1 - p : p) + 40));
      if (red) {
        dur = ms("--motion-fade", 160);
        anims.push(animate(top, [{ opacity: 1 - p * 0.6 }, { opacity: go ? 0 : 1 }], dur, enter));
      } else {
        anims.push(animate(top, [{ transform: tx(p * w) }, { transform: go ? tx(w) : tx(0) }], dur, enter));
        anims.push(animate(under, [{ transform: tx(shift * w * (1 - p)) }, { transform: go ? tx(0) : tx(shift * w) }], dur, enter));
        anims.push(animate(shade, [{ opacity: dim * (1 - p) }, { opacity: go ? 0 : dim }], dur, enter));
      }
      if (go) opts.commit();
      var settled = false;
      var me = {
        finish: function () {
          if (settled) return;
          settled = true;
          if (active === me) active = null;
          cancelAll(anims);
          if (go) {
            top.remove();
            unpin(under);
            window.scrollTo(0, 0);
            if (opts.onDone) opts.onDone();
          } else {
            under.remove();
            unpin(top);
            window.scrollTo(0, scroll);
            opts.cancel();
          }
        }
      };
      active = me;
      done(anims).then(me.finish);
    }

    window.addEventListener(
      "touchstart",
      function (e) {
        g = null;
        if (!customSwipe() || e.touches.length !== 1) return;
        var t = e.touches[0];
        if (t.clientX > EDGE_PX || active || !opts.canStart()) return;
        g = { x0: t.clientX, y0: t.clientY, locked: false, samples: [{ x: t.clientX, t: Date.now() }], p: 0 };
      },
      { passive: true }
    );

    window.addEventListener(
      "touchmove",
      function (e) {
        if (!g) return;
        var t = e.touches[0];
        if (!t) return;
        var dx = t.clientX - g.x0;
        var dy = t.clientY - g.y0;
        if (!g.locked) {
          // Never steal a vertical scroll. Lock only when the movement is clearly horizontal.
          if (Math.abs(dy) > LOCK_PX && Math.abs(dy) >= Math.abs(dx)) {
            g = null;
            return;
          }
          if (dx < -LOCK_PX) {
            g = null;
            return;
          }
          if (dx < LOCK_PX || dx < Math.abs(dy) * 1.5) return;
          g.locked = true;
          if (!begin(t)) {
            g = null;
            return;
          }
        }
        if (e.cancelable) e.preventDefault();
        g.samples.push({ x: t.clientX, t: Date.now() });
        if (g.samples.length > 8) g.samples.shift();
        move(dx);
      },
      { passive: false }
    );

    function end() {
      if (g && g.locked && g.top) finish();
      g = null;
    }
    window.addEventListener("touchend", end, { passive: true });
    window.addEventListener("touchcancel", end, { passive: true });
  }

  // ---------- sheet drag to dismiss ----------
  function sheetDrag(panel, scrim, close) {
    var g = null;
    panel.addEventListener(
      "touchstart",
      function (e) {
        g = null;
        if (e.touches.length !== 1 || panel.scrollTop > 0) return;
        var t = e.touches[0];
        g = { y0: t.clientY, x0: t.clientX, locked: false, dy: 0, samples: [{ y: t.clientY, t: Date.now() }] };
      },
      { passive: true }
    );
    panel.addEventListener(
      "touchmove",
      function (e) {
        if (!g) return;
        var t = e.touches[0];
        var dy = t.clientY - g.y0;
        var dx = t.clientX - g.x0;
        if (!g.locked) {
          if (Math.abs(dx) > LOCK_PX && Math.abs(dx) > Math.abs(dy)) {
            g = null;
            return;
          }
          if (dy < -LOCK_PX || panel.scrollTop > 0) {
            g = null;
            return;
          }
          if (dy < LOCK_PX) return;
          g.locked = true;
          g.h = panel.getBoundingClientRect().height || 1;
          g.red = reduced();
          panel.classList.add("is-dragging");
          scrim.classList.add("is-dragging");
        }
        if (e.cancelable) e.preventDefault();
        g.dy = Math.max(0, dy);
        g.samples.push({ y: t.clientY, t: Date.now() });
        if (g.samples.length > 8) g.samples.shift();
        var p = Math.min(1, g.dy / g.h);
        if (g.red) panel.style.setProperty("opacity", String(1 - p));
        else panel.style.setProperty("transform", "translate3d(0, " + g.dy + "px, 0)");
        scrim.style.setProperty("opacity", String(1 - p));
      },
      { passive: false }
    );
    function end() {
      if (!g || !g.locked) {
        g = null;
        return;
      }
      var s = g.samples;
      var a = s[0];
      var b = s[s.length - 1];
      var v = b.t > a.t ? (b.y - a.y) / (b.t - a.t) : 0;
      var dismiss = g.dy > g.h * 0.25 || v > FLING;
      g = null;
      // Drop the inline values in the same frame as the class change, so the CSS transition
      // runs from where the finger left the sheet.
      panel.classList.remove("is-dragging");
      scrim.classList.remove("is-dragging");
      panel.style.removeProperty("transform");
      panel.style.removeProperty("opacity");
      scrim.style.removeProperty("opacity");
      if (dismiss) close();
    }
    panel.addEventListener("touchend", end, { passive: true });
    panel.addEventListener("touchcancel", end, { passive: true });
  }

  // ---------- small helpers ----------
  // Fade in a view that just replaced another in place (staff tabs, admin sections).
  function fadeIn(el) {
    animate(el, [{ opacity: 0 }, { opacity: 1 }], ms("--motion-fade", 160), ease("enter"));
  }

  // A number that changed in place gets a quick fade.
  function tick(el) {
    if (!el) return;
    el.classList.remove("is-ticking");
    void el.offsetWidth;
    el.classList.add("is-ticking");
    setTimeout(function () {
      el.classList.remove("is-ticking");
    }, ms("--motion-fade", 160) + 40);
  }

  C.motion = {
    reduced: reduced,
    ms: ms,
    swap: swap,
    settle: settle,
    edgeSwipe: edgeSwipe,
    nativeBackSwipe: nativeBackSwipe,
    swipeMode: swipeMode,
    sheetDrag: sheetDrag,
    fadeIn: fadeIn,
    tick: tick,
    vibrate: vibrate,
    busy: function () {
      return !!active;
    }
  };
})();
