# 0173: Preparazione SQLite con impronte fissate

Stato: accettato per implementazione, qualifica Windows affidata alla CI.

## Problema

Gli script npm delle dipendenze possono scaricare codice fuori dal tarball
coperto dall'integrity del lockfile. Il launcher non deve caricare quel codice
senza un'impronta ammessa dal progetto.

## Decisione

La configurazione npm disabilita tutti gli install script. Dopo npm ci,
prepare:dependencies scarica soltanto il prebuild ufficiale better-sqlite3
12.6.2 per Node 24 ABI 137. Archivio e binario devono corrispondere agli SHA-256
in node-runtime-contract.mjs prima di scrivere il binario o caricare SQLite.
Gli hash sono stati rilevati dagli asset della release WiseLibs/better-sqlite3
v12.6.2. Questo fissa i byte ammessi dal progetto, senza attestare una build
riproducibile o una firma del produttore.

Sono ammessi macOS x64/ARM64, Windows x64/ARM64 e Linux glibc/musl x64/ARM64.
La selezione usa l'architettura di Node: su Windows ARM con Node x64 emulato
si usa win32-x64. Non esiste compilazione o download alternativo implicito.

Gli script di esbuild 0.18.20 e 0.25.12, fsevents 2.3.2 e 2.3.3,
unrs-resolver 1.11.1 e core-js 3.47.0 restano disabilitati. I binari opzionali
esbuild e resolver provengono dai tarball coperti dal lockfile. Non viene
ammesso alcuno script di dipendenza. Build, dev e start includono direttamente
i controlli prima affidati ai lifecycle npm, disabilitati dalla stessa opzione.
CI e Docker eseguono esplicitamente la preparazione.

Il controllo preliminare del launcher e della build verifica di nuovo il
binario prima del require. I bundle rilocati mantengono il proprio controllo
di ammissione tramite roster; questa modifica non ne sostituisce il contratto.

## Conseguenze

Dopo npm ci manuale occorre npm run prepare:dependencies. Serve accesso HTTPS
al registro npm e agli asset GitHub per la prima preparazione. Un aggiornamento
di SQLite richiede nuovi hash, review e prove per i target ammessi. Gli override
che riabilitano gli script npm escono da questo percorso supportato.
