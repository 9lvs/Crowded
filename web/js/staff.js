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
  var cleanups = [];
  var reminderTick = 0;

  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible" && poll && visibleLoad) visibleLoad();
  });

  C.onAuthLost = function () {
    api.setTokens(null);
    api.me = null;
    signIn();
  };

  function stopTimers() {
    cleanups.forEach(function (f) {
      f();
    });
    cleanups = [];
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
      pitch: "Count people in, report the line and tell us how busy it is inside. Students see a live estimate within seconds.",
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
    if (me.role === "admin" && !me.staff_bar_id) return adminPicker();
    if (!me.staff_bar_id) return invite();
    counter(me.staff_bar_id, { manager: me.staff_level === "manager" || me.role === "admin" });
  }

  // Admins have no bar of their own. They pick one and get the manager view for it.
  function adminPicker() {
    stopTimers();
    ui.clear(root);
    var listEl = h("ul", { class: "bar-pick" });
    var err = h("p", { class: "small form-error", role: "alert" });
    root.appendChild(
      h(
        "div",
        { class: "welcome" },
        h("div", { class: "staff__top" }, ui.wordmark("for staff"), signOutBtn()),
        h(
          "div",
          { class: "welcome__hero" },
          h("h1", { class: "welcome__title", text: "Pick a bar" }),
          h("p", { class: "welcome__pitch", text: "You are an admin. Choose the bar to work on." })
        ),
        err,
        listEl
      )
    );
    api
      .adminBars()
      .then(function (bars) {
        bars.forEach(function (b) {
          if (!b.is_active) return;
          listEl.appendChild(
            h(
              "li",
              null,
              h(
                "button",
                {
                  class: "btn btn--secondary btn--block btn--lg",
                  type: "button",
                  onclick: function () {
                    counter(b.id, { manager: true, admin: true });
                  }
                },
                b.name
              )
            )
          );
        });
        if (!listEl.children.length) err.textContent = "No bars yet.";
      })
      .catch(function (e) {
        if (e.status !== 401 && e.status !== 429) err.textContent = e.detail || "Could not load bars";
      });
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
    "control characters are not allowed": "Remove special characters from the text.",
    times_required: "Set a start and end time, or turn on All night.",
    too_many_items: "Add at most 20 items.",
    item_incomplete: "Each item needs a name and a price."
  };
  var MAX_ITEMS = 20;

  // FastAPI 422s look like {detail: "validation_error", errors: [{loc, msg}]}. Say it in plain words.
  function validationText(errors) {
    var out = null;
    (errors || []).some(function (er) {
      var msg = String((er && er.msg) || "").replace(/^Value error, /, "");
      var loc = (er && er.loc ? er.loc : []).join(".");
      var inItems = loc.indexOf("items") !== -1;
      if (msg.indexOf("times_required") !== -1) out = SPECIAL_ERRORS.times_required;
      else if (msg.indexOf("at most 20 items") !== -1) out = SPECIAL_ERRORS.too_many_items;
      else if (inItems && loc.indexOf("name") !== -1 && msg.indexOf("at most") !== -1) out = "An item name can be 60 letters at most.";
      else if (inItems && loc.indexOf("price_label") !== -1 && msg.indexOf("at most") !== -1) out = "An item price can be 20 letters at most.";
      else if (inItems && loc.indexOf("note") !== -1 && msg.indexOf("at most") !== -1) out = "An item note can be 40 letters at most.";
      else if (inItems && msg.indexOf("at least 1 character") !== -1) out = SPECIAL_ERRORS.item_incomplete;
      else if (inItems && loc.indexOf("category") !== -1) out = "Pick a category for each item.";
      else if (SPECIAL_ERRORS[msg]) out = SPECIAL_ERRORS[msg];
      return !!out;
    });
    return out;
  }

  function specialError(e) {
    var d = e && e.detail;
    if (e && e.status === 422 && e.errors && e.errors.length) {
      var plain = validationText(e.errors);
      return plain || "Check the form. " + String(e.errors[0].msg || "").replace(/^Value error, /, "");
    }
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
        var count = sp.items ? sp.items.length : 0;
        var sub = ui.kindLabel(sp.kind) + " · " + daysText(sp.days) + " · " + (sp.all_day ? "All night" : ui.fmtWindow(sp)) +
          (price ? " · " + price : "") + (count ? " · " + count + (count === 1 ? " item" : " items") : "");
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
      var allDay = h("input", { class: "sp-check__box", id: "sp-allday", type: "checkbox" });
      var timesBlock = h(
        "div",
        { class: "sp-timesblock" },
        h(
          "div",
          { class: "sp-times" },
          h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-start", text: "Starts" }), start),
          h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-end", text: "Ends" }), end)
        ),
        h("p", { class: "field__hint", text: "An end time before the start runs past midnight." })
      );
      var items = [];
      if (sp) {
        kind.value = sp.kind;
        title.value = sp.title;
        details.value = sp.details || "";
        if (sp.all_day) allDay.checked = true;
        else {
          start.value = sp.start_local;
          end.value = sp.end_local;
        }
        price.value = centsToDollars(sp.price_cents);
        items = (sp.items || []).map(function (i) {
          return { name: i.name, price_label: i.price_label, category: i.category, note: i.note || "" };
        });
      }
      timesBlock.hidden = allDay.checked;
      allDay.addEventListener("change", function () {
        timesBlock.hidden = allDay.checked;
      });
      var itemsEl = h("div", { class: "sp-items" });
      var itemsHint = h("p", { class: "field__hint" });
      var addItem = h(
        "button",
        {
          class: "btn btn--secondary",
          type: "button",
          onclick: function () {
            if (items.length >= MAX_ITEMS) return;
            items.push({ name: "", price_label: "", category: "beer", note: "" });
            drawItems();
            var names = itemsEl.querySelectorAll("input[data-f='name']");
            if (names.length) names[names.length - 1].focus();
          }
        },
        "Add item"
      );
      function itemField(label, id, control) {
        return h("div", { class: "field" }, h("label", { class: "field__label", for: id, text: label }), control);
      }
      function drawItems() {
        ui.clear(itemsEl);
        items.forEach(function (it, i) {
          var n = i + 1;
          var pre = "sp-item-" + n + "-";
          var name = h("input", { class: "input", id: pre + "name", "data-f": "name", type: "text", maxlength: "60", autocomplete: "off", placeholder: "Lager drafts", value: it.name });
          var pl = h("input", { class: "input", id: pre + "price", type: "text", maxlength: "20", autocomplete: "off", placeholder: "$3 or 2 for 1", value: it.price_label });
          var cat = h("select", { class: "input", id: pre + "cat" });
          ui.DEAL_CATEGORIES.forEach(function (c) {
            cat.appendChild(h("option", { value: c.value, text: c.label }));
          });
          cat.value = it.category;
          var note = h("input", { class: "input", id: pre + "note", type: "text", maxlength: "40", autocomplete: "off", placeholder: "Dine in only", value: it.note });
          name.addEventListener("input", function () { it.name = name.value; });
          pl.addEventListener("input", function () { it.price_label = pl.value; });
          cat.addEventListener("change", function () { it.category = cat.value; });
          note.addEventListener("input", function () { it.note = note.value; });
          itemsEl.appendChild(
            h(
              "div",
              { class: "sp-item-row", role: "group", "aria-label": "Item " + n },
              itemField("Name", pre + "name", name),
              h("div", { class: "sp-times" }, itemField("Price", pre + "price", pl), itemField("Category", pre + "cat", cat)),
              itemField("Note (optional)", pre + "note", note),
              h(
                "button",
                {
                  class: "btn btn--outline",
                  type: "button",
                  "aria-label": "Remove item " + n,
                  onclick: function () {
                    items.splice(i, 1);
                    drawItems();
                  }
                },
                "Remove"
              )
            )
          );
        });
        addItem.disabled = items.length >= MAX_ITEMS;
        itemsHint.textContent = items.length >= MAX_ITEMS ? "That is the most items one special can hold." : items.length + " of " + MAX_ITEMS + " items.";
      }
      drawItems();
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
            if (!allDay.checked) {
              if (!start.value || !end.value) return void (err.textContent = SPECIAL_ERRORS.times_required);
              if (start.value === end.value) return void (err.textContent = SPECIAL_ERRORS.start_equals_end);
            }
            var pr = dollarsToCents(price.value);
            if (pr.error) return void (err.textContent = pr.error);
            var cleanItems = [];
            for (var k = 0; k < items.length; k++) {
              var it = items[k];
              var nm = it.name.trim();
              var pl2 = it.price_label.trim();
              var nt = it.note.trim();
              if (!nm && !pl2 && !nt) continue;
              if (!nm || !pl2) return void (err.textContent = "Item " + (k + 1) + " needs a name and a price.");
              cleanItems.push({ name: nm, price_label: pl2, category: it.category, note: nt });
            }
            var body = {
              kind: kind.value,
              title: t,
              details: details.value.trim(),
              days: days.slice().sort(),
              price_cents: pr.cents,
              all_day: allDay.checked,
              items: cleanItems
            };
            if (!allDay.checked) {
              body.start_local = start.value;
              body.end_local = end.value;
            }
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
        h("label", { class: "sp-check", for: "sp-allday" }, allDay, h("span", { text: "All night" })),
        timesBlock,
        h("div", { class: "field" }, h("label", { class: "field__label", for: "sp-price", text: "Price in dollars" }), price),
        h(
          "div",
          { class: "sp-itemsblock" },
          h("h4", { class: "sp-form__sub", text: "Menu items" }),
          h("p", { class: "field__hint", text: "Students see these as a price list. Optional." }),
          itemsEl,
          itemsHint,
          addItem
        ),
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

  // ---------- Door mode ----------
  var IN_KEYS = { ArrowRight: 1, PageDown: 1, " ": 1, Enter: 1, ".": 1 };
  var OUT_KEYS = { ArrowLeft: 1, PageUp: 1, ",": 1 };
  var UNDO_MS = 30000;
  var INSIDE_REMIND_MS = 15 * 60000;
  var LINE_REMIND_MS = 15 * 60000;
  var SAMPLE_REMIND_MS = 20 * 60000;

  function vibrate(pattern) {
    try {
      if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {
      /* ignore */
    }
  }

  function reducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function readJson(key) {
    try {
      var raw = ui.storage(key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      ui.storage(key, value === null ? null : JSON.stringify(value));
    } catch (e) {
      /* ignore */
    }
  }

  function counter(barId, opts) {
    opts = opts || {};
    var manager = !!opts.manager;
    stopTimers();
    ui.clear(root);
    var QKEY = "crowded.door.queue." + barId;
    var LKEY = "crowded.door.last." + barId;
    var server = null; // last StaffState from the server
    var local = { headcount: 0, line_size: null, crowd: null, drink: null, insideAt: 0 };
    var queue = []; // taps not yet saved: {dir, n, ts}
    var draining = false;
    var offline = false;
    var retryMs = 0;
    var retryTimer = null;
    var lastTap = null; // {dir, n, ts} for Undo
    var undoTimer = null;
    var tab = "door";
    var samples = [];
    var chipTimes = {};
    var lastCheck = readJson(LKEY); // {min, at}
    var opened = Date.now();
    var lineDismissed = 0;
    var sampleDismissed = 0;
    var lineLocalSet = 0;
    var insideDismissed = 0;
    var showLineRemind = false;
    var showSampleRemind = false;
    var showInsideRemind = false;
    var wake = null;

    // ----- persisted queue (backup only) -----
    var saved = readJson(QKEY);
    if (Array.isArray(saved)) {
      saved.forEach(function (it) {
        if (it && (it.dir === "in" || it.dir === "out") && it.n >= 1 && it.n <= 20 && Date.now() - it.ts < 6 * 3600000) {
          queue.push({ dir: it.dir, n: it.n, ts: it.ts });
        }
      });
    }
    function persist() {
      writeJson(
        QKEY,
        queue.length
          ? queue.map(function (it) {
              return { dir: it.dir, n: it.n, ts: it.ts };
            })
          : null
      );
    }
    function queuedNet() {
      var net = 0;
      queue.forEach(function (it) {
        net += it.dir === "in" ? it.n : -it.n;
      });
      return net;
    }

    // ----- elements -----
    var barName = h("p", { class: "staff__bar", text: "Loading" });
    var countLabel = h("p", { class: "count__label", text: "Inside now" });
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
    var offlineNote = h("p", { class: "offline", role: "status", hidden: true });
    var remindBox = h("div", { class: "reminders" });
    var chipBox = h("div", { class: "chips" });
    var lastCheckEl = h("p", { class: "lastcheck", text: "" });
    var timeBtn = h("button", { class: "btn btn--primary btn--block btn--lg", type: "button", onclick: startSample }, "Time the line");
    var undoBtn = h(
      "button",
      { class: "btn btn--outline door__undo", type: "button", "aria-label": "Undo last tap", disabled: true, onclick: undo },
      "Undo"
    );
    var insideUpdated = h("p", { class: "updated", text: "" });
    var seeCrowd = h("span", { class: "stat__value", text: "--" });
    var seeDrink = h("span", { class: "stat__value", text: "--" });
    var seeBasis = h("p", { class: "basis", text: "" });
    var entriesOnlyNote = h("p", { class: "clicker-hint entries-note", text: "This bar counts entries only." });
    var clickerBtn = h("button", { class: "btn btn--secondary btn--block", type: "button", onclick: clickerSheet }, "Clicker total");
    var clickerHint = h("p", { class: "clicker-hint", text: "" });
    var exitsSwitch = h(
      "button",
      {
        class: "sp-switch",
        type: "button",
        role: "switch",
        "aria-checked": "false",
        "aria-label": "Count exits too",
        disabled: true,
        onclick: function () {
          toggleExits();
        }
      },
      "Off"
    );
    var statsBox = h("ul", { class: "stats" });

    var lineSeg = ui.segmented({
      label: "Outside line size",
      wrap: true,
      options: ui.LINE_SIZES,
      onChange: function (v) {
        if (!v) return;
        ui.haptic();
        local.line_size = v;
        lineLocalSet = Date.now();
        showLineRemind = false;
        drawReminders();
        sendLine(v);
      }
    });

    var crowdSeg = ui.segmented({
      label: "How busy inside",
      options: [
        { value: "easy", label: "Easy" },
        { value: "busy", label: "Busy" },
        { value: "packed", label: "Packed" }
      ],
      onChange: function (v) {
        if (v) sendInside({ crowd_level: v });
      }
    });
    var drinkSeg = ui.segmented({
      label: "How long for a drink",
      wrap: true,
      cols: 2,
      options: ui.DRINK_WAITS,
      onChange: function (v) {
        if (v) sendInside({ drink_wait: v });
      }
    });

    function sendInside(body) {
      ui.haptic();
      if (body.crowd_level) local.crowd = body.crowd_level;
      if (body.drink_wait) local.drink = body.drink_wait;
      local.insideAt = Date.now();
      showInsideRemind = false;
      drawReminders();
      api
        .inside(barId, body)
        .then(function (st) {
          reconcile(st);
          ui.toast(body.crowd_level ? "Inside set to " + ui.CROWD_LABEL[body.crowd_level].toLowerCase() : "Drink wait saved");
        })
        .catch(function (e) {
          if (!quietError(e)) ui.toast(e.status === 0 ? "You're offline. Not saved." : e.detail || "Not saved. Try again.");
          load();
        });
    }

    function toggleExits() {
      if (!server) return;
      var next = !(server.counts_exits !== false);
      exitsSwitch.disabled = true;
      api
        .updateSettings(barId, { counts_exits: next })
        .then(function (st) {
          reconcile(st);
          ui.toast(next ? "Exits are counted" : "Entries only");
        })
        .catch(function (e) {
          if (!quietError(e)) ui.toast(e.status === 403 ? "Only managers can change this." : e.detail || "Not saved. Try again.");
        })
        .then(function () {
          exitsSwitch.disabled = !server;
        });
    }

    function countsExits() {
      return !server || server.counts_exits !== false;
    }

    function labelFor(v) {
      for (var i = 0; i < ui.LINE_SIZES.length; i++) if (ui.LINE_SIZES[i].value === v) return ui.LINE_SIZES[i].label.toLowerCase();
      return v;
    }

    function quietError(e) {
      return e.status === 429 || e.status === 401;
    }

    function sendLine(v) {
      api
        .lineSize(barId, v)
        .then(function (st) {
          reconcile(st);
          ui.toast("Line set to " + labelFor(v));
        })
        .catch(function (e) {
          if (!quietError(e)) ui.toast(e.status === 0 ? "You're offline. Line not saved." : e.detail || "Not saved. Try again.");
          load();
        });
    }

    // ----- painting -----
    function paint() {
      var cap = server ? server.capacity : 0;
      var exits = countsExits();
      num.textContent = String(local.headcount);
      countLabel.textContent = exits ? "Inside now" : "Entries tonight";
      countSection.setAttribute("aria-label", exits ? "Headcount" : "Entries tonight");
      capText.hidden = !exits;
      capBar.hidden = !exits;
      outZone.hidden = !exits;
      entriesOnlyNote.hidden = exits;
      clickerBtn.hidden = !exits;
      tally.hidden = !exits;
      clickerHint.textContent = exits
        ? "Clicker ready. Right arrow or Page Down is In. Left arrow or Page Up is Out."
        : "Clicker ready. Right arrow or Page Down is In.";
      var ratio = cap ? local.headcount / cap : 0;
      var level = ratio < 0.6 ? "easy" : ratio < 0.9 ? "busy" : "packed";
      capText.textContent = cap ? "of " + cap + " capacity · " + Math.round(ratio * 100) + "%" : "";
      fill.setAttribute("data-level", level);
      fill.style.setProperty("width", Math.min(100, Math.round(ratio * 100)) + "%");
      capBar.setAttribute("aria-label", local.headcount + " of " + cap + " capacity, " + ui.CROWD_LABEL[level]);
      lineSeg.set(local.line_size);
      crowdSeg.set(local.crowd);
      drinkSeg.set(local.drink);
      exitsSwitch.disabled = !server;
      exitsSwitch.setAttribute("aria-checked", String(exits));
      exitsSwitch.textContent = exits ? "On" : "Off";
      if (server) {
        paintInside();
        if (manager) paintStats();
        barName.textContent = server.bar_name;
        updated.textContent = "Line updated " + ui.fmtAgo(server.line_updated_at);
        var lv = server.live;
        waitNum.textContent = lv.has_recent_data && lv.wait_min !== null ? lv.wait_min + " min" : "No data";
        crowdVal.textContent = lv.crowd_level ? ui.CROWD_LABEL[lv.crowd_level] : "Unknown";
        reportsVal.textContent = String(lv.basis.reports);
        timersVal.textContent = String(lv.basis.timers);
        waitBasis.textContent = lv.basis.text;
        tally.textContent = server.entries_tonight + " in · " + server.exits_tonight + " out tonight";
        insideUpdated.textContent = insideAgoText();
      }
      if (queue.length && offline) {
        offlineNote.textContent = "Saving when back online (" + queue.length + ")";
        offlineNote.hidden = false;
      } else {
        offlineNote.hidden = true;
        offlineNote.textContent = "";
      }
    }

    // Count in only bars show entries tonight. An Undo there is saved as one Out, so entries
    // minus exits is what the door counted. For a bar that counts exits it is the headcount.
    function doorTotal(st) {
      return st.counts_exits === false ? st.entries_tonight - st.exits_tonight : st.headcount;
    }

    function reconcile(st) {
      server = st;
      local.headcount = Math.max(0, doorTotal(st) + queuedNet());
      local.line_size = st.line_size;
      if (st.inside) {
        // The latest row may hold only one of the two answers. Keep the other one we know.
        if (st.inside.crowd_level) local.crowd = st.inside.crowd_level;
        if (st.inside.drink_wait) local.drink = st.inside.drink_wait;
      }
      paint();
    }

    function insideAt() {
      var t = server && server.inside ? new Date(server.inside.updated_at).getTime() : 0;
      return Math.max(t, local.insideAt);
    }

    function insideAgoText() {
      var t = insideAt();
      return t ? "Updated " + ui.fmtAgo(new Date(t).toISOString()) : "Nothing reported inside yet tonight.";
    }

    function paintInside() {
      var lv = server.live;
      seeCrowd.textContent = lv.crowd_level ? ui.CROWD_LABEL[lv.crowd_level] : "Unknown";
      seeDrink.textContent = lv.drink_wait_label || "No recent data";
      seeBasis.textContent = lv.basis.text;
    }

    function paintStats() {
      ui.clear(statsBox);
      function row(label, value) {
        statsBox.appendChild(h("li", { class: "stat" }, h("span", { class: "stat__label", text: label }), h("span", { class: "stat__value", text: value })));
      }
      row("Entries tonight", String(server.entries_tonight));
      if (countsExits()) row("Exits tonight", String(server.exits_tonight));
      var parts = [];
      if (server.inside && server.inside.crowd_level) parts.push(ui.CROWD_LABEL[server.inside.crowd_level]);
      if (server.inside && server.inside.drink_wait) parts.push("drinks " + ui.DRINK_LABEL[server.inside.drink_wait]);
      row("Latest inside report", server.inside ? (parts.join(", ") || "Updated") + ", " + ui.fmtAgo(server.inside.updated_at) : "None yet");
      row("Line checks", lastCheck ? Math.round(lastCheck.min) + " min, " + ui.fmtAgo(lastCheck.at) : "None yet");
    }

    // ----- door taps and the offline queue -----
    function scheduleRetry() {
      clearTimeout(retryTimer);
      retryMs = retryMs ? Math.min(30000, retryMs * 2) : 2000;
      retryTimer = setTimeout(drain, retryMs);
    }

    function drain() {
      if (draining || !queue.length) return;
      draining = true;
      var item = queue[0];
      item.flying = true;
      api
        .door(barId, item.dir, item.n)
        .then(function (st) {
          queue.shift();
          persist();
          offline = false;
          retryMs = 0;
          draining = false;
          reconcile(st);
          drain();
        })
        .catch(function (e) {
          item.flying = false;
          draining = false;
          if (e.status === 0 || e.status === 429) {
            offline = e.status === 0;
            paint();
            scheduleRetry();
            return;
          }
          if (e.status === 401) return;
          queue.shift();
          persist();
          ui.toast(e.detail === "headcount_below_zero" ? "The count cannot go below 0." : e.detail || "Not saved. Try again.");
          api
            .staffState(barId)
            .then(reconcile)
            .catch(function () {})
            .then(drain);
        });
    }

    function flash(btn) {
      if (!btn || reducedMotion()) return;
      btn.classList.add("is-flash");
      setTimeout(function () {
        btn.classList.remove("is-flash");
      }, 140);
    }

    function enqueue(dir, n) {
      var tail = queue[queue.length - 1];
      if (tail && !tail.flying && tail.dir === dir && tail.n + n <= 20) tail.n += n;
      else queue.push({ dir: dir, n: n, ts: Date.now() });
      persist();
      drain();
    }

    function tap(dir, n, btn) {
      if (dir === "out" && !countsExits()) return;
      if (dir === "out" && local.headcount < 1) {
        ui.toast("The count is already 0.");
        return;
      }
      vibrate(15);
      flash(btn);
      local.headcount = dir === "in" ? local.headcount + n : Math.max(0, local.headcount - n);
      lastTap = { dir: dir, n: n, ts: Date.now() };
      armUndo();
      enqueue(dir, n);
      paint();
    }

    function armUndo() {
      undoBtn.disabled = false;
      clearTimeout(undoTimer);
      undoTimer = setTimeout(function () {
        lastTap = null;
        undoBtn.disabled = true;
      }, UNDO_MS);
    }

    function undo() {
      if (!lastTap || Date.now() - lastTap.ts > UNDO_MS) return;
      var t = lastTap;
      var dir = t.dir === "in" ? "out" : "in";
      if (dir === "out" && !countsExits() && local.headcount < t.n) return;
      lastTap = null;
      clearTimeout(undoTimer);
      undoBtn.disabled = true;
      undoBtn.blur();
      vibrate(15);
      local.headcount = dir === "in" ? local.headcount + t.n : Math.max(0, local.headcount - t.n);
      enqueue(dir, t.n);
      paint();
      ui.toast("Undid " + t.n + (t.dir === "in" ? " in" : " out"));
    }

    function zoneClick(dir, n) {
      return function (e) {
        var b = e.currentTarget;
        tap(dir, n, b);
        b.blur();
      };
    }

    function load() {
      if (queue.length || draining) return Promise.resolve();
      return api
        .staffState(barId)
        .then(reconcile)
        .catch(function (e) {
          if (e.status === 403) {
            ui.toast("This phone is not staff for that bar");
          } else if (!quietError(e) && e.status !== 0) {
            ui.toast(e.detail || "Could not load the counter");
          }
        });
    }

    // ----- clicker keys -----
    function onKey(e) {
      if (tab !== "door" || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector(".sheet")) return;
      var key = e.key;
      var dir = IN_KEYS[key] ? "in" : OUT_KEYS[key] ? "out" : null;
      if (!dir) return;
      var t = e.target;
      var tag = t && t.tagName ? t.tagName.toLowerCase() : "";
      if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
      // A focused button or link already turns Space and Enter into a click.
      if ((tag === "button" || tag === "a") && (key === " " || key === "Enter")) return;
      e.preventDefault();
      tap(dir, 1, dir === "in" ? inZone : outZone);
    }
    document.addEventListener("keydown", onKey);
    cleanups.push(function () {
      document.removeEventListener("keydown", onKey);
    });

    // ----- wake lock -----
    function wantWake() {
      if (tab !== "door" || document.visibilityState !== "visible") return;
      if (wake || !navigator.wakeLock) return;
      try {
        navigator.wakeLock
          .request("screen")
          .then(function (s) {
            wake = s;
            s.addEventListener("release", function () {
              if (wake === s) wake = null;
            });
          })
          .catch(function () {});
      } catch (e) {
        /* ignore */
      }
    }
    function dropWake() {
      var s = wake;
      wake = null;
      try {
        if (s) s.release().catch(function () {});
      } catch (e) {
        /* ignore */
      }
    }
    function onVisible() {
      if (document.visibilityState === "visible") {
        wantWake();
        load();
        drain();
      }
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", drain);
    cleanups.push(function () {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", drain);
      clearTimeout(retryTimer);
      clearTimeout(undoTimer);
      dropWake();
    });

    // ----- clicker total sheet -----
    function clickerSheet() {
      var digits = "";
      var shown = h("p", { class: "pad__value", role: "status", "aria-live": "polite", text: "0" });
      var go = h("button", { class: "btn btn--primary btn--block btn--lg", type: "button", disabled: true }, "Set inside now");
      function redraw() {
        shown.textContent = digits || "0";
        go.disabled = !digits;
      }
      function add(d) {
        if (digits.length >= 4) return;
        var next = (digits + d).replace(/^0+(?=\d)/, "");
        if (Number(next) > 5000) return;
        digits = next;
        redraw();
      }
      function back() {
        digits = digits.slice(0, -1);
        redraw();
      }
      function key(label, aria, fn, cls) {
        return h("button", { class: "pad__key" + (cls ? " " + cls : ""), type: "button", "aria-label": aria, onclick: fn }, label);
      }
      var keys = [];
      for (var d = 1; d <= 9; d++) {
        keys.push(
          (function (n) {
            return key(String(n), String(n), function () {
              add(String(n));
            });
          })(d)
        );
      }
      keys.push(
        key(
          "Clear",
          "Clear",
          function () {
            digits = "";
            redraw();
          },
          "pad__key--small"
        )
      );
      keys.push(
        key("0", "0", function () {
          add("0");
        })
      );
      keys.push(key("Delete", "Delete last digit", back, "pad__key--small"));
      var sh;
      function onPadKey(e) {
        if (/^[0-9]$/.test(e.key)) add(e.key);
        else if (e.key === "Backspace") back();
        else if (e.key === "Enter" && digits) go.click();
      }
      function sendSync(n, tries) {
        // Let pending taps save first so the total lands after them.
        if (queue.length || draining) {
          if (tries > 40) {
            go.disabled = false;
            ui.toast("Taps are still saving. Try again in a moment.");
            return;
          }
          setTimeout(function () {
            sendSync(n, tries + 1);
          }, 250);
          return;
        }
        api
          .countSync(barId, n)
          .then(function (st) {
            reconcile(st);
            sh.close();
            ui.toast("Inside now set to " + n);
          })
          .catch(function (e) {
            go.disabled = false;
            if (!quietError(e)) ui.toast(e.status === 0 ? "You're offline. Not saved." : e.detail || "Not saved. Try again.");
          });
      }
      go.addEventListener("click", function () {
        go.disabled = true;
        sendSync(Number(digits), 0);
      });
      document.addEventListener("keydown", onPadKey);
      sh = ui.sheet({
        title: "Clicker total",
        body: "Type the number on your hand clicker. Inside now will match it.",
        content: h("div", { class: "pad" }, h("p", { class: "pad__label", text: "Inside now" }), shown, h("div", { class: "pad__grid" }, keys), go),
        onClose: function () {
          document.removeEventListener("keydown", onPadKey);
        }
      });
    }

    // ----- line checks -----
    function lastCheckText() {
      if (!lastCheck) return "No line check yet tonight.";
      return "Last line check: " + Math.round(lastCheck.min) + " min, " + ui.fmtAgo(lastCheck.at);
    }

    function drawChips() {
      ui.clear(chipBox);
      chipTimes = {};
      samples.forEach(function (s, i) {
        var t = h("span", { class: "chip__time", text: "0:00" });
        chipTimes[s.id] = { el: t, at: new Date(s.started_at).getTime() };
        chipBox.appendChild(
          h(
            "div",
            { class: "chip", role: "group", "aria-label": "Line check " + (i + 1) + " running" },
            h("p", { class: "chip__label" }, h("span", { text: "Line check " + (i + 1) }), t),
            h(
              "button",
              {
                class: "btn btn--primary chip__btn",
                type: "button",
                onclick: function () {
                  endSample(s, "inside");
                }
              },
              "They're in"
            ),
            h(
              "button",
              {
                class: "btn btn--secondary chip__btn",
                type: "button",
                onclick: function () {
                  endSample(s, "cancel");
                }
              },
              "Cancel"
            )
          )
        );
      });
      timeBtn.disabled = samples.length >= 2;
      timeBtn.textContent = samples.length >= 2 ? "2 line checks running" : "Time the line";
      tickChips();
    }

    function tickChips() {
      Object.keys(chipTimes).forEach(function (id) {
        chipTimes[id].el.textContent = ui.fmtClock((Date.now() - chipTimes[id].at) / 1000);
      });
    }

    function loadSamples() {
      return api
        .activeSamples(barId)
        .then(function (rows) {
          samples = rows;
          drawChips();
        })
        .catch(function () {});
    }

    function startSample() {
      if (samples.length >= 2) return;
      timeBtn.disabled = true;
      api
        .startSample(barId)
        .then(function (s) {
          vibrate(15);
          samples.push(s);
          showSampleRemind = false;
          drawReminders();
          drawChips();
          ui.toast("Timing started");
        })
        .catch(function (e) {
          timeBtn.disabled = false;
          if (quietError(e)) return;
          ui.toast(
            e.status === 409
              ? "Two line checks are running. Finish one first."
              : e.status === 0
                ? "You're offline. Try again."
                : e.detail || "Could not start"
          );
          loadSamples();
        });
    }

    function endSample(s, outcome) {
      samples = samples.filter(function (x) {
        return x.id !== s.id;
      });
      drawChips();
      api
        .endSample(barId, s.id, outcome)
        .then(function (out) {
          if (outcome === "cancel") return ui.toast("Line check cancelled");
          if (out.status === "completed" && out.actual_wait_min !== null) {
            lastCheck = { min: out.actual_wait_min, at: out.ended_at };
            writeJson(LKEY, lastCheck);
            lastCheckEl.textContent = lastCheckText();
            showSampleRemind = false;
            drawReminders();
            ui.toast("Line check saved: " + Math.round(out.actual_wait_min) + " min");
          } else {
            ui.toast("Too quick to count. Under 30 seconds is skipped.");
          }
        })
        .catch(function (e) {
          if (!quietError(e)) {
            ui.toast(
              e.status === 0 ? "You're offline. Not saved." : e.status === 409 ? "That line check already ended." : e.detail || "Not saved"
            );
          }
          loadSamples();
        });
    }

    // ----- reminders -----
    function drawReminders() {
      ui.clear(remindBox);
      function banner(text, actionLabel, target, dismiss) {
        remindBox.appendChild(
          h(
            "div",
            { class: "reminder", role: "status" },
            h("p", { class: "reminder__text", text: text }),
            h(
              "button",
              {
                class: "btn btn--secondary reminder__btn",
                type: "button",
                onclick: function () {
                  show(target);
                }
              },
              actionLabel
            ),
            h("button", { class: "btn btn--outline reminder__btn", type: "button", "aria-label": "Dismiss: " + text, onclick: dismiss }, "Dismiss")
          )
        );
      }
      if (showInsideRemind) {
        banner("Update inside: how busy and drink wait", "Update", "inside", function () {
          showInsideRemind = false;
          insideDismissed = Date.now();
          drawReminders();
        });
      }
      if (showLineRemind) {
        banner("Update the line size", "Update", "line", function () {
          showLineRemind = false;
          lineDismissed = Date.now();
          drawReminders();
        });
      }
      if (showSampleRemind) {
        banner("Time the line", "Start", "line", function () {
          showSampleRemind = false;
          sampleDismissed = Date.now();
          drawReminders();
        });
      }
    }

    function checkReminders() {
      var now = Date.now();
      var lineAt = server && server.line_updated_at ? new Date(server.line_updated_at).getTime() : 0;
      var changed = false;
      if (!showInsideRemind && now - Math.max(insideAt(), insideDismissed, opened) >= INSIDE_REMIND_MS) {
        showInsideRemind = true;
        insideDismissed = now;
        changed = true;
      }
      if (!showLineRemind && now - Math.max(lineAt, lineLocalSet, lineDismissed, opened) >= LINE_REMIND_MS) {
        showLineRemind = true;
        lineDismissed = now;
        changed = true;
      }
      var checkAt = lastCheck ? new Date(lastCheck.at).getTime() : 0;
      if (!showSampleRemind && !samples.length && now - Math.max(checkAt, sampleDismissed, opened) >= SAMPLE_REMIND_MS) {
        showSampleRemind = true;
        sampleDismissed = now;
        changed = true;
      }
      if (changed) {
        vibrate([200, 100, 200]);
        drawReminders();
      }
    }

    // ----- layout -----
    var outZone = h(
      "button",
      { class: "btn btn--secondary btn--block door__out", type: "button", "aria-label": "One person out", onclick: zoneClick("out", 1) },
      ui.icon("minus"),
      h("span", { text: "OUT" })
    );
    var inZone = h(
      "button",
      { class: "zone zone--in", type: "button", "aria-label": "One person in", onclick: zoneClick("in", 1) },
      ui.icon("plus"),
      h("span", { text: "IN" })
    );
    function groupBtn(n, word) {
      return h("button", { class: "btn btn--secondary door__group", type: "button", "aria-label": word + " people in", onclick: zoneClick("in", n) }, "+" + n);
    }

    var countSection = h("section", { class: "count", "aria-label": "Headcount" }, countLabel, num, capText, capBar);

    var doorView = h(
      "div",
      { class: "view view--door" },
      countSection,
      h("div", { class: "zones" }, inZone),
      h("div", { class: "door__row" }, groupBtn(2, "Two"), groupBtn(3, "Three"), groupBtn(4, "Four"), undoBtn),
      h("div", { class: "door__tools" }, outZone, entriesOnlyNote, clickerBtn),
      clickerHint,
      h("div", { class: "staff__foot" }, tally)
    );

    var lineView = h(
      "div",
      { class: "view view--line", hidden: true },
      h("section", { class: "staff__section", "aria-label": "Outside line" }, h("h2", { class: "section-title", text: "Outside line" }), lineSeg.el, updated),
      h(
        "section",
        { class: "staff__section", "aria-label": "Line check" },
        h("h2", { class: "section-title", text: "Line check" }),
        h("p", { class: "basis", text: "Tap when someone joins the back of the line." }),
        h("div", { class: "line-check__btn" }, timeBtn),
        lastCheckEl
      ),
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
      )
    );

    var insideView = h(
      "div",
      { class: "view view--inside", hidden: true },
      h("section", { class: "staff__section", "aria-label": "How busy inside" }, h("h2", { class: "section-title", text: "How busy inside?" }), crowdSeg.el),
      h("section", { class: "staff__section", "aria-label": "How long for a drink" }, h("h2", { class: "section-title", text: "How long for a drink?" }), drinkSeg.el, insideUpdated),
      h(
        "section",
        { class: "staff__section", "aria-label": "What students see inside" },
        h("h2", { class: "section-title", text: "What students see" }),
        h(
          "ul",
          { class: "stats" },
          h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Crowd" }), seeCrowd),
          h("li", { class: "stat" }, h("span", { class: "stat__label", text: "Drinks" }), seeDrink)
        ),
        seeBasis
      )
    );

    var views = { door: doorView, line: lineView, inside: insideView };
    if (manager) {
      views.manage = h(
        "div",
        { class: "view view--manage", hidden: true },
        h(
          "section",
          { class: "staff__section", "aria-label": "Settings" },
          h("h2", { class: "section-title", text: "Settings" }),
          h(
            "div",
            { class: "setting-row" },
            h("div", null, h("p", { class: "setting-row__title", text: "Count exits too" }), h("p", { class: "field__hint", text: "Off means the door counts entries only." })),
            exitsSwitch
          )
        ),
        h("section", { class: "staff__section", "aria-label": "Tonight so far" }, h("h2", { class: "section-title", text: "Tonight so far" }), statsBox),
        specialsSection(barId)
      );
    }
    var tabBtns = {};
    function tabButton(name, label, iconName) {
      var b = h(
        "button",
        {
          class: "tab",
          type: "button",
          "aria-current": name === tab ? "page" : null,
          onclick: function (e) {
            show(name);
            e.currentTarget.blur();
          }
        },
        ui.icon(iconName),
        h("span", { text: label })
      );
      tabBtns[name] = b;
      return b;
    }

    function show(name) {
      tab = name;
      Object.keys(views).forEach(function (k) {
        views[k].hidden = k !== name;
        if (k === name) tabBtns[k].setAttribute("aria-current", "page");
        else tabBtns[k].removeAttribute("aria-current");
      });
      if (name === "door") wantWake();
      else dropWake();
      window.scrollTo(0, 0);
    }

    var roleText = opts.admin ? "Admin" : manager ? "Manager" : "Door counter";
    var tabInner = h(
      "div",
      { class: "tabbar__inner " + (manager ? "tabbar__inner--4" : "tabbar__inner--3") },
      tabButton("door", "Door", "plus"),
      tabButton("line", "Line", "list"),
      tabButton("inside", "Inside", "check")
    );
    if (manager) tabInner.appendChild(tabButton("manage", "Manage", "gear"));

    root.appendChild(
      h(
        "main",
        { class: "staff staff--tabs" },
        h(
          "div",
          { class: "staff__top" },
          h("div", null, h("p", { class: "staff__role", text: roleText + (api.isMock ? " · Demo" : "") }), barName),
          signOutBtn()
        ),
        offlineNote,
        remindBox,
        chipBox,
        doorView,
        lineView,
        insideView,
        manager ? views.manage : null
      )
    );
    root.appendChild(h("nav", { class: "tabbar", "aria-label": "Staff sections" }, tabInner));

    lastCheckEl.textContent = lastCheckText();
    if (queue.length) local.headcount = Math.max(0, queuedNet());
    paint();
    load().then(drain);
    drain();
    loadSamples();
    wantWake();
    visibleLoad = load;
    poll = setInterval(function () {
      if (document.visibilityState === "visible") {
        load();
        loadSamples();
      }
    }, POLL_MS);
    agoTimer = setInterval(function () {
      tickChips();
      lastCheckEl.textContent = lastCheckText();
      if (server) updated.textContent = "Line updated " + ui.fmtAgo(server.line_updated_at);
      if (server) insideUpdated.textContent = insideAgoText();
      reminderTick += 1;
      if (reminderTick % 15 === 0) checkReminders();
    }, 1000);
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
