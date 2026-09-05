---
summary: "Candidate 0.8.5 Web editor snapshot/CAS recovery and per-patient diagnosis counts."
read_when:
  - "Changing patient form defaults, checkup reconciliation, or partial-save recovery."
  - "Changing the Schede diagnosis metric or its age filters."
---

<!-- @Codex -->
# Web 0.8.5: snapshot del modulo, recupero e conteggio Schede

Stato: candidato della lane `mf085-fix-a-web-20260904`, da verificare e integrare
sulla base `517304cdd07e5e4845dce300ae7754e4add28c73`.

## Decisione locale (ADR-style, MF085-001)

Il modulo possiede uno snapshot iniziale indipendente dalle riletture live.
Valori visibili, ID e versioni provengono dagli stessi record. I token non
vengono aggiornati al submit. Non si modifica il contratto server, la cifratura,
l'autorità clinica o il percorso F10.

Il client esistente espone PUT/DELETE con versione e POST con ID fornito dal
client. Non espone una transazione composta paziente/checkup: `bulkPut` invia
POST distinti e `bulkDelete` rilegge le versioni. Nessuno dei due viene usato
per il salvataggio dell'editor. Le transazioni SQLite presenti nelle singole
route non rendono atomica la sequenza di richieste del modulo.

Prima di qualsiasi scrittura si valida tutto il piano: identità del paziente,
versioni positive, appartenenza dei checkup, ID duplicati o estranei allo
snapshot. Un ID iniziale eliminato altrove non diventa una nuova riga.
Si aggiornano soltanto i campi cambiati rispetto ai valori effettivamente
mostrati e si eliminano soltanto righe iniziali rimosse dal modulo. Le righe
aggiunte altrove, mai mostrate, non entrano nel piano. Date non modificate e
provenienza non vengono riscritte incidentalmente.

Il confronto delle diagnosi usa una proiezione esplicita di codice, descrizione,
sistema e istante della data: il riordino delle proprietà effettuato dallo
schema del form non provoca scritture. Ordine e duplicati nell'array restano
significativi. Le righe mantenute conservano gli eventuali metadati aggiuntivi
dello snapshot. Se una modifica, rimozione o variazione dei duplicati coinvolge
metadati non gestiti dal modulo, il salvataggio si ferma prima delle scritture:
in assenza di un ID stabile della diagnosi non se ne presume l'associazione.
Il modulo e la sessione restano disponibili per correggere il tentativo.

Il piano del singolo gesto di salvataggio è immutabile e seriale. Tiene in RAM
le operazioni confermate; un retry riparte dalla prima non confermata, usando
le versioni originali e gli stessi ID di creazione. Non ripete le operazioni
confermate e non ricalcola il piano su una rilettura più recente. La UI blocca
le modifiche al tentativo sospeso e mostra conteggio delle conferme ed errore.

Una risposta persa può nascondere una scrittura già applicata. Non viene
interpretata come successo: un nuovo tentativo con lo stesso CAS/ID non può
sovrascrivere una revisione successiva o creare una seconda riga, ma può
ricevere un conflitto/errore di ID già presente. Non è idempotenza server,
exactly-once, rollback o atomicità. In questo caso, e nei conflitti 409, la UI
permette una rilettura esplicita, previa conferma dell'abbandono delle modifiche
residue, e apre un nuovo snapshot da rivedere. Il draft resta visibile fino a
quel gesto. Nessuna riapplicazione automatica con token freschi.

Il journal non sopravvive alla chiusura della pagina e non viene persistito
in storage browser. Una chiusura/rilettura non annulla scritture confermate.

## MF085-007: unità di conteggio

Ogni scheda in fascia contribuisce al massimo una volta per `diagnosisKey`.
La chiave resta sistema + codice + descrizione normalizzata in minuscolo
italiano; non si raggruppa per solo codice. Pazienti diversi contribuiscono
separatamente. La prima descrizione visualizzata, ordinamento e top 10 restano
quelli precedenti.

Il chiamante continua a escludere gli archiviati. La lettura API ordinaria
continua a escludere i tombstone. La funzione conserva range inclusivo e
normalizzazione dei limiti invertiti, `date-fns/differenceInYears`, bucket
0–18 / 19–64 / 65–80 / >80, contatori di data presente/assente prima del filtro
e ADI/diagnosi soltanto nella fascia. La funzione riceve il calcolo dell'età
come dipendenza esplicita; la pagina passa la stessa funzione date-fns usata
prima, non una sua reimplementazione.

## Verifica

Con Node 24.x e dipendenze già installate dalla medesima versione:

```bash
node scripts/run-strip-types.mjs --test lib/patient-edit-session.test.ts lib/patient-edit-session-schema.test.ts lib/patient-analytics.test.ts lib/patient-analytics-date-fns.test.ts
npm run test:concurrency:patients
npm run test:patient-document-import
npm run lint
npm run typecheck
npm run build
npm run check:never-regress
npm run check:claims
```

I test del journal invocano il codice usato dalla UI, con persistenza sintetica
CAS/ID controllata; non provano SQLite, HTTP o rendering browser. I test
aggregati isolano il filtro con un calcolo età deterministico. Il test separato
con date-fns verifica il binding reale del calendario. Gli esiti effettivamente
eseguiti e i gate non eseguiti sono nel `TEST_REPORT.md` del pacchetto di consegna.

### Test browser focalizzati

`e2e/patient-edit-snapshot.spec.ts` esercita pagina, React Hook Form e facade
reali con risposte paziente/checkup interamente sintetiche: salvataggio
invariato, rerender live durante un esito parziale, retry residuo e conflitto.
Non sostituisce i test API/SQLite di concorrenza. Non è stato eseguito nel
container della lane. Solo dopo aver predisposto il consueto ambiente E2E
isolato e locale (mai l'archivio clinico):

```bash
MF085_SYNTHETIC_E2E=1 ./node_modules/.bin/playwright test e2e/patient-edit-snapshot.spec.ts --workers=1
```

La pagina mantiene l'ultimo record disponibile per lo stesso ID se una
rilettura live non trova più il paziente, evitando di smontare draft e journal.
Questo non autorizza scritture su una scheda eliminata: valgono sempre i
controlli delle route esistenti. La rilettura esplicita fallita conserva il
tentativo precedente.


## Seconda revisione combinata: disponibilità del genitore

<!-- @Codex MF085-COMB-001 -->
Il no-op della scheda rende legittimo un piano di soli checkup. La versione del
checkup non cambia quando il paziente viene eliminato: il CAS del figlio, da
solo, non attesta che il genitore sia disponibile. Le route Web
`/api/checkups/[id]` PUT e DELETE verificano quindi il genitore non eliminato
con `activePatients()` sia nella lettura sia nel predicato atomico dell'UPDATE.
Un paziente archiviato ma non eliminato resta distinto da un tombstone.

Se il genitore manca già alla lettura la risposta è 404; se scompare tra lettura
e UPDATE nessuna scrittura viene applicata e il conflitto 409 riporta snapshot
mancante. Draft e piano rimangono nel journal: nessun token viene aggiornato in
automatico, nessuna scrittura paziente fittizia viene introdotta. Questa
correzione riguarda le due route Web usate dall'editor, non una revisione
generale dei writer `/api/v1` o paired.

Regressione locale, solo dati sintetici e SQLite in memoria:

```sh
node --test scripts/checkup-parent-lifecycle.test.mjs
```

Il test esegue route, normalizzatori, journal, Drizzle e better-sqlite3 reali.
Gli oggetti colonna vengono da `lib/schema.ts` non modificato; DDL minimale e
righe sono sintetici, esclusivamente in memoria. Non importa `lib/db-server.ts`
né avvia un server. Solo Next, sessione e audit restano doubles. Il logger del
vero driver inserisce la transizione sintetica del genitore immediatamente
prima dell'UPDATE, senza ricostruire o sostituire SQL: non è una prova di
concorrenza multiprocesso. Le dipendenze mancanti causano errore, mai fallback
simulato o skip. Il controllo HTTP Next, il flusso browser e i gate Node 24
restano verifiche distinte; il PASS dei dieci test sul vecchio harness non
attesta l'esecuzione del nuovo.

### Followup della seconda revisione: currentness Patient Insight

`readPatientRevision` nella composizione production di Patient Insight è una
lettura ordinaria, non un'eccezione amministrativa di ADR 0066. Applica quindi
`activePatients()` insieme all'ID: assente o eliminato restituisce `null`,
archiviato ma non eliminato conserva la sua versione. Non vengono cambiate
allowlist, versione, schema persistito, selezione/lease o autorità del provider.

Il servizio esistente traduce la revisione indisponibile in `source_stale` prima
di selezione/capability e la rilegge nei controlli di currentness. Anche la
lettura del paziente in `createCanonicalClinicalContextResolver`, usata
dall'owner per selezione e dereferenziazione, applica lo stesso predicato:
un tombstone produce `patient_missing` anche con membership ancora presente.
Restano invariati controlli sessione, ambulatorio, membership, versione e
resource-port; archivio e restore esplicito mantengono il loro significato.
Le due letture senza filtro erano violazioni preesistenti di ADR 0066, non
una dimostrazione eseguita di bypass end-to-end.
Il test del reader usa SQL reale in memoria e cattura la callback production,
con assembly/sessione/provider doubles che non possono eseguire operazioni.
I test del servizio coprono il diniego iniziale e dopo selezione, senza writer.

```sh
node --test scripts/patient-insight-revision-lifecycle.test.mjs scripts/patient-soft-delete.test.mjs
node scripts/run-strip-types.mjs --test lib/ai-providers/fabric/patient-insight-authenticated-preview.test.ts lib/ai-providers/fabric/patient-insight-production-root.test.ts lib/security/server-session-clinical-context.test.ts
```

Questi comandi richiedono le dipendenze già presenti del progetto. Nessun test
avvia provider, rete, runtime clinico o installazioni; le prove sono post-fix.

## Followup 2: remaining ADR 0066 reads

Treatment Reasoning and Portable Supervisor now spell their existing
`isNull(patients.deletedAt)` predicate as `activePatients()`; membership checks
and Portable Supervisor's separate archive exclusion are unchanged.

The durable review link store is an operational create/read surface, not a
history-export API: its two patient reads now require `activePatients()`.
An unavailable parent yields the existing `patient_missing` code, including
idempotent create and read of an existing link. A missing referenced review
still yields `stored_state_invalid`. No link or review is deleted or rewritten:
explicit patient restore makes the same association available again. Archives
without a tombstone remain available. Backups/restore and administered purge
keep their independent table paths and lifecycle exceptions unchanged.
The supplied tree has no production caller of this store (only its tests);
ActiveReviewBinding uses a separate locator under the owner's current-context
lease. This is dormant contract hardening, not a demonstrated active bypass.
The lifecycle guard and its allowlist are unchanged. Added tests use real ORM
with synthetic in-memory tables; no production bootstrap/migration is required.
