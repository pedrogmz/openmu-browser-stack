# Generates a TLS certificate for the web server and WebSocket proxy.
#
# Usage (from the repo root):
#   ./scripts/generate-certs.ps1 192.168.1.106
#
# Requires mkcert: winget install FiloSottile.mkcert

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string[]]$Names = @()
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command mkcert -ErrorAction SilentlyContinue)) {
  throw "mkcert not found. Install it first: winget install FiloSottile.mkcert"
}

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
New-Item -ItemType Directory -Force -Path $certDir | Out-Null

if ($Names.Count -eq 0) {
  Write-Warning "No LAN IP given: the certificate will only be valid for localhost."
  Write-Warning "Pass the server LAN IP, e.g.: ./scripts/generate-certs.ps1 192.168.1.106"
}

$certNames = @("localhost", "127.0.0.1") + $Names | Select-Object -Unique

Write-Host "Creating certificate for: $($certNames -join ', ')"
mkcert -install
mkcert -cert-file (Join-Path $certDir "server.crt") -key-file (Join-Path $certDir "server.key") @certNames

Write-Host ""
Write-Host "Certificate written to $certDir"
Write-Host "Enable it in .env:"
Write-Host "  TLS_CERT_PATH=certs/server.crt"
Write-Host "  TLS_KEY_PATH=certs/server.key"
Write-Host ""
Write-Host "Trust the root CA on each client machine (copy rootCA.pem from):"
mkcert -CAROOT
