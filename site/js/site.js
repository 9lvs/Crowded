/* Crowded site. Only the waitlist preview lives here.
   PREVIEW: the form does not send or store anything. Wire it to a real waitlist service
   (with a privacy notice and double opt in) before launch. */
(function () {
  "use strict";
  var form = document.getElementById("waitlist");
  var done = document.getElementById("waitlist-done");
  if (!form || !done) return;
  var input = form.querySelector("input[type=email]");

  form.addEventListener("submit", function (event) {
    event.preventDefault();
    if (!input.checkValidity() || !input.value.trim()) {
      input.setAttribute("aria-invalid", "true");
      input.focus();
      return;
    }
    input.removeAttribute("aria-invalid");
    form.reset();
    form.hidden = true;
    done.hidden = false;
  });
})();
