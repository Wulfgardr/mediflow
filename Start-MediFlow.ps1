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
    Write-Host "  Node.js non trovato nel PATH. Installa Node 20 LTS da https://nodejs.org e riprova." -ForegroundColor Red
    Read-Host "  Premi INVIO per chiudere"
    exit 1
}
$nodeCheck = (& node scripts/launcher-helpers.mjs check-node)
if ($LASTEXITCODE -ne 0) {
    Write-Host "  Attenzione: $nodeCheck" -ForegroundColor Yellow
    Write-Host "  Serve Node 20 LTS (vedi .nvmrc). Con un'altra versione l'install di better-sqlite3 puo fallire." -ForegroundColor Yellow
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
