# Prove locali prima del rilascio

Eseguire `npm run prove:a-mano` su un Mac con Node 24 e Xcode-beta.
Il comando esegue le prove in sequenza e stampa la cartella temporanea con
`esito.md`, `esito.json` e i log. Allegare i due esiti alla scheda del rilascio.
Codici di uscita: 0 tutto provato, 1 almeno un fallimento, 2 copertura incompleta.
Un test saltato rende incompleta la prova, anche con uscita zero della suite.
Le evidenze restano sul disco per essere allegate.

Il comando rifiuta qualsiasi MEDIFLOW_DATA_DIR fornito dal chiamante, comprese
le varianti dell'archivio reale e i collegamenti simbolici. Crea il proprio
archivio vuoto con marcatore SYNTHETIC_ONLY, disabilita la copia legacy ed elimina
le variabili ereditate dai figli. Rifiuta porte 3000 e 3443 del runtime nativo
(HomeBaseRuntimeSupervisor.swift), 11434 e 11435 dei provider. Non usa Ollama.
La qualifica visiva crea a sua volta un archivio proprio e una porta effimera.

## Censimento Q-8

Fonti: matrice 0.9.1 v6, Q-8 D1/D3 e censimento skip del 9 novembre,
ricontrollati nei sorgenti al momento dell'implementazione.

| Gruppo | Prove incluse o limite |
|---|---|
| Apple Vision | anydoc-apple-vision-ocr, anydoc-ocr-acceptance, anydoc-current-source-composition |
| OCR desktop | anydoc-desktop-ocr-real forza MEDIFLOW_TEST_TESSERACT_REAL |
| Motore dati personali | gliner-redaction-runner: protocollo, sandbox e rifiuto pesi alterati. Non misura la qualità del modello |
| Voce locale | local-voice: contratto e doppio sintetico Swift. Whisper reale resta WUL-828 |
| Contenitore Mac | execution-mac-probe: confini del processo sintetico |
| Archivio Mac | backup-destination-policy e native-patient-document |
| Registrazione | run-visit-recording-synthetic-benchmark: corpus sintetico e ricevuta Swift, richiede macOS 26 e risorse Speech italiane |
| Aspetto 0.9.1 | qualify-visual-091 con browser sandbox e rete loopback |
| Identità UI | non provato: web-regression è vincolato al vecchio banco /Volumes/Vision e reference.json |

Gli skip di iPad D2, paired host, WHO, plugin installati, esecuzione di sorgenti
Mac esterni, runtime redaction installer e prove Rust sperimentali restano nel
censimento Q-8 e non diventano qualificati da questo comando. Non sono le prove
D1/D3 scelte per questa lane. check-standalone-runtime-bundle controlla anche i vincoli Mac del runtime distribuito
ed è incluso nel comando. VisitRecordingCaptureTests esercita la cattura sintetica Swift.

## Aggancio WUL-828

Aggiungere una voce a `catalog(output)` in `scripts/prove-a-mano.mjs` sostituendo
`voce-whisper-wul-828`. La voce espone `id`, `command` come array senza shell e
`unavailable()` che restituisce il motivo quando mancano modello o strumenti.
Usare solo audio sintetico e l'ambiente isolato fornito dal runner. Non avviare
servizi sulle porte riservate. Uscita diversa da zero significa fallimento;
un prerequisito assente deve essere dichiarato prima dell'avvio. Non scaricare
modelli e non aprire il microfono nel controllo preliminare.
