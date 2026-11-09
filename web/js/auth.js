/* Shared sign in flow: 21+ attestation, phone, 6 digit code. Used by the student app and
   the staff counter. */
(function () {
  "use strict";
  var C = (window.Crowded = window.Crowded || {});
  var ui = C.ui;
  var h = ui.h;

  function normalizePhone(raw) {
    var s = String(raw || "").trim();
    var digits = s.replace(/\D/g, "");
    if (s.charAt(0) === "+") return "+" + digits;
    if (digits.length === 10) return "+1" + digits;
    if (digits.length === 11 && digits.charAt(0) === "1") return "+" + digits;
    return "+" + digits;
  }

  function maskPhone(e164) {
    var d = e164.replace(/\D/g, "");
    return "•••• " + d.slice(-4);
  }

  // opts: {title, pitch, kicker, onDone(me)}
  function mount(container, opts) {
    var phone = "";
    var attested = false;

    function phoneStep() {
      ui.clear(container);
      var check = h("input", { type: "checkbox", id: "age", "aria-describedby": "age-help" });
      var input = h("input", {
        class: "input",
        id: "phone",
        type: "tel",
        inputmode: "tel",
        autocomplete: "tel",
        placeholder: "(555) 123 4567",
        "aria-label": "Phone number"
      });
      input.value = phone;
      check.checked = attested;
      var btn = h("button", { class: "btn btn--primary btn--block btn--lg", type: "submit", disabled: true }, "Continue");
      var err = h("p", { class: "small", role: "alert", id: "phone-err" });
      err.style.setProperty("color", "var(--alert)");

      function sync() {
        attested = check.checked;
        var digits = input.value.replace(/\D/g, "");
        btn.disabled = !(attested && digits.length >= 10);
      }
      check.addEventListener("change", sync);
      input.addEventListener("input", sync);

      var form = h(
        "form",
        {
          novalidate: true,
          onsubmit: function (e) {
            e.preventDefault();
            sync();
            if (btn.disabled) return;
            phone = normalizePhone(input.value);
            btn.disabled = true;
            btn.textContent = "Sending";
            err.textContent = "";
            C.api
              .requestCode(phone)
              .then(function (r) {
                codeStep(r && r.dev_code);
              })
              .catch(function (e2) {
                err.textContent = e2.detail || "Could not send a code";
                btn.textContent = "Continue";
                sync();
              });
          }
        },
        h(
          "label",
          { class: "check", for: "age" },
          check,
          h("span", { class: "check__text" }, h("strong", { text: "I'm 21 or older" }), h("span", { class: "small muted", id: "age-help", text: "Crowded is for bars. We only save that you confirmed, never your birthday." }))
        ),
        h("div", { class: "field" }, h("label", { class: "field__label", for: "phone", text: "Phone number" }), input),
        err,
        btn,
        h("p", { class: "welcome__fine", text: "We text you a 6 digit code. Message rates may apply." })
      );

      var wrap = h(
        "div",
        { class: "welcome" },
        h("div", { class: "brand" }, h("span", { class: "brand__mark" }, ui.icon("mark")), "Crowded", opts.kicker ? h("span", { class: "fake-tag", text: opts.kicker }) : null),
        h(
          "div",
          { class: "welcome__hero" },
          h("h1", { class: "welcome__title", text: opts.title || "Know the line before you go." }),
          h("p", { class: "welcome__pitch", text: opts.pitch || "Live waits and crowd levels at bars downtown." })
        ),
        form
      );
      container.appendChild(wrap);
    }

    function codeStep(devCode) {
      ui.clear(container);
      var input = h("input", {
        class: "input input--code",
        id: "code",
        type: "text",
        inputmode: "numeric",
        autocomplete: "one-time-code",
        maxlength: 6,
        pattern: "[0-9]*",
        "aria-label": "6 digit code"
      });
      var btn = h("button", { class: "btn btn--primary btn--block btn--lg", type: "submit", disabled: true }, "Verify");
      var err = h("p", { class: "small", role: "alert" });
      err.style.setProperty("color", "var(--alert)");
      var busy = false;

      function sync() {
        input.value = input.value.replace(/\D/g, "").slice(0, 6);
        btn.disabled = busy || input.value.length !== 6;
      }

      function submit() {
        sync();
        if (btn.disabled) return;
        busy = true;
        btn.disabled = true;
        btn.textContent = "Checking";
        err.textContent = "";
        C.api
          .verifyCode(phone, input.value, attested)
          .then(function (me) {
            opts.onDone(me);
          })
          .catch(function (e) {
            busy = false;
            btn.textContent = "Verify";
            if (e.status === 403 && e.detail === "age_gate") {
              err.textContent = "You need to confirm you're 21 or older.";
            } else if (e.status !== 429) {
              err.textContent = e.detail || "That code did not work";
            }
            input.select();
            sync();
          });
      }

      input.addEventListener("input", function () {
        sync();
        if (input.value.length === 6) submit();
      });

      var hint = devCode
        ? h(
            "div",
            { class: "hint" },
            h("span", null, "Dev code: ", h("strong", { text: devCode })),
            h(
              "button",
              {
                type: "button",
                class: "link-btn",
                onclick: function () {
                  input.value = devCode;
                  sync();
                  submit();
                }
              },
              "Use it"
            )
          )
        : null;

      var wrap = h(
        "div",
        { class: "welcome" },
        h(
          "div",
          { class: "topbar" },
          h("button", { class: "icon-btn", type: "button", "aria-label": "Back", onclick: phoneStep }, ui.icon("back"))
        ),
        h(
          "div",
          { class: "welcome__hero" },
          h("h1", { class: "welcome__title", text: "Enter the code" }),
          h("p", { class: "welcome__pitch", text: "Sent to " + maskPhone(phone) })
        ),
        h(
          "form",
          {
            novalidate: true,
            onsubmit: function (e) {
              e.preventDefault();
              submit();
            }
          },
          h("div", { class: "field" }, input),
          hint,
          err,
          btn,
          h(
            "p",
            { class: "welcome__fine" },
            h(
              "button",
              {
                type: "button",
                class: "link-btn",
                onclick: function () {
                  C.api.requestCode(phone).then(function (r) {
                    ui.toast("New code sent");
                    codeStep(r && r.dev_code);
                  }).catch(function (e) {
                    if (e.status !== 429) ui.toast(e.detail || "Could not send a code");
                  });
                }
              },
              "Send a new code"
            )
          )
        )
      );
      container.appendChild(wrap);
      setTimeout(function () {
        input.focus();
      }, 50);
    }

    phoneStep();
  }

  C.auth = { mount: mount, normalizePhone: normalizePhone };
})();
