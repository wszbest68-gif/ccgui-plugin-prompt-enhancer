param([Parameter(Mandatory=$true)][string]$BaseUrl)
$ErrorActionPreference = 'Stop'
$peUri = [Uri]$BaseUrl
if (-not $peUri.IsAbsoluteUri -or $peUri.Scheme -notin @('http','https') -or $peUri.UserInfo -or $peUri.Query -or $peUri.Fragment) { throw 'Invalid HTTP(S) API Base URL.' }
if ($peUri.DnsSafeHost -notmatch '^[A-Za-z0-9.-]+$') { throw 'This host shape is not supported by the plugin SDK.' }
$peManifestPath = Join-Path $PSScriptRoot 'manifest.json'
$peManifest = Get-Content -LiteralPath $peManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$peGrant = 'network:' + $peUri.DnsSafeHost
if (-not $peUri.IsDefaultPort) { $peGrant += ':' + $peUri.Port }
if ($peManifest.permissions -notcontains $peGrant) {
  $peStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item -LiteralPath $peManifestPath -Destination ($peManifestPath + '.before-host-' + $peStamp)
  $peManifest.permissions = @($peManifest.permissions) + $peGrant
  [IO.File]::WriteAllText($peManifestPath, ($peManifest | ConvertTo-Json -Depth 20), [Text.UTF8Encoding]::new($false))
}
Write-Output ('Authorized: ' + $peGrant)
Write-Output 'Reinstall this directory through CCGUI Plugins > Install from local directory, then save your URL/key/model in plugin settings.'
