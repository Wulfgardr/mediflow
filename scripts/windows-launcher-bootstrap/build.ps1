param(
  [Parameter(Mandatory=$true)][ValidateSet('x64','arm64')][string]$Architecture,
  [Parameter(Mandatory=$true)][string]$Sdk,
  [Parameter(Mandatory=$true)][string]$Output
)
$ErrorActionPreference = 'Stop'
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$component = if ($Architecture -eq 'arm64') { 'Microsoft.VisualStudio.Component.VC.Tools.ARM64' } else { 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64' }
$installation = & $vswhere -latest -products '*' -requires $component -property installationPath
if ($LASTEXITCODE -ne 0 -or !$installation) { throw 'MSVC development toolchain missing' }
$dev = Join-Path $installation 'Common7\Tools\Launch-VsDevShell.ps1'
& $dev -Arch $Architecture -HostArch $Architecture -SkipAutomaticLocation
if (!$?) { throw 'Cannot initialize native MSVC development environment' }
$compiler = (Get-Command cl.exe -CommandType Application).Source
$linker = (Get-Command dumpbin.exe -CommandType Application).Source
$source = Join-Path $PSScriptRoot 'system-directory.c'
$object = Join-Path $Output 'system-directory.obj'
$binary = Join-Path $Output 'system-directory.node'
$include = Join-Path $Sdk 'node-v24.22.0\include\node'
$library = Join-Path $Sdk 'node.lib'
& $compiler /nologo /TC /W4 /WX /O2 /GS- /LD "/I$include" "/Fo$object" $source /link /NOENTRY /NODEFAULTLIB /INCREMENTAL:NO "/MACHINE:$Architecture" "/OUT:$binary" $library kernel32.lib
if ($LASTEXITCODE -ne 0) { throw 'Native bootstrap compilation failed' }
$dependencies = & $linker /nologo /dependents $binary
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect bootstrap dependencies' }
$dependencies | Set-Content -LiteralPath (Join-Path $Output 'dependencies.txt') -Encoding utf8
$compilerVersion = (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion
@{ compiler = $compilerVersion; architecture = $Architecture } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Output 'toolchain.json') -Encoding utf8
