param(
  [Parameter(Mandatory=$true)][ValidateSet('x64','arm64')][string]$Architecture,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$component = if ($Architecture -eq 'arm64') { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
$installations = @(& $vswhere -all -products '*' -requires $component -property installationPath)
if ($LASTEXITCODE -ne 0 -or !$installations.Count) { throw 'MSVC development toolchain missing' }
foreach ($installation in $installations) {
  $versions = @(Get-ChildItem -LiteralPath (Join-Path $installation 'VC\Tools\MSVC') -Directory | Select-Object -ExpandProperty Name)
  Write-Host (ConvertTo-Json -Compress @{ type = 'bootstrap-installed-toolsets'; installation = $installation; versions = $versions })
}
$installation = & $vswhere -latest -products '*' -requires $component -property installationPath
& (Join-Path $installation 'Common7\Tools\Launch-VsDevShell.ps1') -Arch $Architecture -HostArch $Architecture -SkipAutomaticLocation
if (!$?) { throw 'Cannot initialize native MSVC development environment' }
$compiler = (Get-Command cl.exe -CommandType Application).Source
$linker = (Get-Command link.exe -CommandType Application).Source
$toolchain = [ordered]@{
  architecture = $Architecture
  compiler = (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion
  linker = (Get-Item -LiteralPath $linker).VersionInfo.FileVersion
  msvc = $env:VCToolsVersion.TrimEnd('\')
  windowsSdk = $env:WindowsSDKVersion.TrimEnd('\')
}
Write-Host (ConvertTo-Json -Compress @{ type = 'bootstrap-toolchain'; tools = $toolchain; compilerPath = $compiler; linkerPath = $linker; sdkPath = $env:WindowsSdkDir })
$toolchain | ConvertTo-Json | Set-Content -LiteralPath $Output -Encoding utf8
