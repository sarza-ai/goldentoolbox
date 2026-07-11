/* Golden Toolbox — reveal on scroll + interaction polish */
(function () {
  // reveal
  var items = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.15 });
    items.forEach(function (el) { io.observe(el); });
  } else {
    items.forEach(function (el) { el.classList.add('in'); });
  }

  // header lift on scroll
  var header = document.getElementById('site-header');
  if (header) {
    var onScroll = function () {
      header.classList.toggle('scrolled', window.scrollY > 12);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }

  var noMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // scroll parallax: floating tools drift at their own speeds
  var pars = [].slice.call(document.querySelectorAll('[data-par]'));
  if (pars.length && !noMotion && window.matchMedia('(min-width: 861px)').matches) {
    var parTicking = false;
    var updatePar = function () {
      parTicking = false;
      var vh = window.innerHeight;
      pars.forEach(function (el) {
        var r = el.getBoundingClientRect();
        if (r.bottom < -200 || r.top > vh + 200) return;
        var off = (r.top + r.height / 2 - vh / 2) * parseFloat(el.getAttribute('data-par'));
        el.style.setProperty('--py', off.toFixed(1) + 'px');
      });
    };
    window.addEventListener('scroll', function () {
      if (!parTicking) { parTicking = true; requestAnimationFrame(updatePar); }
    }, { passive: true });
    updatePar();
  }

  // 3D tilt: demo devices lean toward the cursor
  if (!noMotion && window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    [].slice.call(document.querySelectorAll('.phone, .browser, .tasklist')).forEach(function (el) {
      el.classList.add('tilt');
      el.addEventListener('mousemove', function (e) {
        var r = el.getBoundingClientRect();
        var x = (e.clientX - r.left) / r.width - 0.5;
        var y = (e.clientY - r.top) / r.height - 0.5;
        el.style.transform = 'perspective(700px) rotateX(' + (-y * 7).toFixed(2) + 'deg) rotateY(' + (x * 7).toFixed(2) + 'deg) scale(1.015)';
      });
      el.addEventListener('mouseleave', function () {
        el.style.transform = '';
      });
    });
  }
})();
