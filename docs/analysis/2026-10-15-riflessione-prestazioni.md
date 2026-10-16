---
summary: "Riflessione sulle prestazioni di MediFlow 0.9.0 col metodo di How we made claude.ai faster: percorsi, misure, priorita' e protezioni."
read_when:
  - "Scegliendo il prossimo intervento sulle prestazioni o valutandone l'effetto."
  - "Aggiungendo una metrica o una soglia di prestazione alla CI."
---

# Prestazioni di MediFlow: dove si perde tempo e come recuperarlo

Data: 15 ottobre 2026. Base: `origin/main` a `c382cd940` (release 0.9.0) con la
correzione Ollama della PR #524. Guida di metodo:
[How we made claude.ai faster](https://claude.dev/blog/how-we-made-claude-ai-faster/).

## In breve

1. **I lanciatori ordinari avviano MediFlow in modalità sviluppo.**
   `Start_MediFlow.command` (riga 181) e `Start-MediFlow.ps1` (riga 98)
   eseguono `npm run dev`, cioè `next dev --turbopack`. Sulla scheda paziente
   questo significa da 4 a 5 volte il JavaScript della build di produzione,
   React in modalità sviluppo e la compilazione di ogni pagina al primo accesso.
   È l'intervento con il rapporto più alto fra guadagno e lavoro.
2. **Aprire una scheda costa circa 40 richieste**, con letture ripetute dello
   stesso dato: osservazioni quattro volte, terapie e paziente tre, allegati due
   (completi di contenuto), interruttori AI letti uno per uno e due volte.
3. **Due sondaggi indipendenti ogni 15 secondi** (`/api/system/revision` e
   `/api/auth/check`) restano attivi per tutta la sessione a scheda visibile.
4. Le funzioni AI locali hanno tempi propri: il primo caricamento del modello
   richiede circa 20 secondi, una proposta del Quadro paziente circa 5 secondi.
   Sono attese da rendere leggibili, non da nascondere.

Niente di questo tocca sicurezza, cifratura o audit. Gli interventi proposti non
riducono KDF, controlli di validità o registrazioni.

## Il metodo, adattato a MediFlow

Il post descrive un ciclo che funziona anche qui, con due differenze: MediFlow
gira su un solo computer e non ha telemetria esterna.

- **Pochi percorsi, misurati dall'azione al risultato visibile.** Non il tempo
  di una route, ma il tempo che il medico aspetta.
- **Una stima in millisecondi per ogni intervento**, sommata per percorso, per
  scegliere l'ordine e sapere quando fermarsi.
- **Metriche deterministiche in CI** che seguono il tempo reale ma non ne hanno
  il rumore: conteggi di richieste, righe lette, byte, decifrature, render.
  Ogni metrica va prima confrontata col tempo misurato; se non lo segue, si
  toglie.
- **Soglie che possono solo scendere.** Una PR che le alza fallisce; dopo un
  miglioramento la soglia si abbassa.
- **Verifica dopo il rilascio**, qui solo locale e su consenso.
- **Gusto umano sui compromessi visibili.** Due millisecondi non valgono
  novecento righe.

## Percorsi e misure di oggi

Misure del 15 ottobre 2026 su Mac16,5 (Apple M4 Max, 36 GiB), Node 24.21.0,
build di produzione `next start` con 40 pazienti sintetici
(`scripts/seed-performance-baseline.mjs`), salvo dove indicato. Sono
osservazioni singole, non p75: servono a ordinare il lavoro, non a promettere
risultati.

| Percorso | Inizio | Fine | Oggi |
| --- | --- | --- | --- |
| Avvio | doppio clic sul lanciatore | elenco pazienti filtrabile | non misurato end to end; il lanciatore usa la modalità sviluppo |
| Sblocco | conferma PIN o passphrase | prima schermata clinica | KDF 100.000/600.000 iterazioni (PIN), 2.000.000 (passphrase): obiettivo sotto il secondo ancora da qualificare (ADR 0143) |
| Scheda | clic sul paziente | identità e quadro leggibili | produzione: primo byte 75 ms, DOM pronto 91 ms, 1,7 MB di JS; circa 40 richieste |
| Diario | Registra | voce salvata e visibile | transazione unica con audit; non misurato |
| Farmaci | ultimo carattere | risultati AIFA selezionabili | debounce 300 ms più ricerca SQLite |
| Analisi | cambio fascia d'età | indicatori aggiornati | scarica e decifra tutti i pazienti, poi filtra in locale |

Confronto sulla scheda paziente, stessi dati:

| Modalità | Primo byte | DOM pronto | JavaScript |
| --- | ---: | ---: | ---: |
| `next dev`, primo accesso | 1.390 ms | 1.401 ms | 9.516 KB |
| `next dev`, ricarica | 150 ms | 165 ms | 6.889 KB |
| `next start`, ricarica | 75 ms | 91 ms | 1.668 KB |

La [baseline del 17 luglio](./2026-07-17-baseline-performance.md) resta il
riferimento per le liste globali: a 2.000 pazienti `entries` trasferisce
9,7 MiB e parsing più decifratura simulata richiedono circa 437 ms.

## Interventi, in ordine

Le stime sono ipotesi di lavoro evitabile, da ricalibrare con le misure. Non si
sommano fra percorsi diversi.

| Priorità | Intervento | Dove | Stima |
| --- | --- | --- | ---: |
| P0 | Lanciatori in produzione: build una volta per revisione, poi `next start` standalone; ricostruzione solo se cambia il fingerprint | `Start_MediFlow.command`, `Start-MediFlow.ps1`, `scripts/source-runtime.mjs` | da 75 ms a oltre 1 s per pagina, e 5 MB di JS in meno |
| P0 | Allegati: solo metadati nelle liste, contenuto su richiesta | scheda, `components/document-upload.tsx`, API attachments | 80–300 ms |
| P0 | Una lettura per dominio nella scheda, condivisa dai figli | `app/patients/[id]/modules/page.tsx`, `lib/db.ts` | 10–60 ms e 15–20 richieste |
| P0 | Osservazioni filtrate dal server per paziente | `components/observation-manager.tsx` | 30–140 ms |
| P0 | Sezioni montate alla prima apertura, poi conservate | `collapsible-section.tsx` | 30–120 ms |
| P1 | Un solo sondaggio di stato (revisione e sessione insieme) | `components/app-revision-guard.tsx`, `components/security-provider.tsx` | metà delle richieste periodiche |
| P1 | Interruttori AI in una sola lettura | impostazioni AI | 4–8 richieste per scheda |
| P1 | Elenco pazienti compatto, ricerca e paginazione | API pazienti, cockpit | 40–200 ms |
| P1 | Checkup limitati alla finestra dell'agenda | cockpit, API checkup | 10–80 ms |
| P1 | Invalidazione per record, non per tabella | `lib/live-query-scope.ts`, `lib/db.ts` | 10–60 ms |
| P1 | Indici compositi verificati con `EXPLAIN QUERY PLAN`, indice ATC | `lib/sqlite-schema.ts` (nuova versione di schema) | 2–40 ms |
| P1 | Debounce AIFA da 300 a 150 ms, cancellazione invariata | `components/drug-autocomplete.tsx` | 150 ms percepiti |
| P2 | Analisi su una proiezione minima | API pazienti, `lib/patient-analytics.ts` | 20–120 ms |
| P2 | Editor: stato isolato, meno scansioni HTML a ogni tasto | `components/clinical-rich-text-editor.tsx` | 3–20 ms per tasto |
| P2 | Attese AI leggibili: caricamento del modello separato dalla generazione | onboarding locale, pannelli Fabric | percepito |

Prima di ogni ottimizzazione servono i test che ne fissano il comportamento:
due pazienti, documenti pesanti, cancellazioni, versioni concorrenti, stesso
contenuto e isolamento fra pazienti dopo la modifica.

## Protezioni da aggiungere

- `e2e/performance-journeys.spec.ts`: i percorsi sopra su build di produzione,
  fixture fissa, tempi registrati e, soprattutto, conteggi deterministici:
  richieste per percorso, richieste duplicate, byte JSON e JS per route,
  decifrature, righe SQLite lette.
- `scripts/performance-budgets.mjs`: soglie versionate per quei conteggi.
  Superarle blocca la PR; un job le abbassa dopo un miglioramento ripetibile.
  Si aggancia alla CI E2E standalone già esistente.
- Misure di campo solo locali e su consenso: buffer limitato, p75 per percorso
  e versione, nessun identificativo, nessun contenuto clinico, nessun SQL;
  esportazione solo esplicita.

## Cosa non fare

- Non abbassare le iterazioni KDF, non saltare audit o controlli di validità.
- Non introdurre cache di dati clinici decifrati oltre la sessione.
- Non ottimizzare prima di avere la metrica che lo dimostra.

## Limiti di questa riflessione

Una sola macchina veloce, 40 pazienti, poche ripetizioni, nessuna misura p75 e
nessun percorso di avvio misurato end to end. L'analisi del codice è di Astra
(GPT-6, sola lettura); le misure dal vivo e la sintesi sono di Claude.
