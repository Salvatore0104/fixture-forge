param(
  [string]$Version = "1.0.0"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $root

Push-Location frontend
npm ci
npm run build
Pop-Location

python -m pip install --upgrade pip
python -m pip install -r launcher/requirements.txt
python -m PyInstaller --clean --noconfirm packaging/fixture-forge.spec

$env:FIXTURE_FORGE_VERSION = $Version
$iscc = Get-Command ISCC.exe -ErrorAction SilentlyContinue
if (-not $iscc) {
  $candidates = @(
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles}\Inno Setup 6\ISCC.exe"
  )
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      $iscc = Get-Item $candidate
      break
    }
  }
}
if (-not $iscc) {
  throw "ISCC.exe not found. Install Inno Setup 6, then rerun this script."
}

& $iscc.Source packaging/FixtureForge.iss
