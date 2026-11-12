/* Admin console. Set up a pilot bar without code: bars, pass price, invites, staff, accuracy and
   the audit log. Admins only. Every call here already exists in the admin API. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var ui = C.ui;
  var api = C.api;
  var h = ui.h;

  var root = document.getElementById("app");
  var bars = [];
  var priceById = {};

  var TIMEZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu"];
  var FIELD_LABEL = {
    name: "Name",
    slug: "Slug",
    address: "Address",
    latitude: "Latitude",
    longitude: "Longitude",
    capacity: "Capacity",
    timezone: "Timezone",
    price_cents: "Price"
  };
  var ACTION_LABEL = {
    "bar.create": "Added a bar",
    "bar.update": "Changed a bar",
    "pass_price.set": "Set the pass price",
    "invite.create": "Created an invite",
    "invite.revoke": "Revoked an invite",
    "staff.remove": "Removed a staff member"
  };

  C.onAuthLost = function () {
    api.setTokens(null);
    api.me = null;
    signIn();
  };

  // ---------- helpers ----------

  function plainError(e) {
    if (!e) return "Something went wrong. Try again.";
    if (e.status === 0) return "You're offline. Check your connection.";
    if (e.status === 422 && e.errors && e.errors.length) {
      return e.errors
        .map(function (x) {
          var loc = x.loc || [];
          var name = loc[loc.length - 1];
          var label = FIELD_LABEL[name] || "A field";
          return label + " is not valid. " + (x.msg && !/^(invalid|Value error)/i.test(x.msg) ? String(x.msg).replace(/^Value error, /, "") + "." : "");
        })
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }
    if (e.detail === "slug_taken") return "That slug is already used by another bar. Pick a different one.";
    if (e.detail === "forbidden" || e.status === 403) return "Only admins can do that.";
    if (e.detail === "not_found" || e.status === 404) return "That was not found. It may have been removed.";
    if (e.status >= 500) return "The server had a problem. Try again in a minute.";
    return "Something went wrong. Try again.";
  }

  function fmtWhen(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function fmtDay(iso) {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  }

  function levelLabel(level) {
    return level === "manager" ? "Manager" : "Door staff";
  }

  function mockSuffix() {
    return api.isMock ? "?mock=1" : "";
  }

  function barName(id) {
    for (var i = 0; i < bars.length; i++) if (bars[i].id === id) return bars[i].name;
    return null;
  }

  function loadBars() {
    return api.adminBars().then(function (list) {
      bars = list;
      // The public list knows each active bar's pass price. Best effort.
      return api
        .bars()
        .then(function (pub) {
          priceById = {};
          pub.forEach(function (b) {
            priceById[b.id] = b.pass_price_cents;
          });
        })
        .catch(function () {
          priceById = {};
        })
        .then(function () {
          return bars;
        });
    });
  }

  function field(id, label, input, help) {
    var err = h("p", { class: "small form-error", id: id + "-err", role: "alert" });
    input.setAttribute("id", id);
    input.setAttribute("aria-describedby", (help ? id + "-help " : "") + id + "-err");
    return {
      input: input,
      err: err,
      el: h(
        "div",
        { class: "field" },
        h("label", { class: "field__label", for: id, text: label }),
        input,
        help ? h("p", { class: "small muted", id: id + "-help", text: help }) : null,
        err
      )
    };
  }

  function textInput(opts) {
    opts = opts || {};
    return h("input", {
      class: "input adm-input",
      type: "text",
      autocomplete: "off",
      autocapitalize: "off",
      spellcheck: "false",
      inputmode: opts.inputmode || null,
      maxlength: opts.maxlength || null,
      placeholder: opts.placeholder || null,
      list: opts.list || null
    });
  }

  function checkbox(id, label, help, checked) {
    var input = h("input", { type: "checkbox", id: id, "aria-describedby": id + "-help" });
    input.checked = !!checked;
    return {
      input: input,
      el: h(
        "label",
        { class: "check adm-check", for: id },
        input,
        h("span", { class: "check__text" }, h("strong", { text: label }), h("span", { class: "small muted", id: id + "-help", text: help }))
      )
    };
  }

  function section(id, title, sub) {
    var body = h("div", { class: "adm-sec__body" });
    return {
      body: body,
      el: h(
        "section",
        { class: "adm-sec", "aria-labelledby": id },
        h("h2", { class: "section-title", id: id, text: title }),
        sub ? h("p", { class: "small muted adm-sec__sub", text: sub }) : null,
        body
      )
    };
  }

  // ---------- shell ----------

  function signOutBtn() {
    return h(
      "button",
      {
        class: "icon-btn",
        type: "button",
        "aria-label": "Sign out",
        onclick: function () {
          api.signOut().then(signIn);
        }
      },
      ui.icon("signout")
    );
  }

  function shell(active, main) {
    ui.clear(root);
    function tab(name, label, go) {
      return h("button", { class: "adm-tab", type: "button", "aria-current": active === name ? "page" : null, onclick: go }, label);
    }
    root.appendChild(
      h(
        "div",
        { class: "adm" },
        h(
          "div",
          { class: "staff__top" },
          ui.wordmark("for admins"),
          h(
            "div",
            { class: "adm-top__right" },
            h("a", { class: "text-btn adm-link", href: "staff.html" + mockSuffix(), text: "Open the staff page" }),
            signOutBtn()
          )
        ),
        h(
          "nav",
          { class: "adm-tabs", "aria-label": "Admin sections" },
          tab("bars", "Bars", showBars),
          tab("accuracy", "Accuracy", showAccuracy),
          tab("audit", "Audit log", showAudit)
        ),
        main
      )
    );
    if (C.motion && main) C.motion.fadeIn(main);
    window.scrollTo(0, 0);
  }

  function backButton(label, go) {
    return h("button", { class: "text-btn adm-back", type: "button", onclick: go }, ui.icon("back"), label);
  }

  // ---------- sign in and gate ----------

  function signIn() {
    ui.clear(root);
    var box = h("div", { class: "adm-narrow" });
    root.appendChild(box);
    C.auth.mount(box, {
      brandSuffix: "for admins",
      title: "Admin console",
      pitch: "Set up bars, pass prices and staff invites. Admins only.",
      demo: api.isMock,
      footer: h("p", { class: "welcome__alt" }, h("a", { class: "link-btn", href: "index.html" + mockSuffix(), text: "Open the app" })),
      onDone: route
    });
  }

  function adminsOnly() {
    ui.clear(root);
    root.appendChild(
      h(
        "div",
        { class: "adm-narrow welcome" },
        ui.wordmark("for admins"),
        h("div", { class: "welcome__hero" }, h("h1", { class: "welcome__title", text: "Admins only" }), h("p", { class: "welcome__pitch", text: "This account is not an admin." })),
        h(
          "button",
          {
            class: "text-btn",
            type: "button",
            onclick: function () {
              api.signOut().then(signIn);
            }
          },
          "Sign out"
        )
      )
    );
  }

  function route() {
    var me = api.me;
    if (!me) return signIn();
    if (me.role !== "admin") return adminsOnly();
    showBars();
  }

  // ---------- bars list ----------

  function flag(on, yes, no) {
    return h("span", { class: "adm-flag" + (on ? " is-on" : "") }, on ? yes : no);
  }

  function showBars() {
    var list = h("ul", { class: "adm-list", "aria-label": "Bars" });
    var status = h("p", { class: "small muted", role: "status", text: "Loading" });
    shell(
      "bars",
      h(
        "div",
        null,
        h(
          "div",
          { class: "adm-head" },
          h("h1", { class: "head__title", text: "Bars" }),
          h("button", { class: "btn btn--primary", type: "button", onclick: function () { showBarForm(null); } }, ui.icon("plus"), "Add bar")
        ),
        status,
        list
      )
    );
    loadBars()
      .then(function () {
        status.textContent = "";
        if (!bars.length) status.textContent = "No bars yet. Add the first one.";
        bars.forEach(function (b) {
          list.appendChild(
            h(
              "li",
              { class: "adm-row" },
              h(
                "div",
                { class: "adm-row__main" },
                h("p", { class: "adm-row__name", text: b.name }),
                h("p", { class: "small muted", text: b.slug })
              ),
              h(
                "div",
                { class: "adm-row__meta" },
                h("span", { class: "small", text: "Capacity " + b.capacity }),
                flag(b.is_active, "Active", "Inactive"),
                flag(b.counts_exits, "Counts exits", "Entries only")
              ),
              h(
                "button",
                {
                  class: "btn btn--outline adm-row__go",
                  type: "button",
                  "aria-label": "Manage " + b.name,
                  onclick: function () {
                    showBar(b.id);
                  }
                },
                "Manage"
              )
            )
          );
        });
      })
      .catch(function (e) {
        status.textContent = plainError(e);
      });
  }

  // ---------- add or edit bar ----------

  function showBarForm(bar) {
    var editing = !!bar;
    var name = textInput({ maxlength: 120 });
    var slug = textInput({ maxlength: 64, placeholder: "fake-the-tipsy-owl" });
    var address = textInput({ maxlength: 200 });
    var lat = textInput({ inputmode: "decimal", placeholder: "40.0000" });
    var lng = textInput({ inputmode: "decimal", placeholder: "-75.0000" });
    var cap = textInput({ inputmode: "numeric", placeholder: "250" });
    var tz = textInput({ list: "tz-list", maxlength: 64 });
    var tzList = h("datalist", { id: "tz-list" }, TIMEZONES.map(function (z) { return h("option", { value: z }); }));
    var active = checkbox("bar-active", "Active", "Inactive bars are hidden from students.", bar ? bar.is_active : true);
    var exits = checkbox("bar-exits", "Count exits too", "Off means the door counts entries only.", bar ? bar.counts_exits : true);

    var fName = field("bar-name", "Name", name);
    var fSlug = field("bar-slug", "Slug", slug, "Lowercase letters, numbers and hyphens. It cannot change later.");
    var fAddr = field("bar-address", "Address", address);
    var fLat = field("bar-lat", "Latitude", lat, "Right click the bar in Google Maps to copy coordinates.");
    var fLng = field("bar-lng", "Longitude", lng);
    var fCap = field("bar-capacity", "Capacity", cap, "The posted occupancy.");
    var fTz = field("bar-tz", "Timezone", tz, "Used for tonight and the hour charts.");

    var slugTouched = false;
    if (bar) {
      name.value = bar.name;
      address.value = bar.address;
      cap.value = String(bar.capacity);
    } else {
      tz.value = "America/New_York";
      name.addEventListener("input", function () {
        if (slugTouched) return;
        slug.value = name.value
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 64);
      });
      slug.addEventListener("input", function () {
        slugTouched = true;
      });
    }

    var formErr = h("p", { class: "small form-error", role: "alert" });
    var save = h("button", { class: "btn btn--primary btn--lg", type: "submit" }, editing ? "Save changes" : "Add bar");

    function clearErrors() {
      [fName, fSlug, fAddr, fLat, fLng, fCap, fTz].forEach(function (f) {
        f.err.textContent = "";
        f.input.removeAttribute("aria-invalid");
      });
      formErr.textContent = "";
    }
    function bad(f, msg) {
      f.err.textContent = msg;
      f.input.setAttribute("aria-invalid", "true");
      return false;
    }
    function num(str) {
      return str.trim() === "" || isNaN(Number(str)) ? null : Number(str);
    }

    // Returns the request body or null after showing what is wrong.
    function validate() {
      clearErrors();
      var ok = true;
      var nm = name.value.trim();
      if (!nm) ok = bad(fName, "Enter the bar name.");
      else if (nm.length > 120) ok = bad(fName, "Use 120 characters or fewer.");
      if (address.value.length > 200) ok = bad(fAddr, "Use 200 characters or fewer.");
      var cp = num(cap.value);
      if (cp === null || Math.floor(cp) !== cp || cp < 1 || cp > 10000) ok = bad(fCap, "Enter a whole number from 1 to 10000.");
      var body = { name: nm, address: address.value.trim(), capacity: cp };
      if (!editing) {
        if (!/^[a-z0-9-]{2,64}$/.test(slug.value)) ok = bad(fSlug, "Use 2 to 64 lowercase letters, numbers and hyphens.");
        var la = num(lat.value);
        var lo = num(lng.value);
        if (la === null || la < -90 || la > 90) ok = bad(fLat, "Enter a number from -90 to 90.");
        if (lo === null || lo < -180 || lo > 180) ok = bad(fLng, "Enter a number from -180 to 180.");
        if (!tz.value.trim()) ok = bad(fTz, "Enter a timezone such as America/New_York.");
        body.slug = slug.value;
        body.latitude = la;
        body.longitude = lo;
        body.timezone = tz.value.trim();
      }
      if (!ok) {
        formErr.textContent = "Fix the highlighted fields and try again.";
        var first = root.querySelector("[aria-invalid='true']");
        if (first) first.focus();
        return null;
      }
      return body;
    }

    var form = h(
      "form",
      {
        class: "adm-form",
        novalidate: true,
        onsubmit: function (e) {
          e.preventDefault();
          var body = validate();
          if (!body) return;
          save.disabled = true;
          save.textContent = "Saving";
          var wantActive = active.input.checked;
          var wantExits = exits.input.checked;
          var req;
          if (editing) {
            body.is_active = wantActive;
            body.counts_exits = wantExits;
            delete body.slug;
            req = api.adminUpdateBar(bar.id, body);
          } else {
            req = api.adminCreateBar(body).then(function (created) {
              // Create has no active or exits fields. Both start on. Switch off what was unticked.
              var extra = {};
              if (!wantActive) extra.is_active = false;
              if (!wantExits) extra.counts_exits = false;
              if (!Object.keys(extra).length) return created;
              return api.adminUpdateBar(created.id, extra);
            });
          }
          req
            .then(function (saved) {
              ui.toast(editing ? "Saved" : "Bar added");
              showBar(saved.id);
            })
            .catch(function (e2) {
              save.disabled = false;
              save.textContent = editing ? "Save changes" : "Add bar";
              if (e2.status === 409 || e2.detail === "slug_taken") {
                bad(fSlug, plainError(e2));
                slug.focus();
              }
              formErr.textContent = plainError(e2);
            });
        }
      },
      fName.el,
      editing ? null : fSlug.el,
      fAddr.el,
      editing ? null : h("div", { class: "adm-two" }, fLat.el, fLng.el),
      fCap.el,
      editing ? null : fTz.el,
      editing ? null : tzList,
      active.el,
      exits.el,
      formErr,
      h("div", { class: "adm-actions" }, save, h("button", { class: "btn btn--secondary", type: "button", onclick: function () { editing ? showBar(bar.id) : showBars(); } }, "Cancel"))
    );

    var facts = editing
      ? h(
          "dl",
          { class: "adm-facts" },
          h("div", null, h("dt", { text: "Slug" }), h("dd", { text: bar.slug })),
          h("div", null, h("dt", { text: "Location" }), h("dd", { text: bar.latitude + ", " + bar.longitude })),
          h("div", null, h("dt", { text: "Timezone" }), h("dd", { text: bar.timezone }))
        )
      : null;

    shell(
      "bars",
      h(
        "div",
        { class: "adm-narrow" },
        backButton(editing ? "Back to bar" : "Back to bars", function () {
          editing ? showBar(bar.id) : showBars();
        }),
        h("h1", { class: "head__title", text: editing ? "Edit bar" : "Add bar" }),
        facts,
        facts ? h("p", { class: "small muted adm-note", text: "Slug, location and timezone cannot be changed here." }) : null,
        form
      )
    );
    name.focus();
  }

  // ---------- one bar ----------

  function showBar(barId) {
    var host = h("div", null, h("p", { class: "small muted", role: "status", text: "Loading" }));
    shell("bars", host);
    var found = null;
    loadBars()
      .then(function () {
        for (var i = 0; i < bars.length; i++) if (bars[i].id === barId) found = bars[i];
        if (!found) throw { status: 404, detail: "not_found" };
        ui.clear(host);
        host.appendChild(barPage(found));
      })
      .catch(function (e) {
        ui.clear(host);
        host.appendChild(h("p", { class: "small form-error", role: "alert", text: plainError(e) }));
        host.appendChild(backButton("Back to bars", showBars));
      });
  }

  function barPage(bar) {
    return h(
      "div",
      { class: "adm-narrow" },
      backButton("Back to bars", showBars),
      h(
        "div",
        { class: "adm-head" },
        h("div", null, h("h1", { class: "head__title", text: bar.name }), h("p", { class: "head__sub", text: bar.slug + " · Capacity " + bar.capacity })),
        h("button", { class: "btn btn--outline", type: "button", onclick: function () { showBarForm(bar); } }, "Edit bar")
      ),
      h("div", { class: "adm-meta" }, flag(bar.is_active, "Active", "Inactive"), flag(bar.counts_exits, "Counts exits", "Entries only")),
      priceSection(bar),
      inviteSection(bar),
      staffSection(bar)
    );
  }

  // ---------- pass price ----------

  function priceSection(bar) {
    var s = section("price-title", "Pass price", "Set by hand. Students see it on the bar page.");
    var input = h("input", { class: "input adm-input adm-price", type: "text", inputmode: "decimal", autocomplete: "off", placeholder: "15" });
    var f = field("price", "Price in dollars", input, "For example 15 or 12.50.");
    var current = h("p", { class: "small", role: "status" });
    var save = h("button", { class: "btn btn--primary", type: "submit" }, "Save price");
    var none = h("button", { class: "btn btn--outline", type: "button" }, "No pass sold");

    function paintCurrent() {
      var p = priceById[bar.id];
      if (!bar.is_active) current.textContent = "Current price: not shown, this bar is inactive.";
      else if (p === undefined) current.textContent = "";
      else current.textContent = p === null ? "Current price: no pass sold." : "Current price: " + ui.fmtPrice(p) + ".";
      if (p !== undefined && p !== null && !input.value) input.value = String(p / 100);
    }
    paintCurrent();

    function send(cents) {
      save.disabled = true;
      none.disabled = true;
      f.err.textContent = "";
      api
        .adminSetPassPrice(bar.id, cents)
        .then(function () {
          priceById[bar.id] = cents;
          if (cents === null) input.value = "";
          paintCurrent();
          current.textContent = cents === null ? "Saved. No pass sold." : "Saved. Students now see " + ui.fmtPrice(cents) + ".";
        })
        .catch(function (e) {
          f.err.textContent = plainError(e);
        })
        .then(function () {
          save.disabled = false;
          none.disabled = false;
        });
    }

    none.addEventListener("click", function () {
      send(null);
    });
    s.body.appendChild(
      h(
        "form",
        {
          class: "adm-form",
          novalidate: true,
          onsubmit: function (e) {
            e.preventDefault();
            var v = input.value.trim().replace(/^\$/, "");
            if (!/^\d{1,4}(\.\d{1,2})?$/.test(v) || Number(v) > 1000) {
              f.err.textContent = "Enter dollars from 0 to 1000, such as 15 or 12.50.";
              input.setAttribute("aria-invalid", "true");
              return;
            }
            input.removeAttribute("aria-invalid");
            send(Math.round(Number(v) * 100));
          }
        },
        f.el,
        h("div", { class: "adm-actions" }, save, none),
        current
      )
    );
    return s.el;
  }

  // ---------- invites ----------

  function inviteSection(bar) {
    var s = section("invites-title", "Staff invites");
    var made = h("div", { class: "adm-invites" });
    var err = h("p", { class: "small form-error", role: "alert" });
    var btns = [];

    function create(level) {
      err.textContent = "";
      btns.forEach(function (b) {
        b.disabled = true;
      });
      api
        .adminCreateInvite(bar.id, level)
        .then(function (inv) {
          made.insertBefore(invitePanel(inv), made.firstChild);
        })
        .catch(function (e) {
          err.textContent = plainError(e);
        })
        .then(function () {
          btns.forEach(function (b) {
            b.disabled = false;
          });
        });
    }
    var door = h("button", { class: "btn btn--primary", type: "button", onclick: function () { create("door"); } }, "Create door staff invite");
    var mgr = h("button", { class: "btn btn--outline", type: "button", onclick: function () { create("manager"); } }, "Create manager invite");
    btns = [door, mgr];
    s.body.appendChild(h("div", { class: "adm-actions" }, door, mgr));
    s.body.appendChild(err);
    s.body.appendChild(made);
    return s.el;
  }

  function copyText(text) {
    function fallback() {
      ui.toast("Select the code and copy it");
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(
          function () {
            ui.toast("Copied");
          },
          fallback
        );
        return;
      }
    } catch (e) {
      /* fall through */
    }
    fallback();
  }

  function invitePanel(inv) {
    var title = levelLabel(inv.level) + " invite";
    var codeEl = h("p", { class: "adm-code", "aria-label": "Invite code", text: inv.code });
    var note = h("p", { class: "small", text: "Share this code with the person. It works once and expires in 3 days." });
    var state = h("p", { class: "small adm-invite__state", role: "status" });
    var revoke = h("button", { class: "btn btn--danger", type: "button" }, "Revoke invite");
    var copy = h("button", { class: "btn btn--secondary", type: "button", onclick: function () { copyText(inv.code); } }, "Copy code");
    var panel = h(
      "section",
      { class: "adm-invite", "aria-label": title },
      h("p", { class: "staff__role", text: title }),
      codeEl,
      h("p", { class: "small muted", text: "Expires " + fmtWhen(inv.expires_at) }),
      note,
      h("div", { class: "adm-actions" }, copy, revoke),
      state
    );
    revoke.addEventListener("click", function () {
      revoke.disabled = true;
      api
        .adminRevokeInvite(inv.id)
        .then(function () {
          codeEl.classList.add("is-dead");
          copy.disabled = true;
          revoke.remove();
          note.textContent = "";
          state.textContent = "Invite revoked. The code no longer works.";
        })
        .catch(function (e) {
          revoke.disabled = false;
          state.textContent = plainError(e);
        });
    });
    return panel;
  }

  // ---------- staff list ----------

  function staffSection(bar) {
    var s = section("staff-title", "Staff");
    var list = h("ul", { class: "adm-list", "aria-label": "Staff" });
    var status = h("p", { class: "small muted", role: "status", text: "Loading" });
    s.body.appendChild(status);
    s.body.appendChild(list);

    function load() {
      api
        .adminStaff(bar.id)
        .then(function (rows) {
          ui.clear(list);
          status.textContent = rows.length ? "" : "No staff yet.";
          rows.forEach(function (m) {
            list.appendChild(staffRow(m));
          });
        })
        .catch(function (e) {
          status.textContent = plainError(e);
        });
    }

    function staffRow(m) {
      var who = levelLabel(m.level) + (m.phone_hint ? ", " + m.phone_hint : "");
      var actions = h("div", { class: "adm-row__meta" });
      var rowErr = h("p", { class: "small form-error", role: "alert" });
      function ask() {
        ui.clear(actions);
        actions.appendChild(h("span", { class: "small adm-confirm", text: "Remove this person?" }));
        actions.appendChild(
          h(
            "button",
            {
              class: "btn btn--primary",
              type: "button",
              onclick: function (e) {
                e.currentTarget.disabled = true;
                api
                  .adminRemoveStaff(bar.id, m.user_id)
                  .then(function () {
                    ui.toast("Removed");
                    load();
                  })
                  .catch(function (er) {
                    rowErr.textContent = plainError(er);
                    idle();
                  });
              }
            },
            "Yes, remove"
          )
        );
        actions.appendChild(h("button", { class: "btn btn--secondary", type: "button", onclick: idle }, "Cancel"));
      }
      function idle() {
        ui.clear(actions);
        actions.appendChild(h("button", { class: "btn btn--outline", type: "button", "aria-label": "Remove " + who, onclick: ask }, "Remove"));
      }
      idle();
      return h(
        "li",
        { class: "adm-row" },
        h("div", { class: "adm-row__main" }, h("p", { class: "adm-row__name", text: levelLabel(m.level) }), h("p", { class: "small muted", text: (m.phone_hint || "No phone hint") + " · Since " + fmtDay(m.created_at) })),
        actions,
        rowErr
      );
    }
    load();
    return s.el;
  }

  // ---------- accuracy ----------

  function showAccuracy() {
    var body = h("div", null, h("p", { class: "small muted", role: "status", text: "Loading" }));
    shell(
      "accuracy",
      h(
        "div",
        null,
        h("h1", { class: "head__title adm-title", text: "Accuracy" }),
        h("p", { class: "small adm-explain", text: "Average error is how many minutes our estimate missed the timed wait by. Bias above 0 means we guessed too long. Based on the last 30 days of timed lines." }),
        body
      )
    );
    api
      .adminAccuracy()
      .then(function (rows) {
        ui.clear(body);
        if (!rows.length) {
          body.appendChild(h("p", { class: "small muted", text: "No bars yet." }));
          return;
        }
        body.appendChild(
          h(
            "div",
            { class: "adm-tablewrap" },
            h(
              "table",
              { class: "adm-table" },
              h("caption", { class: "sr-only", text: "Estimate accuracy by bar" }),
              h("thead", null, h("tr", null, ["Bar", "Samples", "Average error", "Bias"].map(function (t, i) { return h("th", { scope: "col", class: i ? "num-col" : null, text: t }); }))),
              h(
                "tbody",
                null,
                rows.map(function (r) {
                  var has = r.samples > 0 && r.mean_abs_error_min !== null;
                  var bias = r.mean_bias_min;
                  var biasText = !has || bias === null ? "No data" : (bias > 0 ? "+" : "") + bias.toFixed(1) + " min" + (bias > 0.05 ? " (too long)" : bias < -0.05 ? " (too short)" : "");
                  return h(
                    "tr",
                    null,
                    h("th", { scope: "row", text: r.bar_name }),
                    h("td", { class: "num-col", text: String(r.samples) }),
                    h("td", { class: "num-col", text: has ? r.mean_abs_error_min.toFixed(1) + " min" : "No data" }),
                    h("td", { class: "num-col", text: biasText })
                  );
                })
              )
            )
          )
        );
      })
      .catch(function (e) {
        ui.clear(body);
        body.appendChild(h("p", { class: "small form-error", role: "alert", text: plainError(e) }));
      });
  }

  // ---------- audit log ----------

  function detailText(d) {
    if (!d) return "";
    return Object.keys(d)
      .map(function (k) {
        var v = d[k];
        if (k === "price_cents") return "price " + (v === null ? "none" : ui.fmtPrice(v));
        return k.replace(/_/g, " ") + " " + (typeof v === "object" ? JSON.stringify(v) : String(v));
      })
      .join(", ");
  }

  function showAudit() {
    var list = h("ol", { class: "adm-list", "aria-label": "Audit log" });
    var status = h("p", { class: "small muted", role: "status", text: "Loading" });
    shell(
      "audit",
      h("div", null, h("h1", { class: "head__title adm-title", text: "Audit log" }), h("p", { class: "small adm-explain", text: "The last 100 admin and staff actions, newest first." }), status, list)
    );
    Promise.all([api.adminAudit(), bars.length ? Promise.resolve(bars) : api.adminBars().then(function (b) { bars = b; return b; })])
      .then(function (out) {
        var rows = out[0];
        status.textContent = rows.length ? "" : "Nothing yet.";
        rows.forEach(function (r) {
          var where = r.bar_id ? barName(r.bar_id) : null;
          var detail = detailText(r.details);
          list.appendChild(
            h(
              "li",
              { class: "adm-row adm-row--audit" },
              h(
                "div",
                { class: "adm-row__main" },
                h("p", { class: "adm-row__name", text: ACTION_LABEL[r.action] || r.action }),
                h("p", { class: "small muted", text: [where, detail, r.actor_role].filter(Boolean).join(" · ") })
              ),
              h("p", { class: "small muted adm-when", text: fmtWhen(r.ts) })
            )
          );
        });
      })
      .catch(function (e) {
        status.textContent = plainError(e);
      });
  }

  // ---------- boot ----------

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
