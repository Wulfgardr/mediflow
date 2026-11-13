# Misure locali del 13 novembre 2026, WUL-840

C-L e I-2 restano aperte. L'ammissione puntuale di Ollama 0.40.16 è provata;
Quadro paziente e Import assistito producono proposte sul percorso HTTP reale,
ma il confronto indipendente supera i budget provvisori. La sintesi offline
si ferma all'estrazione. Il registro conserva queste differenze e non ammette
il runtime o l'uso clinico sulla base di questi dati.

Candidato originale `8954e9c97b4ea2016c20c8433b43ee0f5231607a`.
Host production costruito da `3e8455fe40243a0c45e471529058442946afc451`,
con la sola ammissione di versione, i relativi test e ADR 0136 (PR #990).
BUILD_ID `NmIerDyBXlBB2GyyVfbt0`. Mac17,10, Apple M5 Max, 48 GB,
macOS 27.3 build 26C5035r, Node 24.22.3. Nessuna prova a schermo.

Modello installato `qwen3.5:35b-a3b`, digest
`26025611beeb3fe9e4850b1fdae686bebba7cdfa7f13ddb04955f19872ee022a`,
safetensors nvfp4 su MLX. Il modello del 31 ottobre con digest `3460ffee...`
era GGUF Q4_K_M su ggml: stesso alias, artefatti diversi. Quello attuale
coincide con WUL-832. Nessun modello cambiato o scaricato in questo lavoro.

## C-L sui percorsi del prodotto

Il banco usa controller e API autenticate, archivio cifrato sintetico,
selezione server, ammissione e dispatch reali. Le API attraversano i broker
di produzione. Il primo scenario ha 100 eventi, 30 terapie tutte attive con
nomi sintetici indicizzati e 10 documenti. Il Quadro applica la minimizzazione
canonica a 12 eventi e 12 terapie. Il risultato descrive questa fixture di
stress, senza stimare la qualità clinica o gli errori nell'uso ambulatoriale.
I due PDF sono ciascuno di 10 pagine e 10 MiB; sono aggiunti come fonti
singole selezionate, dopo il primo scenario. I percentili includono tutti
gli esiti, con rango superiore. Un timeout non si elimina dal denominatore.

| Scenario | Stato | n | p50 s | p95 s | Max s | Errori | Timeout |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| load-100-30-10 | cold | 30 | 43.714 | 61.932 | 66.100 | 11 | 0 |
| load-100-30-10 | warm | 30 | 11.410 | 24.278 | 25.532 | 13 | 0 |
| pdf-scan-10p-10MiB | cold | 30 | 0.970 | 1.009 | 1.009 | 30 | 0 |
| pdf-scan-10p-10MiB | warm | 30 | 0.968 | 1.099 | 1.104 | 30 | 0 |
| pdf-text-10p-10MiB | cold | 30 | 0.904 | 0.959 | 0.987 | 30 | 0 |
| pdf-text-10p-10MiB | warm | 30 | 0.959 | 1.014 | 1.042 | 30 | 0 |

Tutti gli errori del Quadro sono `proposal_invalid`. I PDF sono negati con
`unsupported_local_extraction`, prima dell'inferenza. L'estrattore applica
una propria sandbox; annidarla nella sandbox loopback del server fallisce
su macOS. Lo stesso PDF testuale piccolo viene estratto senza la sandbox
esterna e negato con essa. Anche il PDF testuale da 10 MiB è estraibile
nel controllo separato; quello scansionato restituisce una mappa di dieci
pagine che richiedono OCR. Non si rimuove la sandbox per dichiarare I-2 riuscita.

I 62 campioni PDF inizialmente etichettati caldi, con warmup, non avevano
stabilito la residenza del modello e restano diagnostici nel JSON.
I gruppi caldi in tabella sono nuovi campioni con modello precaricato e
digest verificato prima di ogni richiesta. Nessun esito precedente è cancellato.
Con soglia zero errori non si qualifica alcuno di questi gruppi.

## I-2 e budget provvisori

La prima esecuzione completa usa un caso piccolo, distinto dal carico C-L.
I budget sono quel singolo valore più il 20%, arrotondato per eccesso.
Non sono budget qualificati delle funzioni. Il secondo caso completo è
una verifica successiva, non viene usato per allargare la baseline.

| Funzione | Baseline ms | Budget ms | Verifica ms | Entro budget |
| --- | ---: | ---: | ---: | --- |
| patient_insight | 3172.322 | 3807 | 10966.626 | no |
| smart_import | 3339.741 | 4008 | 6731.439 | no |

Gli errori intenzionali di input sono negati. Gli annullamenti PI/SI sono
avvenuti con preview pendente e chat locale attiva. Il lock autenticato
restituisce `server_invalidation_confirmed` e le preview finali sono negate
con `401 session_stale`. Quelle inferenze terminano dopo il lock: l'arresto
fisico non è provato. Per DS mancano proposta, annullamento e revoca durante
inferenza, perché l'estrazione non arriva al modello.

## Redattore da 10.000 caratteri

Il banco del componente chiama GLiNER e `createRedactionSession` reali,
controlla l'identità del runner e il round trip. Non misura il broker completo,
il consenso o la latenza percepita. Il worker di produzione ha la propria
sandbox senza rete; il client non applica una seconda sandbox al worker.
Il daemon Ollama e l'host production sono attivi, con Qwen non residente.

| Stato | n | p50 s | p95 s | Max s | Errori | Budget componente ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| cold | 30 | 13.583 | 14.303 | 14.352 | 0 | 17164 |
| warm | 30 | 3.883 | 4.473 | 4.492 | 0 | 5368 |

Picco RSS dell'intero banco: 6580617216 byte; budget
del solo componente: 7896740660 byte. Campionamento ogni
500 ms, host, client, daemon e tutti i discendenti, senza filtro per nome.

Il RSS non comprende tutta la memoria GPU unificata di MLX e non è un picco
continuo. I budget globali e il budget DS restano nulli. Le tre celle ChatGPT,
GPUI, chat desktop e qualità clinica restano non provate da questo banco.

## Dati e riproduzione

`measurements.json` e `component.json` contengono soli campioni numerici,
esiti e metadati. Metodo e fixture sono fissati nei file accanto. Output del
modello, PDF, archivi e log grezzi restano nel dossier esterno della misura.
I banchi sono `scripts/measure-local-paths.mjs`, `measure-local-interventions.mjs`,
`measure-local-load.mjs` e `measure-local-redactor.ts`. Richiedono un host
standalone già costruito, un archivio sintetico esplicito e un dossier fuori
dalla repository. Le sonde esterne falliscono EPERM nelle sandbox di processo.
Non sono stati modificati DNS, VPN, firewall o rotte.

Il test `local-measurement-register.test.ts` ricalcola percentili e budget,
lega le tre celle alle identità e alle prove, conserva i dinieghi e rifiuta
qualifiche o budget inventati. Il verde del test attesta l'integrità dei dati,
non il superamento del contratto del prodotto.

Sviluppo assistito: GPT-6.1 Sol, effort xhigh, senza delega.
