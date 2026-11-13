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
| Voce locale | local-voice: contratto e guardia contro il motore Apple |
| Ascolto della visita | prove-ascolto-visita: modello whisper installato, visita inventata di oltre dieci minuti a due voci generata con `say`. Attribuzione su almeno l'80% del parlato, calcolo sotto il tempo reale, errore di parola nel rapporto (si ferma sopra il 20%) |
| Microfono vero | non provato: richiede la voce di Leonardo, elenco qui sotto |
| Contenitore Mac | execution-mac-probe: confini del processo sintetico |
| Archivio Mac | backup-destination-policy e native-patient-document |
| Aspetto 0.9.1 | qualify-visual-091 con browser sandbox e rete loopback |
| Identità UI | scripts/ui-identita/prova.mjs: banco sintetico temporaneo sul disco interno, porte libere, solo loopback; web-regression nei quattro progetti, senza skip |

Gli skip di iPad D2, paired host, WHO, plugin installati, esecuzione di sorgenti
Mac esterni, runtime redaction installer e prove Rust sperimentali restano nel
censimento Q-8 e non diventano qualificati da questo comando. Non sono le prove
D1/D3 scelte per questa lane. check-standalone-runtime-bundle controlla anche i vincoli Mac del runtime distribuito
ed è incluso nel comando.

## C-B: qualità del redattore con i pesi reali

La voce `redazione-protocollo` non esegue questa misura. Sul Mac, con un Python
e un modello già installati, eseguire separatamente:

```bash
nice -n 19 node scripts/run-strip-types.mjs scripts/measure-cb-redaction.ts --python /percorso/venv/bin/python --model /percorso/model --out /percorso/nuovo-esito.json
```

Il comando non scarica pesi, non legge archivi clinici e non invia dati.
Usa il worker della repository in sandbox senza rete, con quattro thread di
inferenza. Il worker verifica pesi e dipendenze prima di dichiarare l'identità
osservata. Il JSON lega questa identità ai digest del corpus e dei sorgenti,
riporta input, rilevamenti, residui esatti e tempi; la tabella stampa attesi,
fermati e sfuggiti per famiglia. Il file di uscita deve essere nuovo.

Il [corpus sintetico annotato](../../scripts/fixtures/cb-redaction-acceptance.json)
contiene 36 casi e 43 identificativi. Si contano le occorrenze con offset UTF-16;
nei nomi file si annota il basename identificante, senza estensione. Un residuo
leggibile anche parziale conta come sfuggito. Soli spazi o caratteri Unicode di
formato rimasti visibili non identificano; `fullyCovered` conserva anche questa
distinzione. Le annotazioni non sono fornite al runner.

La misura applica il runner reale più la sessione di redazione condivisa e,
separatamente, la preparazione clinica usata dalla scheda chat con il controllo
sul payload serializzato. I campi ignoti sono inseriti anche nel profilo clinico:
il suo schema li deve rifiutare. Un errore del runtime è **non provato**, senza
contarlo come identificativo fermato. Tre controlli privi di identificativi
rivelano un eventuale rifiuto indiscriminato o una perdita del testo clinico.

Il [risultato del 13 novembre 2026](./cb-redaction-20261113.json) è rosso:

| Famiglia | Attesi | Redattore: fermati | Sfuggiti | Scheda: fermati | Sfuggiti |
| --- | ---: | ---: | ---: | ---: | ---: |
| CF OCR | 6 | 4 | 2 | 6 | 0 |
| Terze persone | 7 | 7 | 0 | 7 | 0 |
| Luoghi | 5 | 3 | 2 | 3 | 2 |
| Nascita | 8 | 8 | 0 | 8 | 0 |
| Nomi file | 5 | 5 | 0 | 5 | 0 |
| Campi ignoti | 5 | 3 | 2 | 5 | 0 |
| Identità nota | 3 | 3 | 0 | 3 | 0 |
| Contatti | 4 | 2 | 2 | 4 | 0 |
| **Totale** | **43** | **35** | **8** | **41** | **2** |

Tempo: 75,279 s, uscita 1. Il caso `luogo-04`, «Trasferita da Valleverde
Inventato a Rocca Sintetica», conserva entrambi i luoghi nella preparazione
clinica e nel suo payload serializzato. Gli altri difetti aperti riguardano
`cf-04`, `cf-06`, `ignoto-02`, `ignoto-04`, `contatto-02` e `contatto-03`;
il JSON conserva ogni identificativo e frammento residuo. Nessuno è corretto
in questa tranche. I tre controlli clinici sono preparati integri dalla scheda;
il redattore condiviso li oscura invece come persone.

Controllo negativo, con gli stessi casi e le stesse regole locali, togliendo
la sola componente neurale:

```bash
nice -n 19 node scripts/run-strip-types.mjs scripts/measure-cb-redaction.ts --negative-control --out /percorso/nuovo-negativo.json
```

Risultato: 33 sfuggiti su 43, uscita 1. I cinque test della misura verificano
conteggi, offset, copertura parziale, residui invisibili e controllo negativo;
sono registrati nella suite unit. Questi test non qualificano i pesi.

Il criterio zero falsi negativi non è raggiunto. Il dato riguarda questo corpus
e questi pesi: non qualifica consenso, governance del broker, invio, desktop,
canali osservati, equivalenza clinica o dati reali. Non viene scritta alcuna
ammissione all'uscita. Il processo che riceve una chat non viene avviato.

## Ascolto della visita (WUL-828)

`ascolto-visita-modello` lancia `scripts/prove-ascolto-visita.mjs` con i due file
del modello installato da Impostazioni, Voce locale (nella HOME vera: il runner
isola HOME). Genera con `say` la visita inventata di
`scripts/fixtures/visita-due-voci.json` (122 battute, 11 minuti), la passa al test
Rust ignorato `real_model_long_session_in_segments` a blocchi come il microfono e
controlla durata, attribuzione e tempo di calcolo. Scrive `rapporto.json` con
errore di parola (regola del banco voce), tempi, memoria e quota del parlato
attribuita alla persona giusta, nella cartella temporanea della prova. Non scarica nulla e non apre il
microfono. Senza macOS, cargo o modello la voce è dichiarata non provata prima
dell'avvio.

`ascolto-visita-microfono` resta non provata: va fatta a mano, con il microfono
del Mac e la voce di Leonardo, nella seconda seduta.

1. Dettatura: «Consenti e avvia», la forma diventa un cerchio pieno, la parola
   «In registrazione», il tempo scorre. «Termina e trascrivi» porta a «Ferma».
2. Pausa e ripresa: in pausa due barre, tempo fermo, indicatore arancione del
   microfono di macOS spento. Alla ripresa il tempo riparte da dove era.
3. Microfono staccato a metà (cuffia Bluetooth o USB): «Errore» entro due
   secondi, nessuna registrazione dopo, testo fin lì da rivedere.
4. Permesso negato in Impostazioni di Sistema: «Errore» con il percorso per
   abilitarlo.
5. Ascolto della visita con una seconda persona: righe «Medico:» e «Paziente:»,
   «Scambia medico e paziente», nomi dei farmaci proposti, bozza preparata solo
   con il gesto e mai salvata da sola.
6. Visita oltre 20 minuti: la revisione riceve tutto il testo.
