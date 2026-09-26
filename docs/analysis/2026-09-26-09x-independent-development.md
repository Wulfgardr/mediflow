# Future 0.9.x: prima tranche indipendente sviluppata

26 settembre 2026. Baseline `6c212221a98f9b8e45cc1d243226d0adb41770bd`.
**Candidati locali verificati su dati sintetici; nessuna issue dichiarata chiusa.**
Questa tranche contiene strumenti eseguibili, una demo navigabile e ricerca
tracciabile. Non è integrata nel core 0.9.0, non cambia il database e non pubblica
release, PR o aggiornamenti di Linear.

## Coordinamento e selezione

Il task «Completa 0.8.6 e avvia 0.9.0» mantiene C00–C20 e l'integrazione del
prodotto. Questo task sviluppa i pezzi delle patch successive che possono essere
provati senza quel confine ancora in costruzione. Ogni implementazione ha una
issue già esistente, un branch e un worktree dedicato; il worktree collettore
`mediflow-09x-independent-20260926` serve al riesame, non sostituisce le lane.

Il censimento Linear del 26 settembre copre 78 issue in sette progetti,
tutte in Backlog al momento della lettura. Le descrizioni dell'elenco possono
essere troncate: per le scelte anticipate sono state lette le issue complete.
Le direzioni 739–742, 745 e 747 erano già accettate dal proprietario il 21
settembre; i loro requisiti di evidenza restano applicabili.

| Patch | Issue censite | Lavoro anticipato consegnato | Dipendenza mantenuta |
| --- | ---: | --- | --- |
| 0.9.1 | 14 | WUL-738: matrice candidata del delta regolatorio. | WUL-574 richiede WUL-735; poi la sequenza dei servizi/registri/command fino a WUL-573. Il protocollo preparato non è un'autorità runtime. |
| 0.9.2 | 8 | Nessuna migrazione in questo task; ricerca Rust/GPUI isolata assegnata a un altro task. | WUL-706 richiede il confine provato da WUL-573/580 e la qualifica 0.9.0. Rust/IPC prematuri codificherebbero un contratto non accettato. |
| 0.9.3 | 13 | WUL-739: accesso/correzione simulati; WUL-740/742: demo di revisione; WUL-741: proiezione follow-up. | Nessuna delle demo sostituisce WUL-585/587/588 o un comando clinico autorizzato. |
| 0.9.4 | 10 | WUL-743: corpus di sviluppo e verifica delle citazioni. | WUL-603–609, corpus clinicamente rivisto e valutazione del modello restano necessari. |
| 0.9.5 | 9 | WUL-744: fonti/profili e verifica cache; WUL-745: riepilogo sintetico con mappa IPS candidata. | Nessun connector F0–F4, token, FSE o ingestion qualificati. |
| 0.9.6 | 16 | Inventario di riuso Mini e dei target, riportato sotto. | L'assenza di `blockedBy` in WUL-694/696 non elimina i prerequisiti espressi WUL-589/629/632/710. |
| 0.9.7 | 8 | WUL-747: analisi descrittiva sintetica ripetibile. | WUL-624/597 e le singole dipendenze continuano a precedere i piloti con effetti esterni. |

## Codice eseguibile e limiti

Usare **Node 24**, come nel contratto del progetto. Non servono credenziali,
modelli, database o pacchetti aggiuntivi per la suite dei prototipi:

```bash
node scripts/check-09x-prototypes.mjs
```

| Issue | Artefatto / comando dalla radice | Comportamento verificato | Ciò che manca per il prodotto |
| --- | --- | --- | --- |
| WUL-739 | `node scripts/patient-rights-dry-run.mjs` | Due percorsi: selezione per accesso e correzione proposta con originale preservato; identità, perimetro, terzi, versione paziente e versioni/date delle fonti. Errori senza valori dei campi. 9 test. | Policy adottata, identità/autorizzazione reali, perimetro completo di export/backup/conservazione e Application Service accettato. Nessun purge. |
| WUL-740/742 | [Demo di revisione](../../prototypes/longitudinal-review/index.html) | Due casi inventati, confronto storico/riferito/ignoto, bozza, fonte aggiornata, conflitto, errore, annullamento/ripristino. Stato separato per caso in memoria. 5 test del modello e prova browser. | Valutazione indipendente di un medico, misure sul flusso attuale, assistive technology e integrazione nel comando nominato. Nessuna prescrizione o secondo archivio terapie. |
| WUL-741 | `node scripts/synthetic-followup-projection.mjs` | Fasi esplicitamente documentate, evidenze mancanti, scadenza, presa in carico confermata e proposta senza applicazione. Dedup/replay, date/offset, fonti future e versioni. 8 test. | Mappatura ai nuovi servizi e autorità di ogni transizione; i campi sintetici non sono nuovi stati del database. |
| WUL-743 | `node scripts/document-quality-corpus.mjs` | 12 casi Q01–Q12, 13 classi di errore, testo/pagina/intervallo, digest per fonte/caso/corpus; citazione fuori pagina rifiutata. 7 test. | Ogni caso è `DEVELOPMENT_ONLY`, review `pending`, readiness `HOLD`. Non è un gold standard, un set di valutazione riservato o un test di accuratezza del modello. |
| WUL-744 | `node scripts/verify-fhir-validator-cache.mjs --artifacts-dir <cache-locale>` | Validazione del lock offline e hash dei file; missing, byte alterati e symlink distinti. 5 test; 11 artefatti reali del lock combaciano. | Due Patient sintetici verificati anche dal validator Java 17 con rete negata. Restano da validare export Bundle v2, profili, terminologie del packet e accesso istituzionale. |
| WUL-745 | `node scripts/synthetic-handoff-packet.mjs` | Un destinatario e una finalità fittizi espliciti, selezione di fonti, stato allergie ignoto/assenza riferita, terapie attuali/storiche, citazioni/versioni e rifiuti senza disclosure. 9 test. | Mappa IPS candidata, non Bundle valido. Codici/unità non qualificati, firma clinica, consegna e target ingestion non eseguiti. |
| WUL-747 | `node scripts/synthetic-cohort-analysis.mjs` | Una attività come unità, finestra semiaperta, correzioni note alla data di osservazione, duplicati e ignoti. Fixture: 6 risultati ricevuti, 3 da rivedere, 2 rivisti, 1 ignoto; 3/5 = 60% tra stati noti, copertura 5/6. 9 test. | Nessun adapter ai dati reali. `reportReceivedAt` non prova revisione professionale; stato di revisione, minimizzazione, piccoli numeri e policy delle query devono essere definiti. Nessuna anonimizzazione o efficacia clinica dimostrata. |

Le CLI sintetiche non accettano un percorso verso dati dell'utente. Il verifier
FHIR legge soltanto i nomi degli artefatti attesi nella directory indicata,
senza eseguirli o scaricarli. Queste funzioni non sono API produttive né gate
di autenticazione: le autorità e le policy dei casi sono ipotesi inventate.

### Fonti e interoperabilità

Il [registro versionato](../../scripts/fixtures/fhir-profile-research-ledger.json)
conserva ricevute/hash delle fonti pubbliche. Il lock FHIR esistente non è stato
modificato. Sono identificati FHIR R4 4.0.1,
[SMART 2.2.0](https://hl7.org/fhir/smart-app-launch/STU2.2/) e
[IPS 2.0.1](https://hl7.org/fhir/uv/ips/2.0.1/), quest'ultimo pubblicato il
19 giugno 2026 secondo il registro HL7. La mappa del packet non aggiunge
automaticamente i loro pacchetti al lock R4.

Il [portale HL7 Italia](https://www.hl7.it/fhir/) presenta ItCore 0.2.0 come
pubblicato il 20 maggio, mentre [l'artefatto versionato](https://www.hl7.it/fhir/core/0.2.0/ImplementationGuide-hl7.fhir.it.core.json)
riporta `draft`, data 30 luglio 2026, e la guida indica una build locale.
**Overlay italiano in attesa della riconciliazione della pubblicazione.**
Il [repository di accreditamento FSE](https://github.com/ministero-salute/it-fse-accreditamento/blob/main/README.md)
annuncia la dismissione dal 14 luglio 2026: non è stata inventata una procedura
sostitutiva. IPS, patient summary italiano e invio FSE rimangono contratti diversi.

### Prova del validatore ufficiale con rete negata

Temurin 17.0.20.1+1 è stato acquisito dalla release ufficiale Adoptium,
verificato con SHA-256 e scompattato nella cache isolata del task; Java di
sistema e configurazioni della shell restano invariati. Le undici dipendenze
fissate dal lock sono state verificate prima dell'estrazione; nome/versione
nei package corrispondono. Il processo usa una home Java separata, settings
offline e `sandbox-exec` con `deny network*`.

Il controllo di rete usa lo stesso endpoint loopback: connessione riuscita
fuori dal sandbox, errore `EPERM` al suo interno. Il validatore segnala tentativi
di discovery della versione più recente, poi usa la cache locale fissata:
non è dichiarata assenza di tentativi di rete. La negazione è del processo.

| Input riproducibile | OperationOutcome osservato |
| --- | --- |
| `scripts/fixtures/fhir-r4-patient-valid.json` | 0 errori, 0 warning; un messaggio informativo. Exit 0. |
| `scripts/fixtures/fhir-r4-patient-invalid.json` | 2 errori su `Patient.gender`, codice non ammesso nel value set R4. Exit 1. |

Comando del run (percorsi task-specific sostituiti con variabili esplicite;
cache, settings e profilo sono preparati secondo ADR 0081):

```bash
sandbox-exec -f "$MEDIFLOW_DENY_NETWORK_PROFILE" \
  "$MEDIFLOW_JAVA17" -Xmx1g -Duser.home="$MEDIFLOW_VALIDATOR_HOME" \
  -jar "$MEDIFLOW_VALIDATOR_JAR" "$MEDIFLOW_SYNTHETIC_INPUT" \
  -version 4.0.1 -fhir-settings "$MEDIFLOW_FHIR_SETTINGS" \
  -tx n/a -txCache n/a -jurisdiction global -locale en-US \
  -show-message-ids -level warnings -output "$MEDIFLOW_OUTCOME"
```

Gli esiti sono stati letti come `OperationOutcome`, non dedotti dal solo exit
code. Il confronto positivo/negativo qualifica questa prova del validatore;
**non è il gate del Bundle export v2 previsto dall'ADR**, né una conformance
IPS/FSE. Input, outcome, receipt Java e prova di rete sono conservati con hash.

La [matrice regolatoria candidata](./2026-09-26-09x-regulatory-delta.md)
mantiene distinte fonti vincolanti/guide, scenari, ruoli da nominare e decisioni.
Non certifica un uso clinico né sostituisce il dossier corrente.

## Verifica della demo

Percorso: caso sintetico → fonti → nota di confronto → fonte cambiata →
conflitto → rilettura esplicita → bozza ripreparata → annulla/ripristina.
Provati anche errore per fonte mancante e cambio A→B→A con conservazione
della bozza A e assenza del suo contenuto in B. Il contesto del caso è visibile
anche accanto al modulo della bozza.

Ambiente: Playwright con Chrome installato, perché il Browser plugin non è
disponibile; il Chromium headless atteso da Playwright non era installato.
Nessun pacchetto/browser aggiunto. Viewport 1440×1050 e 390×844, URL locale
`file://` e successivo replay HTTP su `127.0.0.1` del candidato collettore.
Screenshot ispezionati dal coordinatore. L'anteprima locale serve solo la
cartella della demo; una richiesta iniziale alla favicon ha prodotto 404 ed è
stata eliminata con un'icona vuota locale, poi il percorso è stato riprovato.

| Controllo | Esito delimitato |
| --- | --- |
| Titolo, URL, pagina non vuota, assenza di overlay | PASS |
| Console ed errori della pagina | Nessun errore/avviso rilevato nel percorso |
| Tastiera e focus | Skip link, attivazione checkbox con spazio e focus sul conflitto verificati |
| Schermo stretto | Nessuna eccedenza orizzontale a 390 px; pulsanti visibili almeno 44×44 px |
| Proposta/conflitto/annullamento | Input e fonti preservati; nessuna applicazione clinica |
| Richieste della pagina | Solo file locali / risorse della stessa origine locale nei due run |
| Screen reader, app native, valutazione clinica | NON ESEGUITI |

La [WCAG 2.2 del W3C](https://www.w3.org/TR/2024/REC-WCAG22-20241212/)
resta il riferimento: 2.4.11 focus non oscurato e 2.5.8 target minimo sono AA;
3.3.7 evitare inserimenti ripetuti è A; 3.3.8 autenticazione accessibile è AA.
Quest'ultima non è esercitata dalla demo, che non ha autenticazione. Misure dei
pulsanti e screenshot non attestano conformità dell'intera pagina: checkbox,
eccezioni/spacing, zoom, contrasto e tecnologia assistiva richiedono verifica
completa sul futuro flusso integrato.

## Protocollo prima della valutazione con un medico indipendente

Non sono stati raccolti tempi o giudizi clinici. Prima di farli osservare:

1. Congelare casi/fonti/digest e istruzioni; usare gli stessi dati inventati nel
   percorso esistente e nel prototipo. Separare la navigazione dalla correttezza
   clinica delle annotazioni di riferimento, che richiede revisione competente.
2. Individuare un medico diverso dall'autore e registrare esperienza e ordine
   dei percorsi. Alternare l'ordine dei due casi e segnalare l'effetto di
   apprendimento; due casi non sono uno studio di efficacia.
3. Misurare dal contesto iniziale alla fine della revisione, comprese verifica
   delle fonti, correzioni, informazioni mancate e passaggi di navigazione.
   Non usare solo click o tempo di generazione come beneficio.
4. Registrare separatamente errori di soggetto, provenienza, attualità,
   dose/unità/frequenza, omissioni e bozza persa; un errore critico impone
   correzione/riesame del prototipo. Nessuna soglia di beneficio è adottata qui.
5. Per follow-up, packet e coorti verificare anche chiusura senza prova,
   destinatario/finalità, dato ignoto scambiato per assente e denominatore.
   Raccogliere carico degli avvisi e giudizio di utilità senza ranking clinico.
6. Leonardo valuta GO/PIVOT/STOP della prima porzione nominata dopo evidenza e
   revisione competente. Un GO di design non assegna i poteri del servizio.

## Riuso e dipendenze ancora necessarie

### Collegamento al percorso comune e differenze da risolvere

Il raccordo concordato con il task «MediFlow — Chief of Staff» è:
fonte → revisione/bozza → conferma umana → operazione condizionale con
versione/audit → rilettura/recupero. Questa tranche esercita i primi due
passaggi. Non simula una conferma autenticata o una ricevuta di commit.

| Confine fra prototipi | Differenza osservata | Owner e contratto del collegamento futuro |
| --- | --- | --- |
| 740 rispetto a 739/741/745 | La demo usa date leggibili e versioni stringa; i tool usano versioni numeriche, date di fonte o istanti con offset. | Owner del manifest WUL-587 e del query port WUL-575: definire riferimenti e precisione temporale comuni, preservando la data originale senza inventare un'ora. |
| Review in 740, fase `reviewed` in 741, fonte `reviewed` in 745 | Sono stati sintetici con significati diversi, nessuno è una conferma umana autenticata o un audit durabile. | Owner WUL-584/585: comando, currentness, consenso, audit e readback; vietato convertire direttamente il label in autorità. |
| Destinatario 745 e presa in carico 741 | Destinatario/finalità del documento non equivalgono a trasferimento di responsabilità o acknowledgment del follow-up. | Owner clinico WUL-741/745, poi servizio WUL-595: esplicitare ruolo ed evidenza, senza inferirli dal destinatario. |
| Conflitto 740 e versioni 739/741/745 | La demo aggiorna una revisione in memoria; gli altri strumenti confrontano snapshot sintetici. Nessuno implementa CAS produttivo. | Owner del confine WUL-585/587: adapter al comando accettato e prove di conflitto/readback, senza risottomissione automatica. |
| Conteggi 747 e follow-up 741 | Il dato `documented/pending/unknown` della coorte non è ancora un attributo derivato dai servizi reali. | Owner del read model e revisore clinico: fissare mapping e denominatore prima dell'adapter o di estrazioni reali. |

Queste differenze impediscono un collegamento diretto fra i prototipi; non
sono corrette introducendo un nuovo adapter in questo task. Il registro
Markdown contiene soltanto le aggiunte di questa tranche: l'owner core
riconcilierà eventuali voci concorrenti quando sarà richiesta l'integrazione.

| Filone | Fonte esistente da riusare | Da non duplicare / prova necessaria |
| --- | --- | --- |
| Diritti e correzioni | `lib/schema.ts`, `lib/network-patient-write.ts`, `lib/security/audit-db.ts`, `lib/backup-artifact.ts` | Versione del paziente distinta da quella della fonte; nessun nuovo registro, purge o audit alternativo. |
| Terapie e review | `components/treatment-reasoning-panel.tsx`, `components/patient-smart-import-panel.tsx`, DESIGN | Comparatore/state model minimo dopo WUL-587; nessun nuovo database di terapie o design system. |
| Follow-up e coorti | `lib/patient-followup-projection.ts`, `packages/aip/src/patient-open-loops-contract.ts`, `servicePrescriptionItems`, `checkups` | Stato esame/referto non equivale a revisione o chiusura professionale; definire mapping al servizio accettato. |
| Packet/FHIR | `lib/fhir/bundle-mapper.ts`, ADR 0081, lock validator v1 | Mapper attuale e contratto futuro non sono la stessa prova. Nessun adattamento runtime anticipato. |
| Mini | `packages/mini/src/session.ts`, `scripts/run-mini-desktop-acceptance.mjs`, Supervisor | Conservare gli harness; adattare al confine WUL-710. IPC connesso non equivale a capacità autorizzata; prove vecchie non qualificano nuovi pacchetti. |
| Windows/Linux | ADR 0068, `Start-MediFlow.ps1`, `scripts/start-mediflow.sh`, `.github/workflows/cross-platform.yml` | Node 24/binding e boot CI non sono qualifica dell'installer, OCR, cataloghi o recovery sul target finale. |
| iOS/iPadOS | `native/MediFlowAppleApp/project.yml`, test `MEDIFLOW_INTEROP_INPUT` | Occorrono host accoppiato, rilettura indipendente e dispositivo/target nominato; test sintetico o viewport mobile non li sostituisce. |

Prima del trapianto nel prodotto: riesaminare il delta dal baseline, scegliere
il servizio/contratto già accettato, adattare le fixture e ripetere solo le prove
invalidate dall'integrazione. Rimuovere i prototipi non richiede una migrazione.
Le componenti si possono integrare separatamente; il collettore non richiede
una PR unica o un'adozione simultanea.

## Verifiche e provenienza della consegna

- Suite autonoma: **52/52 test** con Node 24.21.0, sui file del collettore.
- Lint dei nuovi JS/MJS: PASS; `check:claims` e `check:never-regress`: PASS.
- Lint globale: un errore `react-hooks/refs` in `observation-manager.tsx:126`,
  non modificato. SHA-256 identico a Git baseline:
  `146c66f33971f647a4c05af0c2378a80893857666ded0cb0e0be1bb967330523`.
  Eseguito direttamente con Node 24.21.0, ESLint 9.39.5, plugin React Hooks
  7.1.1, config Next 16.3.4 nelle dipendenze locali condivise. Non è un `npm ci`
  dal lock del collettore né prova di regressione causata da questa tranche.
- Build/test dell'app completa: non eseguiti in questa tranche, che aggiunge
  tooling e prototipi isolati senza import nel runtime. La qualifica runtime
  rimane al task principale e alle successive integrazioni.
- Verifica documentale: `git diff --check` e inventario Markdown; indice
  aggiornato. Nessun documento di autorità del prodotto sostituito.

Il riesame ha corretto intervalli delle citazioni oltre il testo (743), flag
terza parte e versioni delle fonti (739), bozza persa cambiando caso e contesto
vicino al modulo (740/742), offset/date future e attività chiuse scadute (741).
Gli esiti sopra includono tali correzioni. I test tecnici non adjudicano i casi
clinici, adottano policy o soddisfano da soli la Definition of Done delle issue.

Esecuzione: due collaboratori Sol Medium per interventi circoscritti; Luna
Medium Fast per censimento/fonti; selezione, interpretazione, correzioni e
accettazione tecnica al coordinatore. Consumi per task non disponibili; i
limiti condivisi dell'account non sono attribuiti a questa tranche. Ricevute,
manifest e patch locali sono conservati nella cartella `.codex/09x` del
collettore; il checkpoint di programma conserva apertura/chiusura delle lane.
