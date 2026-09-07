<#
.SYNOPSIS
  Passbeck GSA Discovery — offline export (no app registration, no consent to Passbeck).
  Runs in YOUR tenant with YOUR admin credentials and exports the same discovery data
  the browser tool collects, to a JSON file you review locally or upload back.

.DESCRIPTION
  Connects to Microsoft Graph with delegated credentials and reads:
    - service principals + app registrations (app inventory)
    - sign-in logs (access patterns, top apps, risky sign-ins)
    - Conditional Access policies
    - Global Secure Access forwarding profiles (beta endpoint)
  ...then performs the same incumbent-vendor detection and emits a JSON file
  matching the Discovery tool's result shape.

.PREREQUISITES
  Install-Module Microsoft.Graph
  Scopes (consented when you connect): User.Read, Directory.Read.All,
    Application.Read.All, Policy.Read.All, AuditLog.Read.All, Organization.Read.All,
    NetworkAccess.Read.All (admin consent required for GSA forwarding profiles).
  AuditLog.Read.All requires an Entra ID P1 license.

.EXAMPLE
  .\export-gsa-discovery.ps1 -OutFile .\gsa-discovery.json
#>
param(
    [string]$OutFile = ".\gsa-discovery.json"
)

$ErrorActionPreference = "Stop"

# ---------- connect ----------
Connect-MgGraph -Scopes "User.Read","Directory.Read.All","Application.Read.All","Policy.Read.All","AuditLog.Read.All","Organization.Read.All","NetworkAccess.Read.All" -NoWelcome

$ctx = Get-MgContext
$errors = @()
$result = [ordered]@{}

# ---------- tenant ----------
try {
    $org = Get-MgOrganization | Select-Object -First 1
    $domains = @()
    foreach ($d in $org.VerifiedDomains) { if ($d.Name) { $domains += $d.Name } }
    $result.tenant = [ordered]@{ name = $org.DisplayName; id = $ctx.TenantId; domains = $domains }
} catch { $errors += "tenant: $($_.Exception.Message)" }

# ---------- apps ----------
$apps = @()
try {
    $sps = Get-MgServicePrincipal -All | Where-Object { $_.ServicePrincipalType -eq "Application" }
    foreach ($sp in $sps) {
        $isMs = ($sp.Tags -contains "WindowsAzureActiveDirectoryIntegratedApp") -or ($sp.AppId -match '^0000000[0-9a-f]') -or ($sp.DisplayName -like 'GSA-*')
        $apps += [ordered]@{ name = $sp.DisplayName; appId = $sp.AppId; kind = "enterprise-app"; microsoft = [bool]$isMs }
    }
    $regs = Get-MgApplication -All
    $spAppIds = @($sps | ForEach-Object { $_.AppId })
    foreach ($reg in $regs) {
        if ($spAppIds -notcontains $reg.AppId) {
            $apps += [ordered]@{ name = $reg.DisplayName; appId = $reg.AppId; kind = "app-registration"; microsoft = $false }
        }
    }
    $result.apps = $apps
} catch { $errors += "apps: $($_.Exception.Message)"; $result.apps = @() }

# ---------- access (sign-ins) ----------
$result.access = [ordered]@{ topApps = @(); riskySignIns = 0; sampleSize = 0; clientApps = @() }
try {
    $signins = Get-MgAuditLogSignIn -Top 100 -All | Select-Object AppDisplayName, ClientAppUsed, RiskLevelDuringSignIn
    $counts = @{}
    $clients = @{}
    $risky = 0
    foreach ($s in $signins) {
        $app = if ($s.AppDisplayName) { $s.AppDisplayName } else { "(unknown)" }
        if ($counts.ContainsKey($app)) { $counts[$app]++ } else { $counts[$app] = 1 }
        $c = if ($s.ClientAppUsed) { $s.ClientAppUsed } else { "(unknown)" }
        if ($clients.ContainsKey($c)) { $clients[$c]++ } else { $clients[$c] = 1 }
        if ($s.RiskLevelDuringSignIn -and $s.RiskLevelDuringSignIn -ne "none" -and $s.RiskLevelDuringSignIn -ne "low") { $risky++ }
    }
    $top = @()
    foreach ($k in ($counts.GetEnumerator() | Sort-Object Value -Descending | Select-Object -First 10)) {
        $top += [ordered]@{ name = $k.Key; count = $k.Value }
    }
    $ca = @()
    foreach ($k in $clients.GetEnumerator()) { $ca += [ordered]@{ client = $k.Key; count = $k.Value } }
    $result.access = [ordered]@{ topApps = $top; riskySignIns = $risky; sampleSize = @($signins).Count; clientApps = $ca }
} catch { $errors += "sign-ins: $($_.Exception.Message)" }

# ---------- Conditional Access ----------
$result.posture = [ordered]@{ caPolicyCount = 0; caEnabled = 0; caDisabled = 0; policies = @() }
try {
    $caps = Get-MgIdentityConditionalAccessPolicy -All
    $policies = @()
    $enabled = 0
    foreach ($p in $caps) {
        $state = $p.State
        if ($state -eq "enabled") { $enabled++ }
        $policies += [ordered]@{ name = $p.DisplayName; state = $state }
    }
    $result.posture = [ordered]@{
        caPolicyCount = @($caps).Count
        caEnabled     = $enabled
        caDisabled    = @($caps).Count - $enabled
        policies      = $policies
    }
} catch { $errors += "conditional-access: $($_.Exception.Message)" }

# ---------- GSA forwarding profiles ----------
$result.gsa = [ordered]@{ onboarded = $false; forwardingProfiles = @() }
try {
    $profiles = Invoke-MgGraphRequest -Method GET -Uri "https://graph.microsoft.com/beta/networkAccess/forwardingProfiles"
    $fp = @()
    foreach ($p in $profiles.value) {
        $fp += [ordered]@{ type = $p.trafficForwardingType; state = $p.state }
    }
    $result.gsa = [ordered]@{ onboarded = @($fp).Count -gt 0; forwardingProfiles = $fp }
} catch { $errors += "gsa: $($_.Exception.Message)" }

# ---------- vendor detection ----------
$vendors = @(
    @{ key = "zscaler";  name = "Zscaler";              markers = @("zscaler", "zpa", "zia") },
    @{ key = "umbrella"; name = "Cisco Umbrella";       markers = @("umbrella", "opendns") },
    @{ key = "ciscoSA";  name = "Cisco Secure Access";  markers = @("cisco secure access", "secureconnect", "cisco+") },
    @{ key = "ciscoVPN"; name = "Cisco AnyConnect VPN"; markers = @("anyconnect", "cisco secure client", "asa vpn") },
    @{ key = "netskope"; name = "Netskope";             markers = @("netskope") },
    @{ key = "prisma";   name = "Prisma Access";        markers = @("prisma", "globalprotect", "palo alto") }
)
$detected = $null
$evidence = @()
foreach ($a in $apps) {
    $n = ($a.name).ToLowerInvariant()
    if ($n.Contains("microsoft") -or $n.Contains("global secure access")) { continue }
    foreach ($v in $vendors) {
        foreach ($m in $v.markers) {
            if ($n.Contains($m)) {
                $detected = $v
                $evidence += "matched marker '$m' in '$($a.name)'"
                break
            }
        }
        if ($detected) { break }
    }
    if ($detected) { break }
}

$guides = @{
    zscaler  = @{ title = "Zscaler coexistence";              desc = "GSA takes over private access (and M365) while Zscaler keeps the traffic you're not ready to move." };
    umbrella = @{ title = "Cisco Umbrella coexistence";       desc = "GSA takes over private access (and M365) while Umbrella keeps DNS-layer security." };
    ciscoSA  = @{ title = "Cisco Secure Access coexistence";  desc = "GSA can deploy alongside Cisco Secure Access — take over private access while Cisco keeps the rest." };
    ciscoVPN = @{ title = "Cisco AnyConnect coexistence";     desc = "Keep AnyConnect where it still makes sense and add GSA alongside it — a staged split-include coexistence." };
    netskope = @{ title = "Netskope coexistence";             desc = "GSA takes over private access (and M365) while Netskope keeps the traffic you're not ready to move." };
    prisma   = @{ title = "Prisma Access coexistence";        desc = "GSA takes over private access (and M365) while Prisma Access keeps the traffic you're not ready to move." }
}

$result.vendor = [ordered]@{
    detected = if ($detected) { $detected.name } else { $null }
    key      = if ($detected) { $detected.key }  else { $null }
    guide    = if ($detected) { "$($detected.key).html" } else { $null }
    evidence = $evidence
}

$result.coexistence = if ($detected) {
    [ordered]@{ title = $guides[$detected.key].title; desc = $guides[$detected.key].desc; guide = "$($detected.key).html" }
} else {
    $null
}

$result.errors = $errors

# ---------- emit ----------
$wrapper = [ordered]@{ exportedAt = (Get-Date).ToUniversalTime().ToString("o"); discovery = $result; onPrem = @() }
$wrapper | ConvertTo-Json -Depth 12 | Out-File -FilePath $OutFile -Encoding utf8

Write-Host ""
Write-Host "Done. Exported discovery to $OutFile"
if ($detected) { Write-Host "Detected vendor: $($detected.name)" } else { Write-Host "No incumbent SSE/VPN vendor detected." }
if ($errors.Count -gt 0) { Write-Host "Warnings:"; $errors | ForEach-Object { Write-Host "  - $_" } }
Write-Host "Upload this file back at https://passbeck.com/discovery/ to run the full analysis."
