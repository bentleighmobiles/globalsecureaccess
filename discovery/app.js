/* GSA Discovery — client-side discovery app.
   Customer signs in via Microsoft OAuth (MSAL, authorization-code + PKCE), the app
   reads their own tenant via Microsoft Graph (delegated, read-only) and produces an
   app inventory + access map + Zero Trust posture + incumbent-vendor detection +
   coexistence recommendation. Pure browser, no backend. */
(function (global) {
  "use strict";

  var CONFIG = global.GSA_DISCOVERY_CONFIG || {};
  var NOT_CONFIGURED = !CONFIG.clientId || CONFIG.clientId === "YOUR_CLIENT_ID";

  // ---------- vendor -> coexistence guide (mirrors the assessment wizard) ----------
  var VENDORS = [
    { key: "zscaler",  name: "Zscaler",              markers: ["zscaler", "zpa", "zia"], guide: "zscaler.html" },
    { key: "umbrella", name: "Cisco Umbrella",       markers: ["umbrella", "opendns"],   guide: "cisco-umbrella.html" },
    { key: "ciscoSA",  name: "Cisco Secure Access",  markers: ["secure access", "secureconnect"], guide: "cisco-secure-access.html" },
    { key: "ciscoVPN", name: "Cisco VPN",            markers: ["anyconnect", "cisco secure client", "asa vpn"], guide: "cisco-vpn.html" },
    { key: "netskope", name: "Netskope",             markers: ["netskope"],              guide: "netskope.html" },
    { key: "prisma",   name: "Prisma Access",        markers: ["prisma", "globalprotect", "palo alto"], guide: "palo-alto.html" },
    { key: "fortinet", name: "Fortinet",             markers: ["forticlient", "fortinet", "fortigate"], guide: null },
    { key: "citrix",   name: "Citrix",               markers: ["citrix"],                guide: null }
  ];

  var state = { result: null, busy: false, onPremItems: [] };

  // ---------- MSAL ----------
  var msalInstance = null;
  var initPromise = null;
  function ensureInitialized() {
    if (!msalInstance) return Promise.resolve();
    if (!initPromise) initPromise = msalInstance.initialize();
    return initPromise;
  }
  function initMsal() {
    if (NOT_CONFIGURED) return null;
    var redirectUri = CONFIG.redirectUri === "auto" ? window.location.href.split("#")[0] : CONFIG.redirectUri;
    msalInstance = new msal.PublicClientApplication({
      auth: { clientId: CONFIG.clientId, authority: CONFIG.authority, redirectUri: redirectUri },
      cache: { cacheLocation: "sessionStorage", storeAuthStateInCookie: false }
    });
    return msalInstance;
  }

  function signedIn() {
    return !!(msalInstance && msalInstance.getActiveAccount());
  }

  function login() {
    if (!msalInstance) return;
    ensureInitialized().then(function () {
      return msalInstance.loginRedirect({ scopes: CONFIG.scopes });
    }).catch(function (e) {
      ui.error("Sign-in failed: " + (e && e.message ? e.message : e));
    });
  }

  function logout() { if (msalInstance) msalInstance.logoutRedirect({ postLogoutRedirectUri: window.location.href.split("#")[0] }); }

  async function handleRedirect() {
    if (NOT_CONFIGURED || !msalInstance) return false;
    await ensureInitialized();
    try {
      var resp = await msalInstance.handleRedirectPromise();
      if (resp && resp.account) msalInstance.setActiveAccount(resp.account);
    } catch (e) { /* ignore token errors here; surfaced on demand */ }
    if (msalInstance.getAllAccounts().length && !msalInstance.getActiveAccount()) {
      msalInstance.setActiveAccount(msalInstance.getAllAccounts()[0]);
    }
    return signedIn();
  }

  async function getToken() {
    await ensureInitialized();
    var account = msalInstance.getActiveAccount();
    var req = { scopes: CONFIG.scopes, account: account };
    try {
      return (await msalInstance.acquireTokenSilent(req)).accessToken;
    } catch (e) {
      if (e && e.name === "InteractionRequiredAuthError") {
        await msalInstance.acquireTokenRedirect(req);
        throw new Error("__redirect__");
      }
      throw e;
    }
  }

  // ---------- Graph (plain fetch, no SDK) ----------
  async function graphGet(path, apiVersion) {
    var token = await getToken();
    var url = "https://graph.microsoft.com/" + (apiVersion || "v1.0") + "/" + path;
    var res = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (res.status === 204) return null;
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      var err = new Error("Graph " + res.status + " on " + url);
      err.graph = data; err.status = res.status;
      throw err;
    }
    return data;
  }

  async function graphGetBeta(path) {
    try { return await graphGet(path, "beta"); }
    catch (e) { return null; }
  }

  // ---------- discovery steps (each resilient — partial results still render) ----------
  async function discover() {
    state.result = { tenant: null, apps: [], access: {}, posture: {}, vendor: {}, gsa: {}, coexistence: null, errors: [] };
    var r = state.result;

    await step("Tenant", async function () {
      var org = await graphGet("organization?$select=displayName,id,verifiedDomains");
      var o = org.value && org.value[0];
      r.tenant = o ? { name: o.displayName, id: o.id, domains: (o.verifiedDomains || []).map(function (d) { return d.name; }) } : null;
    });

    await step("Application inventory", async function () {
      var sps = await graphGet("servicePrincipals?$select=displayName,appId,servicePrincipalType,tags&$top=999");
      var regs = await graphGet("applications?$select=displayName,appId,signInAudience&$top=999");
      var spMap = {};
      (sps.value || []).forEach(function (sp) {
        if (sp.servicePrincipalType === "Application") spMap[sp.appId] = sp;
      });
      var apps = [];
      Object.keys(spMap).forEach(function (appId) {
        var sp = spMap[appId];
        apps.push({ name: sp.displayName, appId: appId, kind: "enterprise-app" });
      });
      (regs.value || []).forEach(function (reg) {
        if (!spMap[reg.appId]) apps.push({ name: reg.displayName, appId: reg.appId, kind: "app-registration" });
      });
      r.apps = apps;
    });

    await step("Sign-in activity", async function () {
      var logs = await graphGet("auditLogs/signIns?$top=50&$select=appDisplayName,appId,status,riskState,clientAppUsed,createdDateTime");
      var vals = logs.value || [];
      var counts = {};
      var risky = 0;
      var clientApps = {};
      vals.forEach(function (s) {
        var n = s.appDisplayName || "(unknown)";
        counts[n] = (counts[n] || 0) + 1;
        if (s.riskState && s.riskState !== "none" && s.riskState !== "confirmedSafe") risky++;
        var c = s.clientAppUsed || "other";
        clientApps[c] = (clientApps[c] || 0) + 1;
      });
      r.access = {
        topApps: Object.keys(counts).map(function (k) { return { name: k, count: counts[k] }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 15),
        riskySignIns: risky,
        sampleSize: vals.length,
        clientApps: Object.keys(clientApps).map(function (k) { return { client: k, count: clientApps[k] }; })
          .sort(function (a, b) { return b.count - a.count; }).slice(0, 10)
      };
    });

    await step("Zero Trust posture", async function () {
      var ca = await graphGet("identity/conditionalAccess/policies?$select=displayName,state");
      var policies = ca.value || [];
      r.posture = {
        caPolicyCount: policies.length,
        caEnabled: policies.filter(function (p) { return p.state === "enabled"; }).length,
        caDisabled: policies.filter(function (p) { return p.state === "disabled"; }).length,
        policies: policies.map(function (p) { return { name: p.displayName, state: p.state }; })
      };
    });

    await step("Global Secure Access", async function () {
      var profiles = await graphGetBeta("networkAccess/forwardingProfiles");
      r.gsa = {
        onboarded: !!(profiles && profiles.value && profiles.value.length),
        forwardingProfiles: profiles && profiles.value
          ? profiles.value.map(function (p) { return { type: p.trafficForwardingType, state: p.state }; })
          : []
      };
    });

    r.vendor = detectVendor(r);
    r.coexistence = recommendCoexistence(r.vendor);
    state.result = r;
    return r;
  }

  async function step(label, fn) {
    try { await fn(); }
    catch (e) {
      var msg = (e && e.message ? e.message : String(e)).replace("Graph ", "");
      state.result.errors.push({ label: label, message: msg });
    }
  }

  // ---------- vendor detection ----------
  function detectVendor(r) {
    var haystack = (r.apps || []).map(function (a) { return (a.name || "").toLowerCase(); });
    if (r.access && r.access.clientApps) {
      haystack = haystack.concat(r.access.clientApps.map(function (c) { return (c.client || "").toLowerCase(); }));
    }
    var text = haystack.join(" | ");
    var found = null;
    var evidence = [];
    VENDORS.forEach(function (v) {
      v.markers.forEach(function (m) {
        if (text.indexOf(m) >= 0 && !found) {
          found = v;
          evidence.push("matched marker '" + m + "'");
        }
      });
    });
    return found ? { detected: found.name, key: found.key, guide: found.guide, evidence: evidence } : { detected: null };
  }

  function recommendCoexistence(vendor) {
    if (!vendor || !vendor.detected) {
      return { title: "No incumbent SSE/VPN vendor detected", desc: "No evidence of Zscaler, Cisco, Netskope, Prisma, Fortinet or Citrix clients in your tenant. You may be a greenfield or direct-VPN shop — worth confirming with a workshop.", guide: null };
    }
    if (vendor.guide) {
      return { title: vendor.detected + " coexistence", desc: "You run " + vendor.detected + ". GSA can deploy alongside it — take over private access (and M365) while " + vendor.detected + " keeps the traffic you're not ready to move.", guide: vendor.guide };
    }
    return { title: vendor.detected + " coexistence", desc: "You run " + vendor.detected + ". We'd assess the specific coexistence approach for it in a workshop — the pattern is the same: GSA takes private access, the incumbent keeps what it owns today.", guide: null };
  }

  // ---------- export ----------
  function exportJson() {
    var payload = {
      exportedAt: new Date().toISOString(),
      discovery: state.result,
      onPrem: global.__onprem || state.onPremItems
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "gsa-discovery.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }

  global.GsaDiscovery = {
    init: initMsal,
    handleRedirect: handleRedirect,
    login: login,
    logout: logout,
    signedIn: signedIn,
    discover: discover,
    exportJson: exportJson,
    VENDORS: VENDORS,
    NOT_CONFIGURED: NOT_CONFIGURED,
    account: function () {
      var a = msalInstance && msalInstance.getActiveAccount();
      return a ? { name: a.name, username: a.username } : null;
    }
  };
})(typeof window !== "undefined" ? window : globalThis);
