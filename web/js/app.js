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
            class: "btn btn--inverse",
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
      demo: api.isMock,
      footer: h(
        "p",
        { class: "welcome__alt" },
        "Work at a bar? ",
        h("a", { class: "link-btn", href: "staff.html" + (api.isMock ? "?mock=1" : ""), text: "Staff sign in" })
      ),
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
  function waitLabel(lv) {
    if (lv.has_recent_data && lv.wait_min !== null) return lv.wait_min === 0 ? "No line" : "About " + lv.wait_min + " min wait";
    return lv.has_recent_data ? "No line data" : "No recent data";
  }

  function barRow(b, refresh) {
    var lv = b.live;
    var specialLine = ui.specialsLine(b);
    var hasWait = lv.has_recent_data && lv.wait_min !== null;
    var crowdLabel = lv.crowd_level ? ui.CROWD_LABEL[lv.crowd_level] : "Crowd unknown";
    var label = b.name + ". " + (lv.crowd_level ? "Crowd " + crowdLabel + ". " : "Crowd unknown. ") +
      waitLabel(lv) + ". " + (lv.has_recent_data ? lv.basis.text + ". " : "") + ui.verdictShort(b.verdict) + "." +
      (specialLine ? " " + specialLine + "." : "");
    var right = hasWait
      ? h("span", { class: "row-wait" }, h("span", { class: "num row-wait__num", text: String(lv.wait_min) }), h("span", { class: "row-wait__unit", text: "min" }))
      : h("span", { class: "row-wait row-wait--none", text: lv.has_recent_data ? "No line data" : "No data" });
    return h(
      "li",
      { class: "bar-row" },
      h(
        "button",
        {
          class: "bar-row__main",
          type: "button",
          "aria-label": label,
          onclick: function () {
            go("/bar/" + b.id);
          }
        },
        h(
          "span",
          { class: "bar-row__text" },
          h("span", { class: "bar-row__name", text: b.name }),
          h("span", { class: "bar-row__crowd" }, lv.crowd_level ? ui.crowd(lv.crowd_level) : h("span", { class: "faint", text: "Crowd unknown" })),
          h("span", { class: "bar-row__basis", text: lv.has_recent_data ? lv.basis.text : "Nobody has reported in the last 30 min" }),
          specialLine ? h("span", { class: "bar-row__special", text: specialLine }) : null
        ),
        right
      ),
      h(
        "div",
        { class: "bar-row__foot" },
        ui.verdictLine(b.verdict),
        h(
          "button",
          {
            class: "chip-btn",
            type: "button",
            "aria-label": "Report crowd at " + b.name,
            onclick: function () {
              openReport(b, refresh);
            }
          },
          "Report"
        )
      )
    );
  }

  // Shown on Tonight when the signed in account is door staff.
  function staffBanner() {
    var me = api.me;
    if (!me || me.role !== "staff" || !me.staff_bar_id) return null;
    var b = state.barsById[me.staff_bar_id];
    return h(
      "a",
      { class: "banner", href: "staff.html" + (api.isMock ? "?mock=1" : "") },
      h(
        "span",
        { class: "banner__text" },
        h("strong", { text: "You're signed in as door staff" }),
        h("span", { text: b ? "at " + b.name + ". Open the door counter." : "Open the door counter." })
      ),
      ui.icon("arrow")
    );
  }

  // Report sheet. Used from Tonight rows and Bar detail. onSent runs after a successful send.
  function openReport(b, onSent) {
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
    var sh = ui.sheet({ title: "How is " + b.name + " right now?", content: content });
    send.addEventListener("click", function () {
      send.disabled = true;
      send.textContent = "Sending";
      ui.locationOnce()
        .then(function (loc) {
          return api.report(b.id, crowdSeg.get(), lineSeg.get(), loc);
        })
        .then(function (r) {
          ui.clear(content);
          ui.append(content, [
            h(
              "div",
              { class: "thanks", role: "status" },
              h("span", { class: "thanks__icon", "aria-hidden": "true" }, ui.icon("check")),
              h("p", { class: "thanks__title", text: "Report sent" }),
              h(
                "p",
                { class: "small muted", text: r.points_awarded ? "+" + r.points_awarded + (r.points_awarded === 1 ? " point" : " points") + ". Thanks for keeping it accurate." : "Thanks. Reports from near the bar earn points." }
              )
            )
          ]);
          setTimeout(sh.close, 1600);
          if (onSent) onSent();
        })
        .catch(function (err) {
          send.textContent = "Send report";
          sync();
          if (err.status === 429) ui.toast("You just reported. Try again in a few minutes.");
          else ui.toast(err.detail || "Could not send");
        });
    });
  }

  function Tonight() {
    var cleanups = [];
    var list = h("ul", { class: "bar-list", "aria-label": "Bars tonight" });
    for (var i = 0; i < 3; i++) list.appendChild(h("li", { class: "skeleton", "aria-hidden": "true" }));
    var sub = h("p", { class: "head__sub", text: ui.fmtDate(new Date()) });
    var bannerSlot = h("div", null);
    var screen = h(
      "main",
      { class: "screen" },
      h("header", { class: "head" }, h("h1", { class: "head__title", text: "Tonight" }), sub),
      bannerSlot,
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

    var meFresh = false;
    function refresh() {
      // Re-read the account once per visit so a new staff role shows up without a reload.
      var meP = meFresh ? Promise.resolve(api.me) : api.getMe().catch(function () { return api.me; });
      meFresh = true;
      return Promise.all([api.bars(), loadSession().catch(function () { return state.session; }), meP])
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
            list.appendChild(barRow(b, refresh));
          });
          ui.clear(bannerSlot);
          ui.append(bannerSlot, staffBanner());
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

  // ---------- Specials on the bar detail ----------
  function specialItem(sp, opts) {
    opts = opts || {};
    var price = ui.fmtPrice(sp.price_cents);
    var when = ui.fmtWindow(sp) + (price ? " \u00b7 " + price : "");
    return h(
      "li",
      { class: "special" },
      h(
        "p",
        { class: "special__kind" },
        ui.kindLabel(sp.kind),
        opts.showNow && sp.is_now ? h("span", { class: "tag", text: "Now" }) : null
      ),
      h("p", { class: "special__title", text: sp.title }),
      sp.details ? h("p", { class: "special__details", text: sp.details }) : null,
      h("p", { class: "special__when", text: when }),
      h(
        "p",
        { class: "special__meta", text: (sp.posted_by === "admin" ? "Posted by Crowded" : "Posted by the bar") + " \u00b7 Updated " + ui.fmtAgo(sp.updated_at) }
      )
    );
  }

  function specialsTonight(b) {
    var list = b.specials_tonight || [];
    return h(
      "section",
      { class: "specials", "aria-labelledby": "specials-tonight-h" },
      h("h2", { class: "section-title", id: "specials-tonight-h", text: "Tonight" }),
      list.length
        ? h(
            "ul",
            { class: "special-list" },
            list.map(function (sp) {
              return specialItem(sp, { showNow: true });
            })
          )
        : h("p", { class: "special-empty", text: "No specials posted." })
    );
  }

  function specialsWeek(b) {
    var week = b.specials_week || [];
    var groups = [];
    for (var d = 0; d < 7; d++) {
      var items = week.filter(function (sp) {
        return sp.days.indexOf(d) !== -1;
      });
      if (items.length) {
        groups.push(
          h(
            "div",
            { class: "week__day" },
            h("h3", { class: "week__name", text: ui.DAY_LONG[d] }),
            h(
              "ul",
              { class: "special-list" },
              items.map(function (sp) {
                return specialItem(sp);
              })
            )
          )
        );
      }
    }
    return h(
      "details",
      { class: "week" },
      h("summary", { class: "week__summary", text: "This week" }),
      groups.length ? groups : h("p", { class: "special-empty", text: "No specials posted." })
    );
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

      // Crowd and line first. These are the numbers people source and come for.
      var ratio = lv.capacity_ratio;
      var crowdSub = lv.headcount !== null && ratio !== null
        ? lv.headcount + " of " + b.capacity + " inside"
        : lv.crowd_level ? "From student reports" : "No reports yet";
      var crowdCol = h(
        "div",
        { class: "kpi" },
        h("p", { class: "kpi__label", text: "Crowd" }),
        h("p", { class: "kpi__value", "aria-live": "polite" }, lv.crowd_level ? ui.CROWD_LABEL[lv.crowd_level] : h("span", { class: "faint", text: "Unknown" })),
        lv.crowd_level ? ui.crowd(lv.crowd_level, { meterOnly: true }) : null,
        h("p", { class: "kpi__sub", text: crowdSub })
      );
      heroNum = h("p", { class: "kpi__value num", "aria-live": "polite" });
      if (hasWait) ui.append(heroNum, [String(lv.wait_min), h("span", { class: "kpi__unit", text: " min" })]);
      else heroNum.appendChild(h("span", { class: "faint", text: "No data" }));
      var lineCol = h(
        "div",
        { class: "kpi" },
        h("p", { class: "kpi__label", text: "Line" }),
        heroNum,
        h("p", { class: "kpi__sub", text: hasWait ? (lv.wait_min === 0 ? "Walk right in" : lv.wait_low_min + " to " + lv.wait_high_min + " min") : "No recent timers" })
      );
      var hero = h(
        "section",
        { class: "kpis", "aria-label": "Right now" },
        crowdCol,
        lineCol
      );
      var basis = h(
        "p",
        { class: "basis detail__basis", text: lv.has_recent_data ? lv.basis.text : "Nobody has reported in the last 30 min. Be the first." }
      );

      // Pass: secondary. One quiet row plus the reasoning.
      var v = b.verdict;
      var price = ui.fmtPrice(b.pass_price_cents);
      var pass = h(
        "section",
        { class: "pass", "aria-label": "Line skip pass" },
        h(
          "div",
          { class: "pass__row" },
          h("span", { class: "pass__label", text: "Price tonight" }),
          h("span", { class: "pass__value", text: price || "Not sold here" })
        ),
        h("p", { class: "pass__text", text: v.text }),
        h(
          "p",
          { class: "pass__foot" },
          "Your limit is " + me.wait_threshold_min + " min. ",
          h("a", { href: "#/settings", class: "link-btn", text: "Change" })
        )
      );

      var stats = h(
        "ul",
        { class: "stats" },
        h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Normal wait at this hour" }),
          h("span", { class: "stat__value", text: b.normal_wait_min === null ? "Not enough history" : b.normal_wait_min + " min" })
        ),
        h(
          "li",
          { class: "stat" },
          h("span", { class: "stat__label", text: "Capacity" }),
          h("span", { class: "stat__value", text: b.capacity + " people" })
        ),
        lv.headcount !== null && ratio !== null
          ? h(
              "li",
              { class: "stat" },
              h("span", { class: "stat__label", text: "Full" }),
              h("span", { class: "stat__value", text: Math.round(ratio * 100) + "%" })
            )
          : null
      );

      ui.append(body, [
        h("h1", { class: "detail__name", text: b.name }),
        h("p", { class: "detail__addr", text: b.address }),
        hero,
        basis,
        specialsTonight(b),
        specialsWeek(b),
        h("h2", { class: "section-title", text: "Wait by hour" }),
        chart(b.wait_by_hour || []),
        h(
          "p",
          { class: "legend" },
          h("span", null, h("i", { class: "sw-typ" }), "Typical"),
          h("span", null, h("i", { class: "sw-now" }), "Tonight")
        ),
        h("h2", { class: "section-title", text: "Line skip pass" }),
        pass,
        h("h2", { class: "section-title", text: "About" }),
        stats,
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
      var report = h(
        "button",
        {
          class: "btn btn--primary btn--lg",
          type: "button",
          onclick: function () {
            if (bar) openReport(bar, refresh);
          }
        },
        "Report crowd"
      );
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
            class: "btn btn--outline btn--lg",
            type: "button",
            onclick: function () {
              go("/timer");
            }
          },
          s.bar_id === id ? "In line " : "In line elsewhere ",
          t
        );
      } else {
        primary = h("button", { class: "btn btn--outline btn--lg", type: "button", onclick: startLine }, "I'm in line");
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
          s.verified ? h("p", { class: "verified" }, ui.icon("shield"), "Verified at the door") : null,
          s.points_awarded ? h("p", { class: "points", text: "+" + s.points_awarded + " points" }) : h("p", { class: "small muted", text: "Thanks. This still helps." }),
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
      var stack = h("div", { class: "btn-stack" }, inside, left);
      var hint = h("p", { class: "xs muted", text: "Tap I'm inside the moment you get in. Your time sharpens the estimate for everyone." });
      function end(outcome, btn, doorCode, onFail) {
        inside.disabled = true;
        left.disabled = true;
        if (btn) btn.textContent = "Saving";
        api
          .endSession(s.id, outcome, doorCode)
          .then(function (out) {
            state.session = null;
            result(out, outcome);
          })
          .catch(function (e) {
            inside.disabled = false;
            left.disabled = false;
            inside.textContent = "I'm inside";
            left.textContent = "Left the line";
            if (onFail) onFail();
            if (e.status !== 429) ui.toast(e.detail || "Could not save");
          });
      }
      // Optional door code. Never blocks ending the timer.
      function askCode() {
        var input = h("input", {
          class: "input input--code",
          id: "door-code",
          type: "text",
          inputmode: "numeric",
          pattern: "[0-9]*",
          maxlength: "4",
          autocomplete: "off",
          placeholder: "0000"
        });
        var done = h("button", { class: "btn btn--primary btn--lg", type: "button", disabled: true }, "Done");
        var skip = h("button", { class: "btn btn--secondary btn--lg", type: "button" }, "Skip");
        function restore() {
          done.disabled = !/^\d{4}$/.test(input.value);
          skip.disabled = false;
          done.textContent = "Done";
          skip.textContent = "Skip";
        }
        function finish(codeValue, btn) {
          done.disabled = true;
          skip.disabled = true;
          end("inside", btn, codeValue, restore);
        }
        input.addEventListener("input", function () {
          input.value = input.value.replace(/\D/g, "").slice(0, 4);
          done.disabled = input.value.length !== 4;
        });
        input.addEventListener("keydown", function (e) {
          if (e.key === "Enter" && !done.disabled) done.click();
        });
        done.addEventListener("click", function () {
          finish(input.value, done);
        });
        skip.addEventListener("click", function () {
          finish(null, skip);
        });
        ui.clear(stack);
        ui.clear(hint);
        stack.appendChild(
          h(
            "div",
            { class: "doorcode" },
            h("label", { class: "field__label", for: "door-code", text: "Door code, shown by staff at the door" }),
            input,
            h("div", { class: "doorcode__btns" }, skip, done)
          )
        );
        hint.textContent = "A right code shows you really waited. You earn more points.";
        input.focus();
      }
      inside.addEventListener("click", askCode);
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
          stack,
          hint
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
      help.textContent = "We suggest a line skip pass when the wait is over " + v + " min.";
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
        h("div", { class: "setting__row" }, h("label", { class: "setting__title", for: "threshold", text: "Pass suggestion limit" }), val),
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
        "Work at a bar? ",
        h("a", { href: "staff.html" + (api.isMock ? "?mock=1" : ""), class: "link-btn", text: "Open the staff app" })
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
