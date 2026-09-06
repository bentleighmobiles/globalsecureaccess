/* GSA Discovery — configuration.
   Fill in the clientId and redirectUri from your Azure AD app registration (see SETUP.md).
   The app reads these at runtime; nothing else needs editing. */
window.GSA_DISCOVERY_CONFIG = {
  // Application (client) ID from Entra admin center → App registrations.
  clientId: "YOUR_CLIENT_ID",

  // Which tenants can sign in. Options:
  //   "https://login.microsoftonline.com/common"          — any Microsoft 365 / Entra tenant
  //   "https://login.microsoftonline.com/organizations"   — work/school accounts only
  //   "https://login.microsoftonline.com/<tenant-id>"     — lock to a single tenant
  authority: "https://login.microsoftonline.com/common",

  // Redirect URI — MUST exactly match an entry under the app registration's
  // "Authentication → Redirect URIs" (SPA platform). Leave "auto" to use the
  // current page URL, or hardcode the deployed URL, e.g.
  //   "https://bentleighmobiles.github.io/globalsecureaccess/discovery/"
  redirectUri: "auto",

  // Delegated read-only Graph scopes the discovery needs.
  scopes: [
    "User.Read",
    "Directory.Read.All",
    "Application.Read.All",
    "Policy.Read.All",
    "AuditLog.Read.All",
    "Organization.Read.All",
    "GlobalSecureAccess.Read.All"
  ],

  // Graph beta endpoints are used for GSA config (networkAccess). Keep true.
  useBeta: true
};
