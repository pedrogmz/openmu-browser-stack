<#
.SYNOPSIS
  Builds the proxy image (Node stack + compiled WASM client) and pushes it to GHCR.

.DESCRIPTION
  The WASM client and the game data buckets are built locally (mu-main/build-wasm.ps1
  deploys them into public/) and are not in git, so this image is built on this
  machine instead of GitHub Actions.

  Tags pushed:
    <image>:latest
    <image>:<yyyyMMdd-HHmm>-<git sha>   immutable, for pinning / rolling back in Coolify

  One-time login (a GitHub PAT with write:packages; Docker Desktop stores it):
    docker login ghcr.io -u <github user>

.EXAMPLE
  ./scripts/publish-image.ps1            # build + push
  ./scripts/publish-image.ps1 -NoPush    # build only
#>
param (
    [string]$Image = "ghcr.io/pedrogmz/openmu-browser-proxy",
    [switch]$NoPush
)

$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
Set-Location $root

# The image is useless without the client: fail early instead of publishing a placeholder page.
$required = @("public\Main.wasm", "public\Main.js", "public\Main.data", "public\Main.data.js", "public\assets\data-manifest.json")
$missing = $required | Where-Object { -not (Test-Path $_) }
if ($missing) {
    Write-Error "Missing WASM client files: $($missing -join ', '). Run mu-main/build-wasm.ps1 first."
    exit 1
}

$sha = (git rev-parse --short HEAD 2>$null)
if (-not $sha) { $sha = "nogit" }
if (git status --porcelain 2>$null) { $sha = "$sha-dirty" }
$stamp = Get-Date -Format "yyyyMMdd-HHmm"
$versionTag = "$stamp-$sha"
# Identifies the client build that is baked in (Main.wasm content hash).
$clientVersion = (Get-FileHash "public\Main.wasm" -Algorithm SHA256).Hash.Substring(0, 12).ToLower()

Write-Host "=== Building $Image ($versionTag, client $clientVersion) ===" -ForegroundColor Cyan
docker build --platform linux/amd64 `
    --build-arg "CLIENT_VERSION=$clientVersion" `
    -t "${Image}:latest" -t "${Image}:$versionTag" -t "openmu-browser-proxy:local" .
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

if ($NoPush) {
    Write-Host "Built ${Image}:$versionTag (not pushed)." -ForegroundColor Green
    exit 0
}

Write-Host "=== Pushing ===" -ForegroundColor Cyan
foreach ($tag in @($versionTag, "latest")) {
    docker push "${Image}:$tag"
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Push failed. Log in first: docker login ghcr.io -u <github user>"
        exit $LASTEXITCODE
    }
}
Write-Host "Pushed ${Image}:$versionTag and :latest" -ForegroundColor Green
