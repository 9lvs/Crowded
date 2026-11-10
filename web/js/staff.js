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
      brandSuffix: "for staff",
      title: "Door counter",
      pitch: "Count people in and out and set the outside line size. Students see a live estimate within seconds.",
      demo: api.isMock,
      footer: h(
        "p",
        { class: "welcome__alt" },
        "Not staff? ",
        h("a", { class: "link-btn", href: "index.html" + (api.isMock ? "?mock=1" : ""), text: "Open the app" })
      ),
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
    var err = h("p", { class: "small form-error", role: "alert" });
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
        h("div", { class: "staff__top" }, ui.wordmark("for staff"), signOutBtn()),
        h(
          "div",
          { class: "welcome__hero" },
          h("h1", { class: "welcome__title", text: "Join your bar" }),
          h("p", { class: "welcome__pitch", text: "Ask your manager for the invite code. It links this account to one bar." })
        ),
        form,
        h(
          "p",
          { class: "welcome__alt" },
          "Not staff? ",
          h("a", { class: "link-btn", href: "index.html" + (api.isMock ? "?mock=1" : ""), text: "Open the app" })
        ),
        api.isMock ? h("p", { class: "welcome__fine", text: "Demo mode: any 8 characters work." }) : null
      )
    );
    setTimeout(function () {
      input.focus();
    }, 50);
  }

  // ---------- Specials ----------
  var SPECIAL_ERRORS = {
    too_many_specials: "This bar has 30 specials. Delete one first.",
    start_equals_end: "Start and end times must differ.",
    not_found: "That special is gone. Refresh the page.",
    title_required: "Add a title.",
    kind_required: "Pick a kind.",
    days_required: "Pick at least one day.",
    start_local_required: "Set a start time.",
    end_local_required: "Set an end time.",
    is_active_required: "Choose on or off.",
    "start and end must differ": "Start and end times must differ.",
    "days must be unique": "Pick each day once.",
    "time must be HH:MM, 24 hour": "Use a real time, like 9:00 PM.",
    "control characters are not allowed": "Remove special characters from the text."
  };

  function specialError(e) {
    var d = e && e.detail;
    if (d && SPECIAL_ERRORS[d]) return SPECIAL_ERRORS[d];
    if (e && e.status === 403) return "This phone is not staff for that bar.";
    if (e && e.status === 422) return d ? "Check the form. " + d : "Check the form and try again.";
    return d || "Not saved. Try again.";
  }

  function dollarsToCents(text) {
    var t = String(text || "").replace(/^\s*\$?\s*/, "").trim();
    if (!t) return { cents: null };
    if (!/^\d{1,4}(\.\d{1,2})?$/.test(t)) return { error: "Price is in dollars, like 5 or 7.50." };
    var cents = Math.round(parseFloat(t) * 100);
    if (cents > 100000) return { error: "Price can be at most $1000." };
    return { cents: cents };
  }

  function centsToDollars(c) {
    if (c === null || c === undefined) return "";
    return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
  }

  function daysText(days) {
    if (days.length === 7) return "Every day";
    return days
      .map(function (d) {
        return ui.DAY_SHORT[d];
      })
      .join(", ");
  }

  function specialsSection(barId) {
    var list = [];
    var confirmId = null;
    var listEl = h("div", { class: "sp-list" });
    var formWrap = h("div", null);
    var loadErr = h("p", { class: "small form-error", role: "alert" });
    var editingId = null;

    function mutate(promise, okMsg) {
      return promise
        .then(function () {
          if (okMsg) ui.toast(okMsg);
          return reload();
        })
        .catch(function (e) {
          if (e.status !== 429 && e.status !== 401) ui.toast(specialError(e));
        });
    }

    function reload() {
      return api
        .staffSpecials(barId)
        .then(function (rows) {
          list = rows;
          loadErr.textContent = "";
          drawList();
        })
        .catch(function (e) {
          if (e.status !== 401 && e.status !== 429) loadErr.textContent = specialError(e);
        });
    }

    function drawList() {
      ui.clear(listEl);
      if (!list.length) {
        listEl.appendChild(h("p", { class: "special-empty", text: "No specials yet. Add one below." }));
        return;
      }
      var ul = h("ul", { class: "special-list" });
      list.forEach(function (sp) {
        var price = ui.fmtPrice(sp.price_cents);
        var sub = ui.kindLabel(sp.kind) + " · " + daysText(sp.days) + " · " + ui.fmtWindow(sp) + (price ? " · " + price : "");
        var actions;
        if (confirmId === sp.id) {
          actions = h(
            "div",
            { class: "sp-item__actions", role: "group", "aria-label": "Confirm delete " + sp.title },
            h("p", { class: "sp-item__confirm", text: "Delete this special?" }),
            h("button", { class: "btn btn--secondary", type: "button", onclick: function () { confirmId = null; drawList(); } }, "Keep it"),
            h(
              "button",
              {
                class: "btn btn--primary",
                type: "button",
                "aria-label": "Yes, delete " + sp.title,
                onclick: function () {
                  confirmId = null;
                  if (editingId === sp.id) startForm(null);
                  mutate(api.deleteSpecial(barId, sp.id), "Special deleted");
                }
              },
              "Delete"
            )
          );
        } else {
          actions = h(
            "div",
            { class: "sp-item__actions" },
            h(
              "button",
              {
                class: "sp-switch",
                type: "button",
                role: "switch",
                "aria-checked": String(sp.is_active),
                "aria-label": "Active: " + sp.title,
                onclick: function () {
                  mutate(api.updateSpecial(barId, sp.id, { is_active: !sp.is_active }), sp.is_active ? "Special hidden" : "Special live");
                }
              },
              sp.is_active ? "On" : "Off"
            ),
            h("button", { class: "btn btn--secondary", type: "button", "aria-label": "Edit " + sp.title, onclick: function () { startForm(sp); } }, "Edit"),
            h("button", { class: "btn btn--outline", type: "button", "aria-label": "Delete " + sp.title, onclick: function () { confirmId = sp.id; drawList(); } }, "Delete")
          );
        }
        ul.appendChild(
          h(
            "li",
            { class: "sp-item" + (sp.is_active ? "" : " is-off") },
            h("p", { class: "sp-item__title", text: sp.title }),
            h("p", { class: "sp-item__sub", text: sub + (sp.is_active ? "" : " · Hidden from students") }),
            actions
          )
        );
      });
      listEl.appendChild(ul);
    }

    function startForm(sp) {
      editingId = sp ? sp.id : null;
      ui.clear(formWrap);
      var days = sp ? sp.days.slice() : [];
      var kind = h("select", { class: "input", id: "sp-kind" });
      ui.SPECIAL_KINDS.forEach(function (k) {
        kind.appendChild(h("option", { value: k.value, text: k.label }));
      });
      var title = h("input", { class: "input", id: "sp-title", type: "text", maxlength: "80", autocomplete: "off", placeholder: "Half price wells" });
      var details = h("input", { class: "input", id: "sp-details", type: "text", maxlength: "200", autocomplete: "off", placeholder: "Optional" });
      var start = h("input", { class: "input", id: "sp-start", type: "time", value: "17:00" });
      var end = h("input", { class: "input", id: "sp-end", type: "time", value: "20:00" });
      var price = h("input", { class: "input", id: "sp-price", type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "Optional, like 5 or 7.50" });
      if (sp) {
        kind.value = sp.kind;
        title.value = sp.title;
        details.value = sp.details || "";
        start.value = sp.start_local;
        end.value = sp.end_local;
        price.value = centsToDollars(sp.price_cents);
      }
      var err = h("p", { class: "small form-error", role: "alert" });
      var save = h("button", { class: "btn btn--primary", type: "submit" }, sp ? "Save changes" : "Add special");
      var dayBtns = ui.DAY_SHORT.map(function (label, i) {
        var b = h("button", {
          class: "sp-day",
          type: "button",
          "aria-pressed": String(days.indexOf(i) !== -1),
          "aria-label": ui.DAY_LONG[i],
          text: label,
          onclick: function () {
            var at = days.indexOf(i);
            if (at === -1) days.push(i);
            else days.splice(at, 1);
            b.setAttribute("aria-pressed", String(at === -1));
          }
        });
        return b;
      });
      var form = h(
        "form",
        {
          class: "sp-form",
          novalidate: true,
          "aria-label": sp ? "Edit special" : "Add special",
          onsubmit: function (e) {
            e.preventDefault();
            err.textContent = "";
            var t = title.value.trim();
            if (!t) return void (err.textContent = SPECIAL_ERRORS.title_required);
            if (!days.length) return void (err.textContent = SPECIAL_ERRORS.days_required);
            if (!start.value || !end.value) return void (err.textContent = "Set a start and end time.");
            if (start.value === end.value) return void (err.textContent = SPECIAL_ERRORS.start_equals_end);
            var pr = dollarsToCents(price.value);
            if (pr.error) return void (err.textContent = pr.error);
            var body = {
              kind: kind.value,
              title: t,
              details: details.value.trim(),
              days: days.slice().sort(),
              start_local: start.value,
              end_local: end.value,
              price_cents: pr.cents
            };
            save.disabled = true;
            var p = sp ? api.updateSpecial(barId, sp.id, body) : api.addSpecial(barId, body);
            p.then(function () {
              ui.toast(sp ? "Special saved" : "Special added");
              startForm(null);
              return reload();
            }).catch(function (e2) {
              save.disabled = false;
              if (e2.status !== 429 && e2.status !== 401) err.textContent = specialError(e2);
            });
          }
        },
        h("h3", { class: "sp-form__title", text: sp ? "Edit special" : "Add special" }),
        h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-kind", text: "Kind" }), kind),
        h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-title", text: "Title" }), title),
        h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-details", text: "Details" }), details),
        h("div", { class: "field" }, h("span", { class: "field__label", id: "sp-days-l", text: "Days" }), h("div", { class: "sp-days", role: "group", "aria-labelledby": "sp-days-l" }, dayBtns)),
        h(
          "div",
          { class: "sp-times" },
          h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-start", text: "Starts" }), start),
          h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-end", text: "Ends" }), end)
        ),
        h("p", { class: "field__hint", text: "An end time before the start runs past midnight." }),
        h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-price", text: "Price in dollars" }), price),
        err,
        h(
          "div",
          { class: "sp-form__btns" },
          save,
          sp ? h("button", { class: "btn btn--secondary", type: "button", onclick: function () { startForm(null); } }, "Cancel") : null
        )
      );
      formWrap.appendChild(form);
      if (sp) {
        formWrap.scrollIntoView({ block: "center" });
        title.focus({ preventScroll: true });
      }
    }

    startForm(null);
    reload();
    return h(
      "section",
      { class: "staff__section", "aria-label": "Specials" },
      h("h2", { class: "section-title", text: "Specials" }),
      h("p", { class: "basis", text: "Students see these on Tonight and on your bar page." }),
      loadErr,
      listEl,
      formWrap
    );
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
    var waitNum = h("span", { class: "stat__value num", "aria-live": "polite", text: "--" });
    var crowdVal = h("span", { class: "stat__value", text: "--" });
    var reportsVal = h("span", { class: "stat__value num", text: "--" });
    var timersVal = h("span", { class: "stat__value num", text: "--" });
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
        crowdVal.textContent = lv.crowd_level ? ui.CROWD_LABEL[lv.crowd_level] : "Unknown";
        reportsVal.textContent = String(lv.basis.reports);
        timersVal.textContent = String(lv.basis.timers);
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
          h("div", null, h("p", { class: "staff__role", text: "Door counter" + (api.isMock ? " · Demo" : "") }), barName),
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
          { class: "staff__section", "aria-label": "What students see" },
          h("h2", { class: "section-title", text: "What students see" }),
          h(
            "ul",
            { class: "stats" },
            h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Line wait estimate" }), waitNum),
            h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Crowd level" }), crowdVal),
            h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Student reports, last 30 min" }), reportsVal),
            h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Line timers, last 30 min" }), timersVal)
          ),
          waitBasis
        ),
        specialsSection(barId),
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
