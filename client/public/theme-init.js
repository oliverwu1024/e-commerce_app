// Runs before React hydrates — reads the saved theme and applies the class
// synchronously so there's no flash of the wrong palette. Lives in /public
// so we can drop `unsafe-inline` from the script-src CSP.
(function () {
  try {
    var t = localStorage.getItem('theme');
    if (t === 'dark') {
      document.documentElement.classList.add('dark');
    }
  } catch (e) {}
})();
