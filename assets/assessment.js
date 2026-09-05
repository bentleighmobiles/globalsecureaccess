/* GSA Impact Assessment — wizard logic, before/after diagram, lead capture.
   Configure the Google Apps Script Web App URL below to enable live Sheet capture. */
var GOOGLE_SCRIPT_URL = ""; // e.g. "https://script.google.com/macros/s/XXXX/exec"

var VENDORS = {
  vpn:       { name: "Legacy VPN",        short: "Legacy VPN",        color: "#94a3b8", guide: null,                 kind: "replace", blurb: "Always-on VPN, Citrix, or legacy remote access" },
  ciscoVPN:  { name: "Cisco VPN",         short: "Cisco VPN",         color: "#049fd9", guide: "cisco-vpn.html",      kind: "vpn",     blurb: "Secure Access VPNaaS / ASA Remote Access" },
  zscaler:   { name: "Zscaler",           short: "Zscaler",           color: "#1664c0", guide: "zscaler.html",        kind: "sse",     blurb: "ZIA / ZPA secure access" },
  umbrella:  { name: "Cisco Umbrella",    short: "Cisco Umbrella",    color: "#049fd9", guide: "cisco-umbrella.html", kind: "sse",     blurb: "DNS-layer security + SWG" },
  ciscoSA:   { name: "Cisco Secure Access", short: "Cisco Secure Access", color: "#049fd9", guide: "cisco-secure-access.html", kind: "sse", blurb: "SSE / ZTA (formerly Cisco+ Secure Connect)" },
  netskope:  { name: "Netskope",          short: "Netskope",          color: "#20b16e", guide: "netskope.html",       kind: "sse",     blurb: "SSE / CASB / ZTNA" },
  prisma:    { name: "Prisma Access",     short: "Prisma Access",     color: "#fa582d", guide: "palo-alto.html",      kind: "sse",     blurb: "Palo Alto SASE / GlobalProtect" },
  greenfield:{ name: "Greenfield",        short: "Greenfield",        color: "#94a3b8", guide: null,                 kind: "none",     blurb: "Starting from a clean slate" }
};

var ENTRAS = [
  { value: "full",    label: "Fully on M365 + Entra ID", meta: "GSA slots straight in" },
  { value: "partial", label: "Some Entra ID", meta: "Hybrid / mid-migration" },
  { value: "none",    label: "Not on Microsoft identity yet", meta: "We'll fold in Entra ID" }
];

var RESOURCES = [
  { value: "web",   label: "On-prem / legacy web apps" },
  { value: "smb",   label: "File shares (SMB)" },
  { value: "rdp",   label: "RDP / SSH / TCP-UDP apps" },
  { value: "api",   label: "Internal APIs / services" },
  { value: "saas",  label: "SaaS apps (M365, CRM, finance…)" }
];

var SCALES = [
  { value: "s",  label: "Under 100" },
  { value: "m",  label: "100 – 1,000" },
  { value: "l",  label: "1,000 – 5,000" },
  { value: "xl", label: "5,000+" }
];

var STEPS = ["Stack", "Entra ID", "Resources", "Scale", "Result"];
var state = { stack: null, entra: null, resources: [], scale: null };
var current = 0;

var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>';

/* ---------- rendering ---------- */
function renderOptions(containerId, items, group, multi) {
  var c = document.getElementById(containerId);
  c.innerHTML = "";
  items.forEach(function (it) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "option";
    b.setAttribute("data-group", group);
    b.setAttribute("data-value", it.value);
    b.innerHTML = '<span class="box">' + CHECK + '</span>' +
      (it.swatch ? '<span class="swatch" style="background:' + it.swatch + '"></span>' : '') +
      '<span>' + it.label + (it.meta ? '<span class="opt-meta">' + it.meta + '</span>' : '') + '</span>';
    b.addEventListener("click", function () { select(group, it.value, multi); });
    c.appendChild(b);
  });
}

function buildOptions() {
  renderOptions("opt-stack", Object.keys(VENDORS).map(function (k) {
    return { value: k, label: VENDORS[k].name, meta: VENDORS[k].blurb, swatch: VENDORS[k].color };
  }), "stack", false);
  renderOptions("opt-entra", ENTRAS, "entra", false);
  renderOptions("opt-resources", RESOURCES, "resources", true);
  renderOptions("opt-scale", SCALES, "scale", false);
}

function select(group, value, multi) {
  if (multi) {
    var i = state[group].indexOf(value);
    if (i >= 0) state[group].splice(i, 1); else state[group].push(value);
  } else {
    state[group] = value;
  }
  document.querySelectorAll('.option[data-group="' + group + '"]').forEach(function (o) {
    var v = o.getAttribute("data-value");
    var on = multi ? state[group].indexOf(v) >= 0 : state[group] === v;
    o.classList.toggle("selected", on);
  });
  updateNav();
}

/* ---------- navigation ---------- */
function stepValid(i) {
  if (i === 0) return !!state.stack;
  if (i === 1) return !!state.entra;
  if (i === 2) return state.resources.length > 0;
  if (i === 3) return !!state.scale;
  return true;
}

function goTo(i) {
  current = i;
  document.querySelectorAll(".wiz-step").forEach(function (s) {
    s.classList.toggle("active", parseInt(s.getAttribute("data-step"), 10) === i);
  });
  renderProgress();
  if (i === 4) renderResult();
  updateNav();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function renderProgress() {
  var p = document.getElementById("progress");
  p.innerHTML = "";
  STEPS.forEach(function (label, i) {
    var cls = "step";
    if (i < current) cls += " done";
    else if (i === current) cls += " current";
    p.innerHTML += '<div class="' + cls + '"><span class="dot">' + (i < current ? "✓" : i + 1) + '</span><span class="lbl">' + label + '</span></div>';
    if (i < STEPS.length - 1) p.innerHTML += '<span class="bar"></span>';
  });
}

function updateNav() {
  var back = document.getElementById("backBtn");
  var next = document.getElementById("nextBtn");
  back.style.visibility = current === 0 ? "hidden" : "visible";
  if (current === 4) {
    next.style.display = "none";
  } else {
    next.style.display = "";
    next.disabled = !stepValid(current);
  }
}

document.getElementById("backBtn").addEventListener("click", function () {
  if (current > 0) goTo(current - 1);
});
document.getElementById("nextBtn").addEventListener("click", function () {
  if (stepValid(current) && current < 4) goTo(current + 1);
});

/* ---------- diagram ---------- */
function marker(id, color) {
  return '<marker id="' + id + '" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto"><path d="M0 0 L10 5 L0 10 z" fill="' + color + '"></path></marker>';
}
function nodeStr(x, y, w, h, label, sub, color) {
  var hh = h / 2;
  var ly = y + hh + (sub ? -2 : 4);
  var subHtml = sub ? '<text x="' + (x + w / 2) + '" y="' + (y + hh + 13) + '" text-anchor="middle" class="node-sub">' + sub + '</text>' : '';
  return '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="9" class="node-box" stroke="' + color + '"></rect>' +
    '<text x="' + (x + w / 2) + '" y="' + ly + '" text-anchor="middle" class="node-label">' + label + '</text>' + subHtml;
}
function flowStr(x1, y1, x2, y2, color, markerId) {
  var mx = (x1 + x2) / 2;
  return '<path d="M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2 + '" class="flow" stroke="' + color + '" marker-end="url(#' + markerId + ')"></path>';
}

function beforeDiagram(v) {
  var label = v.short, note;
  if (v.kind === "none") {
    label = "No unified access";
    note = "Today: ad-hoc — direct internet plus whatever remote tools each team has cobbled together.";
  } else if (v.kind === "replace" || v.kind === "vpn") {
    note = "Today: all traffic rides the VPN tunnel — private apps and internet share one broad, trusted path.";
  } else {
    note = "Today: internet and SaaS are steered through " + v.name + ", while private apps typically still ride a separate VPN.";
  }
  var s = '<defs>' + marker("ab", "#94a3b8") + '</defs>';
  s += nodeStr(14, 96, 76, 48, "Device", null, "#94a3b8");
  s += nodeStr(150, 96, 140, 48, label, null, v.color);
  s += nodeStr(320, 46, 100, 42, "Private apps", null, "#94a3b8");
  s += nodeStr(320, 152, 100, 42, "Internet / SaaS", null, "#94a3b8");
  s += flowStr(90, 120, 150, 120, "#94a3b8", "ab");
  s += flowStr(290, 110, 320, 66, "#94a3b8", "ab");
  s += flowStr(290, 130, 320, 172, "#94a3b8", "ab");
  return { svg: s, note: note };
}

function afterDiagram(v, rec) {
  var coexist = rec && rec.coexist;
  var defs = '<defs>' + marker("aa", "#38bdf8") + (coexist ? marker("ac", v.color) : "") + '</defs>';
  var s = defs;
  s += nodeStr(14, 96, 76, 48, "Device", null, "#94a3b8");
  if (coexist) {
    s += nodeStr(150, 20, 140, 34, v.short, "coexisting", v.color);
    s += flowStr(290, 37, 320, 110, v.color, "ac");
  }
  s += nodeStr(150, 96, 140, 48, "Entra GSA", "Entra ID · Conditional Access", "#38bdf8");
  s += nodeStr(320, 30, 100, 40, "Private apps", null, "#38bdf8");
  s += nodeStr(320, 100, 100, 40, "Internet / SaaS", null, "#38bdf8");
  s += nodeStr(320, 170, 100, 40, "M365", null, "#38bdf8");
  s += flowStr(90, 120, 150, 120, "#38bdf8", "aa");
  s += flowStr(290, 108, 320, 50, "#38bdf8", "aa");
  s += flowStr(290, 120, 320, 120, "#38bdf8", "aa");
  s += flowStr(290, 132, 320, 190, "#38bdf8", "aa");
  var note = "After: per-app, identity-based access through Entra GSA — no VPN tunnel, nothing listening on the internet.";
  if (coexist) note += " " + v.name + " stays on for the traffic you choose, so you migrate app by app.";
  return { svg: s, note: note };
}

/* ---------- recommendation ---------- */
function computeRecommendation(v) {
  var rec = { title: "", desc: "", guide: null, coexist: false };
  if (v.kind === "none") {
    rec.title = "Clean-slate GSA rollout";
    rec.desc = "You're not unpicking a legacy stack, so you can go straight to Entra Private Access + Internet Access in a phased rollout — no coexistence required.";
  } else if (v.kind === "replace") {
    rec.title = "Private Access VPN replacement";
    rec.desc = "Your legacy VPN can be retired outright: publish each app through Entra Private Access and cut the tunnel entirely. No vendor coexistence needed.";
  } else if (v.kind === "vpn") {
    rec.title = "Cisco VPN coexistence";
    rec.desc = "Keep your Cisco VPN where it still makes sense and add GSA alongside it — a staged split-include / VPNaaS coexistence so users move off gradually.";
    rec.guide = v.guide; rec.coexist = true;
  } else {
    rec.title = v.name + " coexistence";
    rec.desc = "You don't have to rip out " + v.name + ". GSA takes over private access (and M365) while " + v.name + " keeps securing the traffic you're not ready to move — a documented, supported coexistence path.";
    rec.guide = v.guide; rec.coexist = true;
  }
  return rec;
}

function computeChanges(v, rec) {
  var changes = [
    "Broad network trust becomes <b>per-app, identity-based access</b> — no more standing tunnel into the whole network.",
    "VPN tunnels are replaced by <b>outbound-only Private Access connectors</b> — nothing exposed to the internet.",
    "Access follows <b>identity + device posture + risk</b> via Conditional Access, not just “are you on the VPN”.",
    "On-prem appliance sprawl collapses into <b>cloud-native SSE</b> on Microsoft's global edge network."
  ];
  if (rec.coexist) {
    changes.push("<b>" + v.name + " stays</b> for the traffic you choose while GSA handles the rest — migrate app by app, not big-bang.");
  } else {
    changes.push("<b>No coexistence needed</b> — a clean handover with a clear cutover plan.");
  }
  return changes;
}

function renderResult() {
  var v = VENDORS[state.stack] || VENDORS.greenfield;
  var rec = computeRecommendation(v);
  var before = beforeDiagram(v);
  var after = afterDiagram(v, rec);

  document.getElementById("beforeDot").style.background = v.color;
  document.getElementById("beforeSvg").innerHTML = before.svg;
  document.getElementById("beforeNote").textContent = before.note;
  document.getElementById("afterSvg").innerHTML = after.svg;
  document.getElementById("afterNote").textContent = after.note;

  document.getElementById("recTitle").textContent = rec.title;
  document.getElementById("recDesc").textContent = rec.desc;
  var link = document.getElementById("recLink");
  if (rec.guide) {
    link.href = "resources/" + rec.guide;
    link.style.display = "";
  } else {
    link.style.display = "none";
  }

  var list = document.getElementById("changeList");
  list.innerHTML = "";
  computeChanges(v, rec).forEach(function (c) {
    var li = document.createElement("li");
    li.innerHTML = CHECK + "<span>" + c + "</span>";
    list.appendChild(li);
  });
}

/* ---------- lead capture ---------- */
document.getElementById("leadForm").addEventListener("submit", function (e) {
  e.preventDefault();
  var name = document.getElementById("fName").value.trim();
  var email = document.getElementById("fEmail").value.trim();
  var company = document.getElementById("fCompany").value.trim();
  var note = document.getElementById("fNote").value.trim();
  var consent = document.getElementById("fConsent").checked;
  var msg = document.getElementById("submitMsg");

  if (!name || !email) {
    msg.className = "submit-msg err";
    msg.textContent = "Please add your name and work email.";
    return;
  }
  if (!consent) {
    msg.className = "submit-msg err";
    msg.textContent = "Please tick the consent box so we can reply.";
    return;
  }

  var v = VENDORS[state.stack] || VENDORS.greenfield;
  var rec = computeRecommendation(v);
  var payload = {
    timestamp: new Date().toISOString(),
    name: name,
    email: email,
    company: company,
    note: note,
    stack: v.name,
    entra: state.entra,
    resources: state.resources.join(", "),
    scale: state.scale,
    recommendation: rec.title
  };

  var bodyLines = [
    "GSA Impact Assessment — " + (company || name),
    "",
    "Current stack: " + v.name,
    "Entra ID: " + state.entra,
    "Resources: " + (state.resources.join(", ") || "—"),
    "Scale: " + state.scale,
    "Recommended path: " + rec.title,
    "",
    note ? "Notes: " + note : ""
  ];

  if (GOOGLE_SCRIPT_URL) {
    fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function () {
      msg.className = "submit-msg ok";
      msg.textContent = "Thanks " + name.split(" ")[0] + " — your request is in. We'll be in touch within one business day.";
    }).catch(function () {
      msg.className = "submit-msg err";
      msg.textContent = "Something went wrong. Please email hello@globalsecureaccess.io instead.";
    });
  } else {
    var subject = encodeURIComponent("GSA assessment request — " + (company || name));
    var body = encodeURIComponent(bodyLines.join("\n"));
    window.location.href = "mailto:hello@globalsecureaccess.io?subject=" + subject + "&body=" + body;
    msg.className = "submit-msg ok";
    msg.textContent = "Opening your email client — hit send and we'll take it from there.";
  }
});

/* ---------- init ---------- */
buildOptions();
renderProgress();
updateNav();
