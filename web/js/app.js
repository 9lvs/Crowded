/* Student app: router and screens (Welcome, Tonight, Bar detail, Timer, Settings). */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var ui = C.ui;
  var api = C.api;
  var h = ui.h;

  var root = document.getElementById("app");
  var current = null; // {refresh?, destroy?}
  var state = { session: null, barsById: {}, ready: false };
  var POLL_MS = 15000;

  // ---------- routing ----------
  function parseHash() {
    var parts = (window.location.hash || "").replace(/^#\/?/, "").split("/");
    return { name: parts[0] || "tonight", param: parts[1] ? decodeURIComponent(parts[1]) : null };
  }

  function go(path) {
    if (window.location.hash === "#" + path) render();
    else window.location.hash = path;
  }

  function render() {
    if (!state.ready) return;
    var r = parseHash();
    if (!api.me && r.name !== "welcome") return go("/welcome");
    if (api.me && r.name === "welcome") return go("/tonight");
    if (current && current.destroy) current.destroy();
    current = null;
    ui.clear(root);
    window.scrollTo(0, 0);
    var screens = { welcome: Welcome, tonight: Tonight, bar: BarDetail, timer: Timer, settings: Settings };
    var screen = screens[r.name] || Tonight;
    current = screen(r.param) || null;
  }

  window.addEventListener("hashchange", render);

  // ---------- polling (only while visible) ----------
  setInterval(function () {
    if (document.visibilityState === "visible" && current && current.refresh) current.refresh();
  }, POLL_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && current && current.refresh) current.refresh();
  });

  // ---------- session clock (1 s tick for any visible timer) ----------
  var tickers = [];
  setInterval(function () {
    tickers.forEach(function (fn) {
      fn();
    });
  }, 1000);
  function addTicker(fn) {
    tickers.push(fn);
    fn();
    return function () {
      tickers = tickers.filter(function (f) {
        return f !== fn;
      });
    };
  }

  function elapsedSec(session) {
    return (Date.now() - new Date(session.started_at).getTime()) / 1000;
  }

  function loadSession() {
    return api.activeSession().then(function (s) {
      state.session = s && s.status === "active" ? s : null;
      return state.session;
    });
  }

  function barName(id) {
    var b = state.barsById[id];
    return b ? b.name : "the bar";
  }

  C.onAuthLost = function () {
    api.setTokens(null);
    api.me = null;
    state.session = null;
    go("/welcome");
  };

  // ---------- shared chrome ----------
  function tabbar(active) {
    function tab(name, label, iconName) {
      return h(
        "a",
        { class: "tab", href: "#/" + name, "aria-current": active === name ? "page" : null },
        ui.icon(iconName),
        h("span", { text: label })
      );
    }
    return h(
      "nav",
      { class: "tabbar", "aria-label": "Main" },
      h("div", { class: "tabbar__inner" }, tab("tonight", "Tonight", "list"), tab("settings", "Settings", "gear"))
    );
  }

  // Persistent bar above the tabs while the user is in a line.
  function sessionBar(cleanups) {
    if (!state.session) return null;
    var s = state.session;
    var time = h("span", { class: "session-bar__time", text: "0:00" });
    cleanups.push(
      addTicker(function () {
        time.textContent = ui.fmtClock(elapsedSec(s));
      })
    );
    return h(
      "div",
      { class: "session-bar" },
      h(
        "div",
        { class: "session-bar__inner" },
        h(
          "button",
          { class: "session-bar__open", type: "button", "aria-label": "Open line timer", onclick: function () { go("/timer"); } },
          h("span", { class: "pulse", "aria-hidden": "true" }),
          h("span", { class: "session-bar__text" }, time, h("span", { class: "session-bar__bar", text: "In line at " + barName(s.bar_id) }))
        ),
        h(
          "button",
          {
            class: "btn btn--accent",
            type: "button",
            onclick: function () {
              go("/timer");
            }
          },
          "I'm inside"
        )
      )
    );
  }

  function mockBanner() {
    return api.isMock ? h("p", { class: "xs faint", text: "Demo mode. Every bar and number here is fake." }) : null;
  }

  // ---------- Welcome ----------
  function Welcome() {
    var box = h("div", null);
    root.appendChild(box);
    C.auth.mount(box, {
      kicker: api.isMock ? "Demo" : null,
      onDone: function () {
        loadSession()
          .catch(function () {})
          .then(function () {
            go("/tonight");
          });
      }
    });
    return null;
  }

  // ---------- Tonight ----------
  function barRow(b) {
    var lv = b.live;
    var wait = lv.has_recent_data && lv.wait_min !== null
      ? h("span", { class: "wait-num wait-num--row" }, String(lv.wait_min), h("span", { class: "unit", text: "min" }))
      : h("span", { class: "wait-none", text: lv.has_recent_data ? "No line data" : "No recent data" });
    var label = b.name + ". " + (lv.wait_min !== null && lv.has_recent_data ? "About " + lv.wait_min + " minute wait. " : "No recent data. ") +
      (lv.crowd_level ? "Crowd " + ui.CROWD_LABEL[lv.crowd_level] + ". " : "") + b.verdict.text;
    return h(
      "li",
      null,
      h(
        "button",
        {
          class: "bar-row",
          type: "button",
          "aria-label": label,
          onclick: function () {
            go("/bar/" + b.id);
          }
        },
        h("p", { class: "bar-row__name", text: b.name }),
        h("div", { class: "bar-row__wait" }, wait),
        h("div", null, lv.crowd_level ? ui.crowd(lv.crowd_level) : h("span", { class: "small faint", text: "Crowd unknown" })),
        h("div", { class: "bar-row__wait" }, ui.verdictChip(b.verdict)),
        h("p", { class: "basis bar-row__basis", text: lv.has_recent_data ? lv.basis.text : "Nobody has reported in the last 30 min" })
      )
    );
  }

  function Tonight() {
    var cleanups = [];
    var list = h("ul", { class: "bar-list", "aria-label": "Bars tonight" });
    for (var i = 0; i < 3; i++) list.appendChild(h("li", { class: "skeleton", "aria-hidden": "true" }));
    var me = api.me;
    var sub = h("p", { class: "head__sub", text: ui.fmtDate(new Date()) + " · Pass when over " + me.wait_threshold_min + " min" });
    var screen = h(
      "main",
      { class: "screen" },
      h("header", { class: "head" }, h("h1", { class: "head__title", text: "Tonight" }), sub),
      list,
      h("div", { class: "head" }, mockBanner())
    );
    var chrome = h("div", null);
    root.appendChild(screen);
    root.appendChild(chrome);
    root.appendChild(tabbar("tonight"));

    function drawChrome() {
      cleanups.forEach(function (f) {
        f();
      });
      cleanups = [];
      ui.clear(chrome);
      var sb = sessionBar(cleanups);
      screen.classList.toggle("screen--with-session", !!sb);
      if (sb) chrome.appendChild(sb);
    }

    function refresh() {
      return Promise.all([api.bars(), loadSession().catch(function () { return state.session; })])
        .then(function (res) {
          var bars = res[0];
          ui.clear(list);
          bars.forEach(function (b) {
            state.barsById[b.id] = b;
          });
          if (!bars.length) {
            list.appendChild(h("li", { class: "empty", text: "No bars yet. Check back soon." }));
          }
          bars.forEach(function (b) {
            list.appendChild(barRow(b));
          });
          drawChrome();
        })
        .catch(function (e) {
          if (e.status !== 401 && e.status !== 429) ui.toast(e.detail || "Could not load bars");
        });
    }

    drawChrome();
    refresh();
    return {
      refresh: refresh,
      destroy: function () {
        cleanups.forEach(function (f) {
          f();
        });
      }
    };
  }

  // ---------- Bar detail ----------
  function chart(points) {
    var W = 340;
    var H = 150;
    var top = 18;
    var bottom = 22;
    var left = 26;
    var plotH = H - top - bottom;
    var n = points.length || 1;
    var slot = (W - left) / n;
    var max = 10;
    var lastTonight = -1;
    points.forEach(function (p, i) {
      max = Math.max(max, p.typical_wait_min || 0, p.tonight_wait_min || 0);
      if (p.tonight_wait_min !== null && p.tonight_wait_min !== undefined) lastTonight = i;
    });
    max = Math.ceil(max / 10) * 10;
    function y(v) {
      return top + plotH - (v / max) * plotH;
    }
    var svg = h("svg", { class: "chart", viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": chartLabel(points) });
    [0, max / 2, max].forEach(function (v) {
      svg.appendChild(h("line", { class: "grid", x1: left, x2: W, y1: y(v), y2: y(v) }));
      var t = h("text", { x: 0, y: y(v) + 3 });
      t.textContent = v + "m";
      svg.appendChild(t);
    });
    points.forEach(function (p, i) {
      var x = left + i * slot;
      var bw = slot * 0.62;
      var bx = x + (slot - bw) / 2;
      if (p.typical_wait_min !== null && p.typical_wait_min !== undefined) {
        var th = Math.max(2, (p.typical_wait_min / max) * plotH);
        svg.appendChild(h("rect", { class: "bar-typ", x: bx, y: top + plotH - th, width: bw, height: th, rx: 3 }));
      }
      if (p.tonight_wait_min !== null && p.tonight_wait_min !== undefined) {
        var nw = bw * 0.5;
        var nh = Math.max(2, (p.tonight_wait_min / max) * plotH);
        svg.appendChild(
          h("rect", {
            class: "bar-now" + (i === lastTonight ? " bar-now--current" : ""),
            x: x + (slot - nw) / 2,
            y: top + plotH - nh,
            width: nw,
            height: nh,
            rx: 2
          })
        );
        if (i === lastTonight) {
          var vl = h("text", { x: x + slot / 2, y: top + plotH - nh - 5, "text-anchor": "middle", "font-weight": "700" });
          vl.textContent = String(p.tonight_wait_min);
          svg.appendChild(vl);
        }
      }
      var lbl = h("text", { x: x + slot / 2, y: H - 6, "text-anchor": "middle" });
      lbl.textContent = ui.fmtHour(p.hour);
      svg.appendChild(lbl);
    });
    return svg;
  }

  function chartLabel(points) {
    var parts = points
      .filter(function (p) {
        return p.typical_wait_min !== null || p.tonight_wait_min !== null;
      })
      .map(function (p) {
        return ui.fmtHour(p.hour) + " typical " + (p.typical_wait_min === null ? "unknown" : p.typical_wait_min + " min") +
          (p.tonight_wait_min === null ? "" : ", tonight " + p.tonight_wait_min + " min");
      });
    return "Wait by hour. " + parts.join(". ");
  }

  function BarDetail(id) {
    var cleanups = [];
    var body = h("div", null, h("div", { class: "skeleton", "aria-hidden": "true" }), h("div", { class: "skeleton", "aria-hidden": "true" }));
    var screen = h(
      "main",
      { class: "screen" },
      h(
        "div",
        { class: "topbar" },
        h(
          "button",
          {
            class: "icon-btn",
            type: "button",
            "aria-label": "Back to Tonight",
            onclick: function () {
              go("/tonight");
            }
          },
          ui.icon("back")
        )
      ),
      body
    );
    var cta = h("div", { class: "sticky-cta" });
    root.appendChild(screen);
    root.appendChild(cta);
    var heroNum = null;
    var bar = null;

    function draw(b) {
      bar = b;
      state.barsById[b.id] = b;
      var lv = b.live;
      var hasWait = lv.has_recent_data && lv.wait_min !== null;
      var me = api.me;
      ui.clear(body);

      // hero
      heroNum = h("div", { class: "wait-num hero__num", "aria-live": "polite" });
      var hero;
      if (hasWait) {
        ui.append(heroNum, [String(lv.wait_min), h("span", { class: "unit", text: "min" })]);
        hero = h(
          "section",
          { class: "hero", "aria-label": "Estimated wait" },
          h("p", { class: "hero__label", text: "Estimated wait" }),
          heroNum,
          h("p", { class: "hero__range", text: lv.wait_low_min + " to " + lv.wait_high_min + " min" }),
          h("p", { class: "basis", text: lv.basis.text })
        );
      } else {
        hero = h(
          "section",
          { class: "hero", "aria-label": "Estimated wait" },
          h("p", { class: "hero__label", text: "Estimated wait" }),
          h("p", { class: "hero__none", "aria-live": "polite", text: lv.has_recent_data ? "Not enough line data" : "No recent data" }),
          h("p", { class: "basis", text: lv.has_recent_data ? lv.basis.text : "Nobody has reported in the last 30 min. Be the first." })
        );
      }

      // verdict
      var v = b.verdict;
      var kicker = "The call";
      var verdictCard = h(
        "section",
        { class: "verdict-card" + (v.recommendation === "buy_pass" ? " verdict-card--pass" : ""), "aria-label": "Verdict" },
        h("p", { class: "verdict-card__kicker" }, h("span", { class: "verdict-card__dot", "aria-hidden": "true" }), kicker),
        h("p", { class: "verdict-card__text", text: v.text }),
        h(
          "p",
          { class: "verdict-card__foot" },
          "Your limit is " + me.wait_threshold_min + " min. ",
          h("a", { href: "#/settings", class: "link-btn", text: "Change" })
        )
      );

      // crowd
      var ratio = lv.capacity_ratio;
      var crowdStat;
      if (lv.headcount !== null && ratio !== null) {
        var fill = h("div", { class: "cap__fill", "data-level": lv.crowd_level || "" });
        fill.style.setProperty("width", Math.min(100, Math.round(ratio * 100)) + "%");
        crowdStat = h(
          "li",
          { class: "stat stat--stack" },
          h(
            "div",
            { class: "stat__row" },
            ui.crowd(lv.crowd_level),
            h("span", { class: "stat__value", text: lv.headcount + " / " + b.capacity + " · " + Math.round(ratio * 100) + "%" })
          ),
          h("div", { class: "cap", role: "img", "aria-label": lv.headcount + " of " + b.capacity + " capacity" }, fill)
        );
      } else {
        crowdStat = h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Crowd level" }),
          lv.crowd_level ? ui.crowd(lv.crowd_level) : h("span", { class: "stat__value faint", text: "Unknown" })
        );
      }

      var price = ui.fmtPrice(b.pass_price_cents);
      var stats = h(
        "ul",
        { class: "stats" },
        crowdStat,
        h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Normal wait at this hour" }),
          h("span", { class: "stat__value", text: b.normal_wait_min === null ? "Not enough history" : b.normal_wait_min + " min" })
        ),
        h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Line skip pass" }),
          h("span", { class: "stat__value", text: price || "Not sold here" })
        ),
        h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Capacity" }),
          h("span", { class: "stat__value", text: b.capacity + " people" })
        )
      );

      ui.append(body, [
        h("h1", { class: "detail__name", text: b.name }),
        h("p", { class: "small muted", text: b.address }),
        hero,
        verdictCard,
        h("h2", { class: "section-title", text: "Crowd" }),
        stats,
        h("h2", { class: "section-title", text: "Wait by hour" }),
        chart(b.wait_by_hour || []),
        h(
          "p",
          { class: "legend" },
          h("span", null, h("i", { class: "sw-typ" }), "Typical"),
          h("span", null, h("i", { class: "sw-now" }), "Tonight"),
          h("span", null, h("i", { class: "sw-cur" }), "Now")
        ),
        mockBanner()
      ]);
      drawCta();
    }

    function drawCta() {
      ui.clear(cta);
      cleanups.forEach(function (f) {
        f();
      });
      cleanups = [];
      var inner = h("div", { class: "sticky-cta__inner" });
      var s = state.session;
      var report = h("button", { class: "btn btn--secondary btn--lg", type: "button", onclick: openReport }, "Report");
      var primary;
      if (s) {
        var t = h("span", { text: "" });
        cleanups.push(
          addTicker(function () {
            t.textContent = ui.fmtClock(elapsedSec(s));
          })
        );
        primary = h(
          "button",
          {
            class: "btn btn--accent btn--lg",
            type: "button",
            onclick: function () {
              go("/timer");
            }
          },
          s.bar_id === id ? "In line · " : "In line elsewhere · ",
          t
        );
      } else {
        primary = h("button", { class: "btn btn--primary btn--lg", type: "button", onclick: startLine }, "I'm in line");
      }
      ui.append(inner, [report, primary]);
      cta.appendChild(inner);
    }

    function startLine(e) {
      var btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Starting";
      ui.locationOnce()
        .then(function (loc) {
          return api.startSession(id, loc);
        })
        .then(function (s) {
          state.session = s;
          go("/timer");
        })
        .catch(function (err) {
          btn.disabled = false;
          btn.textContent = "I'm in line";
          if (err.status === 409) {
            ui.toast("You're already in a line");
            loadSession().then(drawCta);
          } else if (err.status !== 429 && err.status !== 401) {
            ui.toast(err.detail || "Could not start the timer");
          }
        });
    }

    function openReport() {
      var crowdSeg = ui.segmented({
        label: "Crowd inside",
        toggle: true,
        options: [
          { value: "easy", label: "Easy" },
          { value: "busy", label: "Busy" },
          { value: "packed", label: "Packed" }
        ],
        onChange: sync
      });
      var lineSeg = ui.segmented({ label: "Line outside", toggle: true, options: ui.LINE_SIZES, onChange: sync });
      var send = h("button", { class: "btn btn--primary btn--block btn--lg", type: "button", disabled: true }, "Send report");
      function sync() {
        send.disabled = !(crowdSeg.get() || lineSeg.get());
      }
      var content = h(
        "div",
        null,
        h("p", { class: "sheet__label", text: "Crowd inside" }),
        crowdSeg.el,
        h("p", { class: "sheet__label", text: "Line outside" }),
        lineSeg.el,
        h("div", { class: "btn-stack" }, send),
        h("p", { class: "xs muted", text: "We check once if you're near the bar, then forget your location." })
      );
      var sh = ui.sheet({ title: "How is it at " + (bar ? bar.name : "the bar") + "?", content: content });
      send.addEventListener("click", function () {
        send.disabled = true;
        send.textContent = "Sending";
        ui.locationOnce()
          .then(function (loc) {
            return api.report(id, crowdSeg.get(), lineSeg.get(), loc);
          })
          .then(function (r) {
            sh.close();
            ui.toast("Thanks. +" + r.points_awarded + " point" + (r.points_awarded === 1 ? "" : "s"));
            refresh();
          })
          .catch(function (err) {
            send.textContent = "Send report";
            sync();
            if (err.status !== 429) ui.toast(err.detail || "Could not send");
          });
      });
    }

    function refresh() {
      return Promise.all([api.bar(id), loadSession().catch(function () { return state.session; })])
        .then(function (res) {
          draw(res[0]);
        })
        .catch(function (e) {
          if (e.status === 404 || e.status === 422) {
            ui.clear(body);
            body.appendChild(h("p", { class: "empty", text: "We could not find that bar." }));
          } else if (e.status !== 401 && e.status !== 429) {
            ui.toast(e.detail || "Could not load this bar");
          }
        });
    }

    refresh();
    return {
      refresh: refresh,
      destroy: function () {
        cleanups.forEach(function (f) {
          f();
        });
      }
    };
  }

  // ---------- Timer ----------
  function Timer() {
    var cleanups = [];
    var screen = h("main", { class: "screen screen--bare" });
    root.appendChild(screen);

    function empty() {
      ui.clear(screen);
      ui.append(screen, [
        h(
          "div",
          { class: "result" },
          h("h1", { class: "head__title", text: "Not in a line" }),
          h("p", { class: "muted", text: "Open a bar and tap I'm in line when you join the line." }),
          h("div", { class: "btn-stack" }, h("a", { class: "btn btn--primary btn--block btn--lg", href: "#/tonight", text: "See tonight" }))
        )
      ]);
    }

    function result(s, outcome) {
      cleanups.forEach(function (f) {
        f();
      });
      cleanups = [];
      ui.clear(screen);
      var mins = Math.max(0, Math.round(s.actual_wait_min || 0));
      var inside = s.status === "completed";
      // Tapped "I'm inside" but too fast to be a real wait (server marks it abandoned).
      var tooQuick = !inside && outcome === "inside";
      var title = inside ? "You're in" : tooQuick ? "Too quick to count" : "Line left";
      var note = inside
        ? "Your time makes everyone's wait estimate sharper."
        : tooQuick
          ? "Waits under 30 seconds are not used for the estimate."
          : "Short visits help us spot slow lines too.";
      ui.append(screen, [
        h(
          "div",
          { class: "result", role: "status" },
          h("div", { class: "result__check", "aria-hidden": "true" }, ui.icon(inside || tooQuick ? "check" : "close")),
          h("h1", { class: "head__title", text: title }),
          h("p", { class: "muted", text: inside ? "You waited" : "You were in line for" }),
          h("p", { class: "wait-num result__num" }, String(mins), h("span", { class: "unit", text: mins === 1 ? " min" : " min" })),
          s.points_awarded ? h("p", { class: "points" }, ui.icon("bolt"), "+" + s.points_awarded + " points") : h("p", { class: "small muted", text: "Thanks. This still helps." }),
          h(
            "p",
            { class: "small muted", text: note }
          ),
          h("div", { class: "btn-stack" }, h("a", { class: "btn btn--primary btn--block btn--lg", href: "#/tonight", text: "Done" }))
        )
      ]);
    }

    function draw(s) {
      ui.clear(screen);
      var ring = ui.timerRing();
      var target = s.predicted_wait_min ? s.predicted_wait_min * 60 : 0;
      var started = new Date(s.started_at);
      var sub = s.predicted_wait_min ? "of about " + s.predicted_wait_min + " min" : "Started " + started.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      cleanups.push(
        addTicker(function () {
          ring.update(elapsedSec(s), target, sub);
        })
      );
      var inside = h("button", { class: "btn btn--primary btn--block btn--lg", type: "button" }, "I'm inside");
      var left = h("button", { class: "btn btn--secondary btn--block btn--lg", type: "button" }, "Left the line");
      function end(outcome, btn) {
        inside.disabled = true;
        left.disabled = true;
        btn.textContent = "Saving";
        api
          .endSession(s.id, outcome)
          .then(function (out) {
            state.session = null;
            result(out, outcome);
          })
          .catch(function (e) {
            inside.disabled = false;
            left.disabled = false;
            inside.textContent = "I'm inside";
            left.textContent = "Left the line";
            if (e.status !== 429) ui.toast(e.detail || "Could not save");
          });
      }
      inside.addEventListener("click", function () {
        end("inside", inside);
      });
      left.addEventListener("click", function () {
        end("gave_up", left);
      });
      ui.append(screen, [
        h(
          "div",
          { class: "topbar" },
          h(
            "button",
            {
              class: "icon-btn",
              type: "button",
              "aria-label": "Back",
              onclick: function () {
                if (window.history.length > 1) window.history.back();
                else go("/tonight");
              }
            },
            ui.icon("back")
          )
        ),
        h(
          "div",
          { class: "timer" },
          h("p", { class: "hero__label", text: "You're in line at" }),
          h("h1", { class: "timer__bar", text: barName(s.bar_id) }),
          ring.el,
          h("div", { class: "btn-stack" }, inside, left),
          h("p", { class: "xs muted", text: "Tap I'm inside the moment you get in. Your time sharpens the estimate for everyone." })
        )
      ]);
    }

    loadSession()
      .then(function (s) {
        if (!s) return empty();
        if (!state.barsById[s.bar_id]) {
          return api.bar(s.bar_id).then(function (b) {
            state.barsById[b.id] = b;
            draw(s);
          });
        }
        draw(s);
      })
      .catch(function (e) {
        if (e.status !== 401) empty();
      });

    return {
      destroy: function () {
        cleanups.forEach(function (f) {
          f();
        });
      }
    };
  }

  // ---------- Settings ----------
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    ui.storage("crowded.theme", t === "light" || t === "dark" ? t : null);
  }

  function Settings() {
    var cleanups = [];
    var me = api.me;
    var val = h("span", { class: "setting__value", "aria-hidden": "true", text: me.wait_threshold_min + " min" });
    var help = h("p", { class: "setting__help", "aria-live": "polite", text: "" });
    var range = h("input", {
      class: "range",
      type: "range",
      min: 5,
      max: 120,
      step: 5,
      id: "threshold",
      "aria-label": "Wait limit in minutes"
    });
    range.value = String(me.wait_threshold_min);
    function paint() {
      var v = Number(range.value);
      val.textContent = v + " min";
      help.textContent = "Recommend the pass when the wait is over " + v + " min.";
      range.setAttribute("aria-valuetext", v + " minutes");
      range.style.setProperty("--fill", ((v - 5) / 115) * 100 + "%");
    }
    paint();
    range.addEventListener("input", paint);
    range.addEventListener("change", function () {
      var v = Number(range.value);
      api
        .updateThreshold(v)
        .then(function () {
          ui.toast("Saved. Limit is " + v + " min");
        })
        .catch(function (e) {
          if (e.status !== 429) ui.toast(e.detail || "Could not save");
          range.value = String(api.me.wait_threshold_min);
          paint();
        });
    });

    var savedTheme = ui.storage("crowded.theme");
    var themeSeg = ui.segmented({
      label: "Appearance",
      value: savedTheme === "light" || savedTheme === "dark" ? savedTheme : "system",
      options: [
        { value: "system", label: "System" },
        { value: "light", label: "Light" },
        { value: "dark", label: "Dark" }
      ],
      onChange: applyTheme
    });

    function confirmDelete() {
      var del = h("button", { class: "btn btn--danger-fill btn--block btn--lg", type: "button" }, "Delete forever");
      var cancel = h("button", { class: "btn btn--secondary btn--block btn--lg", type: "button" }, "Cancel");
      var sh = ui.sheet({
        title: "Delete your account?",
        body: "This permanently deletes your account, timers, reports and points from our servers. It cannot be undone.",
        content: h("div", { class: "btn-stack" }, del, cancel)
      });
      cancel.addEventListener("click", sh.close);
      del.addEventListener("click", function () {
        del.disabled = true;
        del.textContent = "Deleting";
        api
          .deleteAccount()
          .then(function () {
            sh.close();
            state.session = null;
            ui.toast("Account deleted");
            go("/welcome");
          })
          .catch(function (e) {
            del.disabled = false;
            del.textContent = "Delete forever";
            if (e.status !== 429) ui.toast(e.detail || "Could not delete");
          });
      });
    }

    var screen = h(
      "main",
      { class: "screen" },
      h(
        "header",
        { class: "head" },
        h("h1", { class: "head__title", text: "Settings" }),
        h("p", { class: "head__sub", text: me.phone_hint ? "Signed in with phone " + me.phone_hint : "Signed in" })
      ),
      h(
        "section",
        { class: "setting" },
        h("div", { class: "setting__row" }, h("label", { class: "setting__title", for: "threshold", text: "Wait limit" }), val),
        help,
        range,
        h("div", { class: "range-scale", "aria-hidden": "true" }, h("span", { text: "5 min" }), h("span", { text: "120 min" }))
      ),
      h(
        "section",
        { class: "setting" },
        h("p", { class: "setting__title", text: "Appearance" }),
        themeSeg.el
      ),
      h(
        "div",
        { class: "privacy" },
        ui.icon("shield"),
        h("span", { text: "We never store your location. Only whether you were near the bar when you reported." })
      ),
      h(
        "div",
        { class: "account-actions" },
        h(
          "button",
          {
            class: "btn btn--secondary btn--block btn--lg",
            type: "button",
            onclick: function () {
              api.signOut().then(function () {
                state.session = null;
                go("/welcome");
              });
            }
          },
          "Sign out"
        ),
        h("button", { class: "btn btn--danger btn--block btn--lg", type: "button", onclick: confirmDelete }, "Delete account")
      ),
      h(
        "p",
        { class: "welcome__fine" },
        "Door staff? ",
        h("a", { href: "staff.html" + (api.isMock ? "?mock=1" : ""), class: "link-btn", text: "Open the counter" })
      ),
      h("p", { class: "welcome__fine", text: "Crowded v1" + (api.isMock ? " · Demo mode, fake data" : "") })
    );
    var chrome = h("div", null);
    root.appendChild(screen);
    root.appendChild(chrome);
    root.appendChild(tabbar("settings"));
    var sb = sessionBar(cleanups);
    if (sb) {
      screen.classList.add("screen--with-session");
      chrome.appendChild(sb);
    }
    return {
      destroy: function () {
        cleanups.forEach(function (f) {
          f();
        });
      }
    };
  }

  // ---------- boot ----------
  function boot() {
    var start = api.hasSession()
      ? api.refresh().then(function (ok) {
          if (!ok) return null;
          return Promise.all([api.getMe(), loadSession().catch(function () {})]);
        })
      : Promise.resolve(null);
    start
      .catch(function () {
        return null;
      })
      .then(function () {
        state.ready = true;
        render();
      });
  }

  boot();
})();
