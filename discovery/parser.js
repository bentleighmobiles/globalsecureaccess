/* GSA Discovery — on-prem legacy-app parser.
   Parses pasted VPN split-tunnel route lists and firewall exports (CIDRs, FQDNs,
   hostnames) into a structured legacy-app inventory that Microsoft Graph can't see.

   Pure module — no dependencies, testable in Node or the browser.
   Exposes window.GsaDiscoveryParser = { parse(text) } */
(function (global) {
  "use strict";

  var CIDR_RE = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  var IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
  var FQDN_RE = /^(?=.{1,253}$)(?:(?!-)[a-z0-9_-]{1,63}(?<!-)\.)+[a-z]{2,63}$/i;

  function isCidr(tok) { return CIDR_RE.test(tok); }
  function isIp(tok) { return IP_RE.test(tok); }
  function isFqdn(tok) { return FQDN_RE.test(tok); }

  function classify(token) {
    if (isCidr(token)) return "cidr";
    if (isIp(token)) return "ip";
    if (isFqdn(token)) return "fqdn";
    return null;
  }

  // Strip common noise: comments, JSON braces/quotes, CSV wrappers, "ip route/access-list" prefixes.
  function cleanLine(line) {
    var s = String(line).trim();
    if (!s) return "";
    // drop comments (# or // or ;)
    s = s.replace(/(^|\s)(#|\/\/|;).*$/, "").trim();
    if (!s) return "";
    // strip wrapping quotes
    s = s.replace(/^["']|["']$/g, "");
    // drop leading Cisco-style keywords
    s = s.replace(/^(permit|deny|ip|route|network|object|address)\s+/i, "");
    return s;
  }

  function tokenize(text) {
    // normalize CSV / whitespace / pipes into tokens
    var tokens = [];
    String(text).split(/\r?\n/).forEach(function (rawLine) {
      var line = cleanLine(rawLine);
      if (!line) return;
      line.split(/[\s,;|]+/).forEach(function (tok) {
        if (tok) tokens.push(tok);
      });
    });
    return tokens;
  }

  function parse(text) {
    var items = [];
    var tokens = tokenize(text);
    var i = 0;
    while (i < tokens.length) {
      var tok = tokens[i];
      var kind = classify(tok);
      if (kind) {
        var item = { kind: kind, value: tok, label: "" };
        // try to grab a following label word (non-route text) as the app name
        var next = tokens[i + 1];
        if (next && !classify(next)) {
          item.label = next.replace(/[,_-]+$/g, "");
          i += 2;
        } else {
          i += 1;
        }
        items.push(item);
      } else {
        i += 1; // stray token (e.g. header word) — skip
      }
    }
    return items;
  }

  function summarize(items) {
    var byKind = { cidr: 0, ip: 0, fqdn: 0 };
    items.forEach(function (it) { byKind[it.kind] = (byKind[it.kind] || 0) + 1; });
    return byKind;
  }

  global.GsaDiscoveryParser = { parse: parse, summarize: summarize, classify: classify };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { parse: parse, summarize: summarize, classify: classify };
  }
})(typeof window !== "undefined" ? window : globalThis);
