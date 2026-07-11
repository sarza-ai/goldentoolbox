/* Golden Toolbox — admin Business Checkup trigger.
   Password (admin secret) is kept in localStorage on this device only and
   sent as the x-admin-secret header — never placed in the URL. */
(function () {
  var STORAGE_KEY = 'gt_admin_secret';

  var gateForm = document.getElementById('gate-form');
  var gateNote = document.getElementById('gate-note');
  var secretInput = document.getElementById('secret');
  var lockBtn = document.getElementById('lock-btn');

  var adminForm = document.getElementById('admin-form');
  var submitBtn = document.getElementById('a-submit');
  var noteEl = document.getElementById('a-note');

  var resultBox = document.getElementById('a-result');
  var resultTag = document.getElementById('a-result-tag');
  var resultTitle = document.getElementById('a-result-title');
  var resultSub = document.getElementById('a-result-sub');
  var resultLink = document.getElementById('a-result-link');
  var resultCopy = document.getElementById('a-result-copy');
  var resultAgain = document.getElementById('a-result-again');

  var yelpListed = document.getElementById('a-yelp-listed');
  var yelpFields = document.getElementById('a-yelp-fields');

  function getSecret() { return localStorage.getItem(STORAGE_KEY) || ''; }
  function setSecret(s) { localStorage.setItem(STORAGE_KEY, s); }
  function clearSecret() { localStorage.removeItem(STORAGE_KEY); }

  function showTool() {
    gateForm.hidden = true;
    adminForm.hidden = false;
    resultBox.hidden = true;
    lockBtn.hidden = false;
  }
  function showGate() {
    gateForm.hidden = false;
    adminForm.hidden = true;
    resultBox.hidden = true;
    lockBtn.hidden = true;
    secretInput.value = '';
  }

  // A quick unauthenticated ping doesn't exist, so we just trust a stored
  // secret until the API tells us otherwise (401 -> bounce back to the gate).
  if (getSecret()) showTool(); else showGate();

  gateForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = secretInput.value.trim();
    if (!v) return;
    setSecret(v);
    showTool();
  });

  lockBtn.addEventListener('click', function () {
    clearSecret();
    showGate();
  });

  yelpListed.addEventListener('change', function () {
    yelpFields.hidden = !yelpListed.checked;
  });

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  adminForm.addEventListener('submit', function (ev) {
    ev.preventDefault();

    var business = document.getElementById('a-business').value.trim();
    var website = document.getElementById('a-website').value.trim();
    var phone = document.getElementById('a-phone').value.trim();
    var email = document.getElementById('a-email').value.trim();
    var fresh = document.getElementById('a-fresh').checked;

    if (!business || !website) return;

    var body = { business: business, website: website, phone: phone, email: email };
    if (yelpListed.checked) {
      body.yelp = {
        listed: true,
        nameMatch: document.getElementById('a-yelp-name').checked,
        phoneMatch: document.getElementById('a-yelp-phone').checked,
        addrMatch: document.getElementById('a-yelp-addr').checked,
      };
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Generating…';
    noteEl.textContent = 'This can take 15–30 seconds while we pull live data.';

    var url = '/api/admin-generate' + (fresh ? '?fresh=1' : '');
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-secret': getSecret() },
      body: JSON.stringify(body),
    }).then(function (r) {
      return r.json().then(function (d) { return { ok: r.ok, status: r.status, d: d }; });
    }).then(function (res) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate report';

      if (res.status === 401) {
        clearSecret();
        showGate();
        gateNote.textContent = 'Wrong password. Try again.';
        gateNote.className = 'form-note err';
        return;
      }
      if (!res.ok) {
        noteEl.textContent = res.d.message || 'Something went wrong. Please try again.';
        noteEl.className = 'form-note err';
        return;
      }

      noteEl.textContent = 'Skips the public form, rate limits, and lead-notify email.';
      noteEl.className = 'form-note';

      resultTag.textContent = res.d.cached ? 'Already on file' : 'Freshly generated';
      resultTitle.textContent = business;
      resultSub.textContent = res.d.cached
        ? 'A report for this business is already cached (within 30 days). Check "force a fresh report" to rebuild it.'
        : 'Built just now with live data where available.';
      resultLink.href = res.d.url;
      resultLink.textContent = 'Open report';

      adminForm.hidden = true;
      resultBox.hidden = false;
    }).catch(function () {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Generate report';
      noteEl.textContent = 'Network hiccup. Please try again.';
      noteEl.className = 'form-note err';
    });
  });

  resultCopy.addEventListener('click', function () {
    navigator.clipboard && navigator.clipboard.writeText(resultLink.href);
    resultCopy.textContent = 'Copied';
    setTimeout(function () { resultCopy.textContent = 'Copy link'; }, 1600);
  });

  resultAgain.addEventListener('click', function () {
    adminForm.reset();
    yelpFields.hidden = true;
    resultBox.hidden = true;
    adminForm.hidden = false;
  });
})();
