(function () {
  try {
    var m = document.cookie.match(/(?:^|; )apex_theme=(light|dark)(?:;|$)/);
    var t = (m && m[1]) || localStorage.getItem('apex_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
