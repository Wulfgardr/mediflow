# @Codex: thin, explicit WHO host launcher. No elevation or execution-policy change.
param(
    [Parameter(Position = 0)]
    [ValidateSet('setup', 'status', 'qualify', 'start')]
    [string]$Action = 'setup'
)
$ErrorActionPreference = 'Stop'
try {
    $Node = (Get-Command node -CommandType Application -ErrorAction Stop).Source
    & $Node -e 'process.exit(process.versions.node.split(".")[0] === "24" ? 0 : 1)'
    if ($LASTEXITCODE -ne 0) { throw 'node24' }
} catch {
    [Console]::Error.WriteLine('Serve Node.js 24 nel PATH. Seleziona il runtime previsto e riapri Setup_WHO.ps1; nessuna installazione automatica.')
    exit 1
}
& $Node (Join-Path $PSScriptRoot 'scripts/who-local-onboarding.mjs') $Action
exit $LASTEXITCODE
