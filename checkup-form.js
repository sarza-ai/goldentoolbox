/* Golden Toolbox — Business Checkup funnel:
   form -> (confirm business) -> generate -> redirect to report. */
(function () {
  var form = document.getElementById('checkup-form');
  var note = document.getElementById('form-note');
  var ctaBtn = document.getElementById('cta-btn');
  var confirmStep = document.getElementById('confirm-step');
  var candidateList = document.getElementById('candidate-list');
  var confirmBtn = document.getElementById('confirm-btn');
  var confirmBack = document.getElementById('confirm-back');
  var overlay = document.getElementById('load-overlay');
  var loadStep = document.getElementById('load-step');
  if (!form) return;

  var LOAD_STEPS = [
    'Looking up your business', 'Fetching your website', 'Scanning your tech stack',
    'Reading your Google reviews', 'Checking directories', 'Measuring page speed',
    'Sizing up local competitors', 'Scoring everything',
  ];
  var stepTimer = null, stepIx = 0;
  function showOverlay() {
    overlay.hidden = false;
    stepIx = 0;
    loadStep.textContent = LOAD_STEPS[0];
    stepTimer = setInterval(function () {
      stepIx = (stepIx + 1) % LOAD_STEPS.length;
      loadStep.textContent = LOAD_STEPS[stepIx];
    }, 1400);
  }
  function hideOverlay() { overlay.hidden = true; if (stepTimer) clearInterval(stepTimer); }

  function setErr(msg) { note.textContent = msg; note.className = 'form-note err'; }
  function clearErr() { note.textContent = 'We use your website and business name to look you up. We never share your info.'; note.className = 'form-note'; }

  function normalizeDomain(url) {
    return String(url || '').trim().toLowerCase()
      .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].split('?')[0].split('#')[0];
  }

  function getForm() {
    return {
      name: document.getElementById('name').value.trim(),
      business: document.getElementById('business').value.trim(),
      email: document.getElementById('email').value.trim(),
      phone: document.getElementById('phone').value.trim(),
      website: document.getElementById('website').value.trim(),
      website_confirm: form.querySelector('[name=website_confirm]').value,
    };
  }

  function validate(f) {
    if (!f.name) return 'Please add your name.';
    if (!f.business) return 'Please add your business name.';
    if (!f.email || f.email.indexOf('@') === -1) return 'Please add a valid email.';
    if (!f.phone) return 'Please add your business phone.';
    if (!f.website || normalizeDomain(f.website).indexOf('.') === -1) return 'Please add your website (e.g. samsconcrete.com).';
    return null;
  }

  function contactFrom(f) {
    return { name: f.name, business: f.business, email: f.email, phone: f.phone, website: f.website };
  }

  function redirectTo(slug) { window.location.href = '/checkup/' + encodeURIComponent(slug); }

  function generate(business, contact) {
    showOverlay();
    return fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ business: business, contact: contact }),
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }).then(function (res) {
      if (res.ok && res.d.slug) { redirectTo(res.d.slug); return; }
      hideOverlay();
      if (res.status === 429) setErr(res.d.message || 'Too many reports for now. Please try again later.');
      else setErr(res.d.message || 'Something went wrong. Please try again.');
    }).catch(function () { hideOverlay(); setErr('Network hiccup. Please try again.'); });
  }

  // ---- Step 1: submit form ----
  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearErr();
    var f = getForm();
    if (f.website_confirm) return; // honeypot tripped: silently stop
    var err = validate(f);
    if (err) { setErr(err); return; }

    ctaBtn.disabled = true;
    ctaBtn.textContent = 'Looking you up…';

    fetch('/api/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(f),
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (res) {
        ctaBtn.disabled = false;
        ctaBtn.textContent = 'Run my free Business Checkup';
        if (!res.ok) { setErr(res.d.message || 'Could not look up your business. Please check your details.'); return; }
        if (res.d.confident) { generate(res.d.business, contactFrom(f)); return; }
        renderCandidates(res.d.candidates || [], f);
      }).catch(function () {
        ctaBtn.disabled = false;
        ctaBtn.textContent = 'Run my free Business Checkup';
        setErr('Network hiccup. Please try again.');
      });
  });

  // ---- Step 2: confirm business ----
  var chosen = null, currentForm = null;
  function renderCandidates(cands, f) {
    currentForm = f;
    chosen = null;
    confirmBtn.disabled = true;
    candidateList.innerHTML = '';

    cands.forEach(function (c, i) {
      var pv = c._preview || {};
      var el = document.createElement('button');
      el.type = 'button';
      el.className = 'candidate';
      el.setAttribute('role', 'radio');
      el.setAttribute('aria-checked', 'false');
      el.innerHTML =
        '<span class="cand-radio" aria-hidden="true"></span>' +
        '<span class="cand-body">' +
          '<span class="cand-name">' + esc(c.name) + '</span>' +
          '<span class="cand-addr">' + esc(c.address || '') + '</span>' +
          (pv.rating ? '<span class="cand-meta">' + esc(pv.rating) + '★ · ' + esc(pv.reviews) + ' reviews</span>' : '') +
        '</span>';
      el.addEventListener('click', function () {
        chosen = c;
        [].forEach.call(candidateList.children, function (n) { n.classList.remove('sel'); n.setAttribute('aria-checked', 'false'); });
        el.classList.add('sel'); el.setAttribute('aria-checked', 'true');
        confirmBtn.disabled = false;
      });
      candidateList.appendChild(el);
    });

    // "none of these" -> use what they typed
    var none = document.createElement('button');
    none.type = 'button';
    none.className = 'candidate candidate-none';
    none.setAttribute('role', 'radio');
    none.innerHTML = '<span class="cand-radio" aria-hidden="true"></span><span class="cand-body"><span class="cand-name">None of these — use what I typed</span><span class="cand-addr">We\'ll build the report from ' + esc(f.business) + '</span></span>';
    none.addEventListener('click', function () {
      chosen = {
        name: f.business, website: f.website, domain: normalizeDomain(f.website),
        phone: f.phone, email: f.email, address: '', city: '', state: '', trade: '', placeId: '',
      };
      [].forEach.call(candidateList.children, function (n) { n.classList.remove('sel'); n.setAttribute('aria-checked', 'false'); });
      none.classList.add('sel'); none.setAttribute('aria-checked', 'true');
      confirmBtn.disabled = false;
    });
    candidateList.appendChild(none);

    form.hidden = true;
    confirmStep.hidden = false;
    confirmStep.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  confirmBtn.addEventListener('click', function () {
    if (!chosen || !currentForm) return;
    generate(chosen, contactFrom(currentForm));
  });
  confirmBack.addEventListener('click', function () {
    confirmStep.hidden = true;
    form.hidden = false;
    clearErr();
  });

  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
})();
