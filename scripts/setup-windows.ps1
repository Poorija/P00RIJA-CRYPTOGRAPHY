# Native/build setup for Windows.

[CmdletBinding()]
param(
  [switch]$AssumeYes
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

function Write-Step($Message) { Write-Host "▶ $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "✓ $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "⚠ $Message" -ForegroundColor Yellow }
function Fail($Message) { Write-Host "✗ $Message" -ForegroundColor Red; exit 1 }

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Confirm-Action($Message) {
  if ($AssumeYes) { return $true }
  $answer = Read-Host "$Message [y/N]"
  return $answer -match "^[Yy]$"
}

function Test-Internet {
  try {
    $result = Test-NetConnection -ComputerName "registry.npmjs.org" -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue
    if ($result) { return $true }
    return (Test-NetConnection -ComputerName "github.com" -Port 443 -InformationLevel Quiet -WarningAction SilentlyContinue)
  } catch {
    return $false
  }
}

function Install-WingetPackage($Id, $Name) {
  if (-not (Test-Command winget)) {
    Fail "winget is required to install $Name. Install App Installer from Microsoft Store, then rerun this script."
  }
  if (-not (Test-Internet)) {
    Fail "$Name is missing and cannot be installed because internet/update servers are unreachable."
  }
  if (-not (Confirm-Action "Install $Name with winget?")) {
    Fail "$Name is required."
  }
  winget install --id $Id --exact --silent --accept-package-agreements --accept-source-agreements
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
  Fail "This script is for Windows. Use setup-linux.sh or setup-macos.sh on other platforms."
}

Write-Step "Checking Windows update/source availability"
if (Test-Internet) {
  if (Test-Command winget) {
    winget source update | Out-Host
    winget upgrade | Select-Object -First 20 | Out-Host
  } else {
    Write-Warn "winget is not available; Windows update/source check is limited."
  }
} else {
  Write-Warn "Internet or update servers are not reachable. Skipping update check, but dependency checks will still run."
}

if (-not (Test-Command node)) {
  Install-WingetPackage "OpenJS.NodeJS.LTS" "Node.js LTS"
}
if (-not (Test-Command npm)) {
  Fail "npm is still missing after Node.js check. Reopen PowerShell or reinstall Node.js LTS."
}
if (-not (Test-Command rustc) -or -not (Test-Command cargo)) {
  Install-WingetPackage "Rustlang.Rustup" "Rust toolchain"
  Write-Warn "If rustc/cargo are still unavailable, reopen PowerShell and rerun this script."
}
if (-not (Test-Command git)) {
  Install-WingetPackage "Git.Git" "Git"
}
if (-not (Test-Command docker)) {
  Install-WingetPackage "Docker.DockerDesktop" "Docker Desktop"
  Write-Warn "Open Docker Desktop once and wait until Docker is running, then rerun if docker is still unavailable."
}

$webView2 = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\*" -ErrorAction SilentlyContinue |
  Where-Object { $_.name -like "*WebView2*" } |
  Select-Object -First 1
if (-not $webView2) {
  Install-WingetPackage "Microsoft.EdgeWebView2Runtime" "Microsoft Edge WebView2 Runtime"
}

if (-not (Test-Command rustc) -or -not (Test-Command cargo)) {
  Write-Warn "Rust commands are not visible in this shell. Reopen PowerShell after rustup installation if needed."
}
if (Test-Command docker) {
  try {
    docker compose version | Out-Null
  } catch {
    Write-Warn "Docker is installed, but docker compose is not ready. Start Docker Desktop and rerun if needed."
  }
}

Set-Location $Root
if (-not (Test-Path "node_modules")) {
  Write-Step "Installing npm dependencies"
  npm install
} else {
  Write-Ok "node_modules already exists"
}

Write-Step "Preparing Tauri web assets"
npm run native:prepare

Write-Ok "Windows native/build setup is ready."
Write-Host "Useful commands:"
Write-Host "  npm run native:build:windows"
