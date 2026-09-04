# @Codex
# MediFlow - one-click launcher (Windows).
# Avvia la web app locale Next.js e apre il browser. Equivalente di
# Start_MediFlow.command (macOS) e scripts/start-mediflow.sh (Linux).
# Se l'apertura con doppio click viene bloccata dalla Execution Policy, eseguire:
#   powershell -ExecutionPolicy Bypass -File .\Start-MediFlow.ps1

$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot

$Port = 3000
$Url = "http://localhost:$Port"
$Helper = Join-Path $PSScriptRoot 'scripts/launcher-helpers.mjs'
$ReadyTimeoutMs = if ($env:MEDIFLOW_LAUNCH_READY_TIMEOUT_MS) { $env:MEDIFLOW_LAUNCH_READY_TIMEOUT_MS } else { '30000' }

Write-Host "==================================================="
Write-Host "   MediFlow - Avvio (Windows)"
Write-Host "==================================================="
Write-Host ""

# --- 1. Node.js ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "  Node.js non trovato nel PATH. Installa Node 24 LTS da https://nodejs.org e riprova." -ForegroundColor Red
    Read-Host "  Premi INVIO per chiudere"
    exit 1
}
$nodeCheck = (& node $Helper check-runtime)
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Runtime Node/better-sqlite3 incompatibile: $nodeCheck" -ForegroundColor Red
    Write-Host "  Usa Node 24, esegui npm ci e riprova. Non usare npm rebuild." -ForegroundColor Red
    Read-Host "  Premi INVIO per chiudere"
    exit 1
}

# @Codex: make the exact checkout identity visible and use it for safe reuse.
$SourceFingerprint = (& node $Helper identity-field sourceFingerprint)
if ($LASTEXITCODE -ne 0 -or -not $SourceFingerprint) {
    Write-Host "  Impossibile determinare l'identita del checkout." -ForegroundColor Red
    exit 1
}
& node $Helper identity-summary
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Impossibile mostrare l'identita del checkout." -ForegroundColor Red
    exit 1
}
Write-Host ""

# --- 2. Ollama (opzionale: funzioni generative locali) ---
if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-Host "  Avvio Ollama..."
        Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden
    } else {
        Write-Host "  Ollama non installato: le funzioni generative locali che lo richiedono non sono disponibili. Installa da https://ollama.com" -ForegroundColor Yellow
    }
}

# --- 3. Stato porta: free / occupied / unknown ---
# @Codex
$portInspection = (& node $Helper inspect-port $Port 2>&1 | Out-String).Trim()
$portParts = $portInspection -split '\|', 3
$portState = if ($portParts.Count -ge 1) { $portParts[0] } else { '' }
$listenerPid = if ($portParts.Count -ge 2) { $portParts[1] } else { '' }
$portReason = if ($portParts.Count -ge 3) { $portParts[2] } else { '' }
if ($portState -notin @('free', 'occupied')) {
    Write-Host "  Impossibile determinare in sicurezza lo stato della porta $Port." -ForegroundColor Red
    Write-Host "  Avvio bloccato ($portReason)." -ForegroundColor Red
    exit 1
}
if ($portState -eq 'occupied') {
    $probeResult = (& node $Helper wait-and-open $Url $SourceFingerprint 5000 250 2>&1 | Out-String).Trim()
    if ($LASTEXITCODE -ne 0) {
        $displayPid = if ($listenerPid) { $listenerPid } else { 'sconosciuto' }
        Write-Host "  Porta $Port occupata dal PID $displayPid, ma l'istanza non corrisponde a questo checkout." -ForegroundColor Red
        Write-Host "  Riuso negato senza arrestare alcun processo ($probeResult)." -ForegroundColor Red
        exit 1
    }
    $displayPid = if ($listenerPid) { $listenerPid } else { 'sconosciuto' }
    Write-Host "  MediFlow $SourceFingerprint e gia attivo su $Url (PID $displayPid)."
    Write-Host "  Verifica endpoint: $probeResult"
    exit 0
}

# --- 4. Avvio server + apertura browser dopo readiness esatta ---
# @Codex: a free-port race or a mismatched server must never open the browser.
$readinessJob = Start-Job -ScriptBlock {
    & node $using:Helper wait-and-open $using:Url $using:SourceFingerprint $using:ReadyTimeoutMs 250
}

Write-Host ""
Write-Host "  URL: $Url"
Write-Host "  Premi CTRL+C per arrestare."
Write-Host ""
$env:MEDIFLOW_APP_SOURCE_FINGERPRINT = $SourceFingerprint
$env:MEDIFLOW_APP_FINGERPRINT = $SourceFingerprint
$npmExitCode = 1
try {
    npm run dev
    $npmExitCode = $LASTEXITCODE
} finally {
    if ($readinessJob) {
        Stop-Job -Job $readinessJob -ErrorAction SilentlyContinue
        Remove-Job -Job $readinessJob -Force -ErrorAction SilentlyContinue
    }
}
exit $npmExitCode
