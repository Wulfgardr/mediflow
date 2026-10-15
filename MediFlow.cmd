@echo off
setlocal
set "MEDIFLOW_ROOT=%~dp0"
powershell.exe -NoLogo -NoProfile -Command "$ErrorActionPreference='Stop'; $candidates=@($env:MEDIFLOW_NODE_BINARY); $cmd=Get-Command node.exe -ErrorAction SilentlyContinue; if($cmd){$candidates+=$cmd.Source}; $candidates+=@((Join-Path $env:ProgramFiles 'nodejs\node.exe')); if($env:NVM_SYMLINK){$candidates+=(Join-Path $env:NVM_SYMLINK 'node.exe')}; foreach($dir in @($env:NVM_HOME, (Join-Path $env:APPDATA 'nvm'))){if($dir){$candidates+=@(Get-ChildItem -Path (Join-Path $dir 'v24.*\node.exe') -ErrorAction SilentlyContinue | ForEach-Object FullName)}}; foreach($dir in @($env:FNM_DIR, (Join-Path $env:APPDATA 'fnm'), (Join-Path $env:LOCALAPPDATA 'fnm'))){if($dir){$candidates+=@(Get-ChildItem -Path (Join-Path $dir 'node-versions\v24.*\installation\node.exe') -ErrorAction SilentlyContinue | ForEach-Object FullName)}}; foreach($node in $candidates){if($node -and (Test-Path -LiteralPath $node)){& $node (Join-Path $env:MEDIFLOW_ROOT 'scripts\launcher-helpers.mjs') check-node *> $null; if($LASTEXITCODE -eq 0){$env:PATH=(Split-Path $node)+';'+$env:PATH; & $node (Join-Path $env:MEDIFLOW_ROOT 'scripts\mediflow.mjs'); exit $LASTEXITCODE}}}; Write-Host 'MediFlow richiede Node 24.x. Installa o attiva Node 24 e riapri questo file.'; exit 1"
set "MEDIFLOW_EXIT=%ERRORLEVEL%"
if not "%MEDIFLOW_EXIT%"=="0" pause
exit /b %MEDIFLOW_EXIT%
