/* Golden Toolbox — reveal on scroll + contact form */
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

  // contact form
  var form = document.getElementById('contact-form');
  var btn = document.getElementById('submit-btn');
  var note = document.getElementById('form-note');
  if (!form) return;

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Sending…';
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    }).then(function (r) {
      if (!r.ok) throw new Error('bad status');
      form.reset();
      btn.textContent = 'Sent. Talk soon.';
      note.textContent = 'Got it. We will take a look and reply within one business day.';
      note.className = 'form-note ok';
    }).catch(function () {
      btn.disabled = false;
      btn.textContent = 'Book my free Toolbox Checkup';
      note.textContent = 'Something went wrong. Email us at hello@sarza.ai and we will get right back to you.';
      note.className = 'form-note err';
    });
  });
})();
