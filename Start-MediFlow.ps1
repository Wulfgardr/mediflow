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
$nodeCheck = (& node scripts/launcher-helpers.mjs check-runtime)
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Runtime Node/better-sqlite3 incompatibile: $nodeCheck" -ForegroundColor Red
    Write-Host "  Usa Node 24, esegui npm ci e riprova. Non usare npm rebuild." -ForegroundColor Red
    Read-Host "  Premi INVIO per chiudere"
    exit 1
}

# --- 2. Ollama (opzionale: AI/OCR locale) ---
if (-not (Get-Process ollama -ErrorAction SilentlyContinue)) {
    if (Get-Command ollama -ErrorAction SilentlyContinue) {
        Write-Host "  Avvio Ollama..."
        Start-Process ollama -ArgumentList 'serve' -WindowStyle Hidden
    } else {
        Write-Host "  Ollama non installato: AI e OCR locali disattivati. Installa da https://ollama.com" -ForegroundColor Yellow
    }
}

# --- 3. Porta gia occupata? ---
$listenerPid = (& node scripts/launcher-helpers.mjs port-listener $Port)
if ($listenerPid) {
    Write-Host "  MediFlow risulta gia attivo su $Url (PID $listenerPid). Apro il browser sull'istanza esistente."
    & node scripts/launcher-helpers.mjs open $Url
    exit 0
}

# --- 4. Avvio server + apertura browser ---
$helper = Join-Path $PSScriptRoot 'scripts/launcher-helpers.mjs'
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 5
    & node $using:helper open $using:Url
} | Out-Null

Write-Host ""
Write-Host "  URL: $Url"
Write-Host "  Premi CTRL+C per arrestare."
Write-Host ""
npm run dev
