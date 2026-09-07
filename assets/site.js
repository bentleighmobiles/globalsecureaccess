/* Shared site behavior: mobile nav + reveal-on-scroll */
(function () {
  var btn = document.getElementById('menuBtn');
  var nav = document.getElementById('navLinks');
  if (btn && nav) {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function () {
      var open = nav.classList.toggle('open');
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    nav.querySelectorAll('a').forEach(function (a) {
      a.addEventListener('click', function () {
        nav.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('visible'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('visible'); });
  }

  /* Cookieless, privacy-respecting analytics beacon.
     No cookies, no personal data, no IP or user-agent stored.
     Set PB_ANALYTICS_URL to your deployed analytics.gs /exec URL to enable. */
  var PB_ANALYTICS_URL = "";
  function pbTrack(event, meta) {
    if (!PB_ANALYTICS_URL) return;
    try {
      if (navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true) return;
      var payload = { event: event, path: location.pathname, ref: document.referrer ? new URL(document.referrer).hostname : "", ts: new Date().toISOString() };
      if (meta) { for (var k in meta) { if (Object.prototype.hasOwnProperty.call(meta, k)) payload[k] = meta[k]; } }
      var body = JSON.stringify(payload);
      if (navigator.sendBeacon) { navigator.sendBeacon(PB_ANALYTICS_URL, body); }
      else { fetch(PB_ANALYTICS_URL, { method: "POST", headers: { "Content-Type": "text/plain;charset=UTF-8" }, body: body, keepalive: true }).catch(function () {}); }
    } catch (e) {}
  }
  window.pbTrack = pbTrack;
  pbTrack("page_view");
})();
