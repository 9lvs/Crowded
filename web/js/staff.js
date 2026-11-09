/* Staff door counter. One screen, big targets, optimistic updates. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var ui = C.ui;
  var api = C.api;
  var h = ui.h;

  var root = document.getElementById("app");
  var POLL_MS = 15000;
  var poll = null;
  var agoTimer = null;
  var visibleLoad = null;

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && poll && visibleLoad) visibleLoad();
  });

  C.onAuthLost = function () {
    api.setTokens(null);
    api.me = null;
    signIn();
  };

  function stopTimers() {
    clearInterval(poll);
    clearInterval(agoTimer);
    poll = null;
    agoTimer = null;
  }

  function signOutBtn() {
    return h(
      "button",
      {
        class: "icon-btn",
        type: "button",
        "aria-label": "Sign out",
        onclick: function () {
          stopTimers();
          api.signOut().then(signIn);
        }
      },
      ui.icon("signout")
    );
  }

  function signIn() {
    stopTimers();
    ui.clear(root);
    var box = h("div", null);
    root.appendChild(box);
    C.auth.mount(box, {
      kicker: "Door staff",
      title: "Door counter",
      pitch: "Count people in and out. Set the line size. That's it.",
      onDone: route
    });
  }

  function route() {
    var me = api.me;
    if (!me) return signIn();
    if (!me.staff_bar_id) return invite();
    counter(me.staff_bar_id);
  }

  function invite() {
    stopTimers();
    ui.clear(root);
    var input = h("input", {
      class: "input",
      id: "invite",
      type: "text",
      autocomplete: "off",
      autocapitalize: "characters",
      spellcheck: "false",
      placeholder: "Invite code"
    });
    var btn = h("button", { class: "btn btn--primary btn--block btn--lg", type: "submit" }, "Join bar");
    var err = h("p", { class: "small", role: "alert" });
    err.style.setProperty("color", "var(--alert)");
    var form = h(
      "form",
      {
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          var code = input.value.trim();
          if (code.length < 8) {
            err.textContent = "Invite codes are at least 8 characters.";
            return;
          }
          btn.disabled = true;
          btn.textContent = "Joining";
          api
            .redeemInvite(code)
            .then(route)
            .catch(function (e2) {
              btn.disabled = false;
              btn.textContent = "Join bar";
              if (e2.status !== 429) err.textContent = e2.detail || "That invite did not work";
            });
        }
      },
      h("div", { class: "field" }, h("label", { class: "field__label", for: "invite", text: "Invite code" }), input),
      err,
      btn
    );
    root.appendChild(
      h(
        "div",
        { class: "welcome" },
        h("div", { class: "staff__top" }, h("div", { class: "brand" }, h("span", { class: "brand__mark" }, ui.icon("mark")), "Crowded"), signOutBtn()),
        h(
          "div",
          { class: "welcome__hero" },
          h("h1", { class: "welcome__title", text: "Join your bar" }),
          h("p", { class: "welcome__pitch", text: "Ask your manager for the invite code. It links this phone to one bar." })
        ),
        form,
        api.isMock ? h("p", { class: "welcome__fine", text: "Demo mode: any 8 characters work." }) : null
      )
    );
    setTimeout(function () {
      input.focus();
    }, 50);
  }

  function counter(barId) {
    stopTimers();
    ui.clear(root);
    var server = null; // last StaffState from the server
    var local = { headcount: 0, line_size: null };
    var pending = 0;

    var barName = h("p", { class: "staff__bar", text: "Loading" });
    var num = h("p", { class: "count__num", "aria-live": "polite", text: "0" });
    var capText = h("p", { class: "count__cap", text: "" });
    var fill = h("div", { class: "cap__fill" });
    var capBar = h("div", { class: "cap", role: "img", "aria-label": "Capacity" }, fill);
    var updated = h("p", { class: "updated", text: "" });
    var waitNum = h("span", { class: "live-line__num", "aria-live": "polite", text: "--" });
    var waitBasis = h("p", { class: "basis", text: "" });
    var tally = h("p", { class: "xs muted", text: "" });

    var lineSeg = ui.segmented({
      label: "Outside line size",
      wrap: true,
      options: ui.LINE_SIZES,
      onChange: function (v) {
        if (!v) return;
        ui.haptic();
        local.line_size = v;
        send(api.lineSize(barId, v), "Line set to " + labelFor(v));
      }
    });

    function labelFor(v) {
      for (var i = 0; i < ui.LINE_SIZES.length; i++) if (ui.LINE_SIZES[i].value === v) return ui.LINE_SIZES[i].label.toLowerCase();
      return v;
    }

    function paint() {
      var cap = server ? server.capacity : 0;
      num.textContent = String(local.headcount);
      var ratio = cap ? local.headcount / cap : 0;
      var level = ratio < 0.6 ? "easy" : ratio < 0.9 ? "busy" : "packed";
      capText.textContent = cap ? "of " + cap + " capacity · " + Math.round(ratio * 100) + "%" : "";
      fill.setAttribute("data-level", level);
      fill.style.setProperty("width", Math.min(100, Math.round(ratio * 100)) + "%");
      capBar.setAttribute("aria-label", local.headcount + " of " + cap + " capacity, " + ui.CROWD_LABEL[level]);
      lineSeg.set(local.line_size);
      if (server) {
        barName.textContent = server.bar_name;
        updated.textContent = "Line updated " + ui.fmtAgo(server.line_updated_at);
        var lv = server.live;
        waitNum.textContent = lv.has_recent_data && lv.wait_min !== null ? lv.wait_min + " min" : "No data";
        waitBasis.textContent = lv.basis.text;
        tally.textContent = server.entries_tonight + " in · " + server.exits_tonight + " out tonight";
      }
    }

    function reconcile(st) {
      server = st;
      if (pending === 0) {
        local.headcount = st.headcount;
        local.line_size = st.line_size;
      }
      paint();
    }

    function send(promise, okMsg) {
      pending++;
      paint();
      return promise
        .then(function (st) {
          pending--;
          reconcile(st);
          if (okMsg) ui.toast(okMsg);
        })
        .catch(function (e) {
          pending--;
          if (e.status !== 429 && e.status !== 401) ui.toast(e.detail || "Not saved. Try again.");
          load();
        });
    }

    function door(direction, n) {
      ui.haptic();
      if (direction === "in") local.headcount += n;
      else local.headcount = Math.max(0, local.headcount - n);
      send(api.door(barId, direction, n));
    }

    function load() {
      if (pending > 0) return Promise.resolve();
      return api
        .staffState(barId)
        .then(reconcile)
        .catch(function (e) {
          if (e.status === 403) {
            ui.toast("This phone is not staff for that bar");
          } else if (e.status !== 401 && e.status !== 429) {
            ui.toast(e.detail || "Could not load the counter");
          }
        });
    }

    var outBtn = h(
      "button",
      { class: "door__btn door__btn--out", type: "button", "aria-label": "One person out", onclick: function () { door("out", 1); } },
      ui.icon("minus"),
      "Out"
    );
    var inBtn = h(
      "button",
      { class: "door__btn door__btn--in", type: "button", "aria-label": "One person in", onclick: function () { door("in", 1); } },
      ui.icon("plus"),
      "In"
    );

    root.appendChild(
      h(
        "main",
        { class: "staff" },
        h(
          "div",
          { class: "staff__top" },
          h("div", null, h("p", { class: "staff__role", text: "Door staff" + (api.isMock ? " · Demo" : "") }), barName),
          signOutBtn()
        ),
        h("section", { class: "count", "aria-label": "Headcount" }, h("p", { class: "count__label", text: "Inside now" }), num, capText, capBar),
        h("div", { class: "door" }, outBtn, inBtn),
        h(
          "div",
          { class: "door__extra" },
          h("button", { class: "btn btn--secondary", type: "button", "aria-label": "Five people out", onclick: function () { door("out", 5); } }, "\u22125 out"),
          h("button", { class: "btn btn--secondary", type: "button", "aria-label": "Five people in", onclick: function () { door("in", 5); } }, "+5 in")
        ),
        h("section", { class: "staff__section" }, h("h2", { class: "section-title", text: "Outside line" }), lineSeg.el, updated),
        h(
          "section",
          { class: "staff__section" },
          h("div", { class: "live-line" }, h("span", { class: "muted", text: "Live wait estimate" }), waitNum),
          waitBasis
        ),
        h("div", { class: "staff__foot" }, tally)
      )
    );

    paint();
    load();
    visibleLoad = load;
    poll = setInterval(function () {
      if (document.visibilityState === "visible") load();
    }, POLL_MS);
    agoTimer = setInterval(function () {
      if (server) updated.textContent = "Line updated " + ui.fmtAgo(server.line_updated_at);
    }, 10000);
  }

  function boot() {
    if (!api.hasSession()) return signIn();
    api
      .refresh()
      .then(function (ok) {
        if (!ok) return signIn();
        return api.getMe().then(route);
      })
      .catch(signIn);
  }

  boot();
})();
