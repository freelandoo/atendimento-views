/**
 * Menu principal colapsável em telas estreitas + aria-expanded.
 */
(function () {
  document.querySelectorAll('.dash-nav-toggle.only-mobile').forEach(function (btn) {
    var id = btn.getAttribute('aria-controls');
    var panel = id && document.getElementById(id);
    if (!panel) return;

    btn.addEventListener('click', function () {
      var open = panel.classList.toggle('is-open');
      btn.setAttribute('aria-expanded', open ?'true' : 'false');
    });

    window.addEventListener(
      'resize',
      function () {
        if (window.matchMedia('(min-width: 721px)').matches) {
          panel.classList.remove('is-open');
          btn.setAttribute('aria-expanded', 'false');
        }
      },
      { passive: true }
    );
  });
})();
