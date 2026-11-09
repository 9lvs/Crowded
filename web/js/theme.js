/* Applies the saved theme before first paint. Loaded in <head>. */
(function () {
  "use strict";
  var theme = null;
  try {
    theme = window.localStorage.getItem("crowded.theme");
  } catch (e) {
    theme = null;
  }
  if (theme === "light" || theme === "dark") {
    document.documentElement.setAttribute("data-theme", theme);
  }
})();
