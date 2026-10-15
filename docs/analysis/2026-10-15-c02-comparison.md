---
summary: "Confronto C02 delimitato per C20: lettura/modifica senza AI, conteggi statici e contesto storico delle liste."
read_when:
  - "Valutando le misure prima/dopo del criterio 6 di WUL-735."
  - "Distinguendo misure comparabili, contesto storico e dimensioni non misurate."
---

# C02: confronto delimitato del 15 ottobre 2026

Il candidato `31b8d039099c2daca5d2b80ca5ea78e3523e8d12` conserva i controlli del percorso paziente senza AI nei due replay eseguiti. I tempi warm di apertura e salvataggio con rilettura sono vicini alla baseline `47e24f6cf5eea42b34f320d6d675e07fc96bd2a5`; i singoli tempi, anche quando aumentano, sono riportati sotto. Le dipendenze runtime dirette diminuiscono da 33 a 28; le righe fisiche di prodotto, test e tooling aumentano.

Questo rapporto alimenta il **criterio 6 di [WUL-735](https://linear.app/wulfgardr/issue/WUL-735)**: rende leggibile il confronto esistente e i suoi limiti. Non dichiara complete tutte le dimensioni storiche di [C02/WUL-715](https://linear.app/wulfgardr/issue/WUL-715), non riapre C01–C19 e non decide rilascio o uso clinico. Dati e calcoli pubblicabili sono nel [JSON associato](./2026-10-15-c02-comparison.json).

## Protocollo paziente e identità della fixture

Sono riusati due replay baseline PR402 e due replay del candidato. Ogni replay usa 20 pazienti sintetici, 160 voci di diario, 120 osservazioni, 40 documenti e 40 controlli; non rappresentano una distribuzione di pazienti reali. Hardware e ambiente dichiarati sono uguali: Apple M4 Max, 14 core logici, 36 GiB, Darwin 27.2.0 arm64, Node 24.21.0, Chromium 145.0.7632.6, viewport 1280×720.

Il test è [`performance-patient-currentness.spec.ts`](../../e2e/performance-patient-currentness.spec.ts). Cinque iterazioni per replay: la prima visita usa una pagina nuova con server già avviato/autenticato; le quattro successive formano il riepilogo warm. Il tempo di salvataggio include PUT fino alla fine del body, GET applicativo della versione avanzata, completamento delle letture cliniche successive e apertura di un nuovo modulo modificabile, con overhead dell’osservatore. Non è una misura del solo server. Si pubblicano campioni, mediana e intervallo osservato: nessun P95 o budget percentuale è ricavato dopo i risultati.

Gli hash di harness e seed sono cambiati e sono conservati per ciascun replay nel JSON. La riconciliazione della fixture non dichiara identici gli interi schemi:

- Hash logico storico: `e2245c7dfb5a72aa750d41ff3b4714fb7a2e6b2fbb654d98b7dd7f101a5f55ed`.
- Hash logico corrente: `af6ec2fae10d4bf8345aa4f24a337562546fe8998285f17d12776c92c7de4765`.
- Proiezione corrente sulle colonne storiche: `e2245c7dfb5a72aa750d41ff3b4714fb7a2e6b2fbb654d98b7dd7f101a5f55ed`, uguale alla baseline (`matchesHistorical=true`).
- Le quattro nuove colonne utente (`unlock_verifier_hash`, `recovery_wrapped_master_key`, `recovery_salt`, `recovery_verifier_hash`) sono tutte null nella fixture; cambia anche l’ordine delle colonne di observations. Le cardinalità delle otto tabelle confrontate coincidono.

## Tempi warm

Ogni cella è **mediana [min–max] in millisecondi**, su quattro campioni. I replay restano separati; il JSON conserva anche la prima iterazione e tutti i campioni.

| Metrica | Baseline 1 | Baseline 2 | Candidato 1 | Candidato 2 |
| --- | ---: | ---: | ---: | ---: |
| Modulo pronto | 132,010 [129,198–137,041] | 131,779 [129,852–140,967] | 129,996 [128,461–132,188] | 132,543 [129,301–145,698] |
| Salvataggio → fine body PUT | 86,581 [83,152–90,505] | 87,289 [80,201–91,425] | 84,346 [80,682–86,959] | 83,024 [74,717–92,321] |
| Salvataggio → risposta fresca | 33,330 [28,307–40,426] | 35,079 [26,284–38,752] | 36,005 [27,233–40,182] | 35,608 [28,979–41,523] |
| Salvataggio → nuovo modulo fresco | 222,173 [218,843–229,111] | 223,014 [217,676–238,870] | 218,765 [215,049–222,135] | 223,077 [210,161–235,543] |
| Richiesta PUT | 2,456 [2,260–2,722] | 2,593 [2,206–3,102] | 2,731 [2,616–2,925] | 2,736 [2,434–3,063] |

La mediana del modulo pronto è 132,010/131,779 ms nella baseline e 129,996/132,543 ms nel candidato; quella del salvataggio fino al nuovo modulo è 222,173/223,014 e 218,765/223,077 ms. Questo piccolo insieme non dimostra un miglioramento generale né l’assenza di regressioni latenti.

## Avvio e controlli di correttezza

| Replay | Processo → endpoint revisione (ms) | Percorso |
| --- | ---: | --- |
| baseline-1 | 472,152 | `standalone server.js` |
| baseline-2 | 401,094 | `standalone server.js` |
| current-1 | 2.915,421 | `source-runtime` |
| current-2 | 2.914,661 | `source-runtime` |

L’avvio osservato aumenta da 401–472 ms a circa 2.915 ms. La baseline avvia direttamente `server.js`; il candidato passa da `source-runtime`, con il percorso di verifica della sorgente. Il confine misurato è cambiato: non si attribuisce la differenza esclusivamente a una correzione, alla verifica iniziale o al codice applicativo. Un campione per processo non è una distribuzione di cold/warm startup del sistema operativo.

Tutti e quattro i replay hanno stato **PASS**: cinque scritture riuscite, cinque input invalidi rifiutati, cinque replay obsoleti rifiutati, un controllo non autorizzato e cinque controlli del paziente sentinella invariato. Le note cifrate sono rilette nel nuovo modulo. Sono osservate cinque PUT del browser, zero POST di lavoro AI, zero risposte API 5xx e zero richieste API fallite; il processo figlio viene chiuso. Gli abort di navigazione registrati restano distinti dagli errori API e sono contati nel JSON.

Provider non configurati; le richieste sono osservate, non intercettate, e non viene cambiato un kill switch. L’assenza di POST AI nel browser non certifica ogni possibile uscita di rete di processo. Questi controlli non sostituiscono le prove autonome di audit durevole, annullamento, recupero completo, altri negativi e parità fra sistemi.

## Conteggi statici

Stesse regole sui blob Git delle due revisioni: nessuna lettura del database. Le righe fisiche includono commenti e righe vuote; documentazione e asset sono esclusi dal codice. Estensioni, precedenza delle categorie e separazione native/web o condiviso sono nel JSON. SQLite amalgamato e header vendor sono separati come generated/vendor. I file di codice alla radice ricadono per regola in tooling, inclusi alcuni entrypoint applicativi.

| Metrica | Baseline | Candidato |
| --- | ---: | ---: |
| Dipendenze runtime dirette | 33 | 28 |
| Voci runtime lock | 345 | 340 |
| File codice selezionati | 2496 | 2622 |
| Byte codice selezionato | 33226652 | 34601489 |
| Tutti i file tracciati | 3009 | 3194 |
| Tutti i byte tracciati | 50231370 | 52002337 |
| Righe product | 217322 | 223135 |
| Righe test | 177089 | 190256 |
| Righe tooling | 45572 | 48924 |
| Righe generated | 279937 | 279937 |
| Righe deferred | 782 | 782 |

Le dipendenze dirette contano l’unione di dependencies e optionalDependencies del package root. Il lock conta percorsi package non-root, non-dev e non-link, incluse 75 voci opzionali in entrambe le revisioni e duplicazioni annidate: non è il numero di pacchetti installati sulla singola piattaforma. I byte tracciati totali includono documentazione e risorse. Non sono byte del pacchetto distribuito. L’aumento di righe non misura complessità, autorità o raggiungibilità.

## Liste: confronto soltanto contestuale con luglio

La [baseline del 17 luglio](./2026-07-17-baseline-performance.md) usa 200/2.000 pazienti, sette campioni per rotta dopo un warmup escluso, liste HTTP e parsing/decifratura AES simulati in Node; documenti solo metadata. Il replay corrente mantiene cardinalità nominali e protocollo di misura, ma sono cambiati seed/schema e payload, Next.js (storico 16.2.6), Node (24.18.0 → 24.21.0) e OS (27.0.0 → 27.2.0). Non è un esperimento causale né un budget di regressione.

Mediane in ms; byte del payload tra parentesi.

| Pazienti | Lista | HTTP luglio → corrente | Parse/decifra luglio → corrente | Payload luglio → corrente |
| ---: | --- | ---: | ---: | ---: |
| 200 | patients | 5,075 → 4,293 | 11,600 → 12,675 | 229581 → 243981 |
| 200 | entries | 9,284 → 8,233 | 47,980 → 48,144 | 1018401 → 1018401 |
| 200 | observations | 8,205 → 7,019 | 12,741 → 12,832 | 694941 → 694941 |
| 200 | documents | 4,737 → 3,906 | 16,095 → 15,876 | 350283 → 401083 |
| 2000 | patients | 16,435 → 14,921 | 118,780 → 119,465 | 2299401 → 2443401 |
| 2000 | entries | 66,328 → 63,322 | 436,633 → 440,948 | 10184001 → 10184001 |
| 2000 | observations | 57,014 → 54,940 | 135,597 → 128,994 | 6949941 → 6949941 |
| 2000 | documents | 21,523 → 25,198 | 161,275 → 160,624 | 3497020 → 4005020 |

Il trasferimento documenti a 2.000 pazienti passa da 21,523 a 25,198 ms con payload aumentato da 3.497.020 a 4.005.020 byte; il dato resta visibile anche quando peggiora. Non misura ingestione o revisione del documento.

## Dimensioni non determinate e disposizione

**ND** in questo confronto, perché manca una coppia storica/finale comparabile: durata build/test; RSS runtime peak/steady; byte storici del pacchetto; latenza query/proposal headless; ingestione/revisione documenti; tempo di ripristino completo; complessità dei moduli critici, cicli, codice raggiungibile e numero di operazioni autorevoli duplicate. Correttezza funzionale e durata non sono intercambiabili. I conteggi statici non riempiono queste lacune.

Il perimetro misurato e il contesto storico sono ora espliciti per il criterio 6 C20. L’accettazione del residuo resta da registrare in WUL-735: questo rapporto non converte ND in PASS, non completa tutte le dimensioni C02 e non accetta automaticamente C20, la release o l’ammissione clinica.

Provenienza: baseline [PR402](https://github.com/Wulfgardr/mediflow/pull/402), due replay del candidato indicato e dati storici già pubblici. Il JSON riporta hash delle ricevute, identità sorgente/artefatti, protocollo, campioni temporali e metadati di schema; esclude record, credenziali e percorsi locali.
