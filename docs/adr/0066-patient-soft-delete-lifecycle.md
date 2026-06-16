# ADR 0066: Ciclo di vita della cancellazione paziente (soft-delete sul percorso caldo, purge esplicita amministrata, clear per membership)

Date: 2026-06-10
Status: Accepted

Issues: WUL-306 (orfani clinici da DELETE paziente), WUL-322 (clear test-container per colonna legacy), WUL-300 (ambulatoryId stale dopo CUT); correlate: WUL-308 (precedente soft-delete entries), WUL-316 (lista collezioni canonica), WUL-317 (deletedAt in DATE_FIELDS)

Related: [ARCHITECTURE.md](../../ARCHITECTURE.md),
[SECURITY.md](../../SECURITY.md),
[ADR 0010](./0010-openapi-spec-first-for-api-v1.md)

---

## Problema

`DELETE /api/v1/patients/{id}` (e il gemello web `app/api/patients/[id]/route.ts`) cancella **solo la riga `patients`**: con `PRAGMA foreign_keys` spento (premessa corretta dalla nota post-merge in fondo: il default reale di better-sqlite3 è ON) (`lib/db-server.ts`, nessun pragma in tutta l'app) e nessun `onDelete: 'cascade'` sulle 9 tabelle figlie cliniche (`lib/schema.ts`), ogni cancellazione orfana entries, terapie, osservazioni, checkup, prescrizioni, eventi SISS e allegati. Questo PHI orfano è il peggiore dei due mondi: invisibile alla UI, **escluso da ogni artefatto di backup** (entrambe le pipeline filtrano i figli senza genitore: `app/api/system/backup-restore/route.ts`, `scripts/run-scheduled-backup.mjs`), quindi non recuperabile, ma fisicamente presente sul disco: dato personale non gestito, né cancellato né conservato.

In più, il clear del contenitore di test (`app/api/ambulatories/clear/route.ts`) seleziona le vittime tramite la colonna legacy `patients.ambulatoryId` invece della membership M2M `patientsToAmbulatories`: poiché il CUT da clipboard aggiorna solo la M2M lasciando la colonna stale (WUL-300), il clear può **hard-deletare pazienti vivi** e ne orfana i figli (WUL-322).

## Contesto

Vincoli verificati sul codice (tutti i claim portanti dei tre design sono stati controllati):

- **Nessun framework di migrazione runtime.** Lo schema evolve via guardie idempotenti additive in `lib/db-server.ts` (`ensureColumn`, `CREATE TABLE IF NOT EXISTS`); i file `drizzle/*.sql` (16, journal a 4 entry, già divergente) vengono replayati solo dal bootstrap e2e. I DB sul campo non hanno fisicamente clausole CASCADE e SQLite non può aggiungerle senza ricostruire le tabelle.
- **Il pattern soft-delete è già la convenzione clinica del repo.** `entries`, `therapies`, `observations`, `checkups` hanno `deletedAt`/`deletionReason`; la DELETE v1 delle entries è un UPDATE tombstone version-guarded con commento esplicito «WUL-308: DELETE keeps the soft-delete tombstone». `patients` è l'anomalia: ha `version` e `isArchived` ma nessun tombstone.
- **Il contratto OpenAPI già canonizza questa filosofia.** La spec elenca «remote hard delete» tra le operazioni escluse e documenta il soft-delete di terapie/entries; `deletePatient` promette solo «Deletes a patient using optimistic concurrency», non la distruzione fisica. Il client UI (`lib/db.ts`) invia `{version}` e controlla solo `res.ok`/409.
- **Audit trail pronto.** `audit_events` è append-only (trigger in `lib/audit-db.ts`), senza FK verso `patients`, fuori da BACKUP_COLLECTIONS; il vocabolario contiene già `patient.deleted` e `patient.restored` (`lib/audit.ts`).
- **Roundtrip backup già pronto.** WUL-317 ha aggiunto `deletedAt` a DATE_FIELDS (`backup-restore/route.ts`); `normalizeInsertRow` tocca solo i campi presenti, quindi artefatti vecchi restano restorabili senza bump di versione.
- **Precedente anti-drift.** WUL-316 (commit 65dcdf9b) ha eliminato una lista di tabelle duplicata e aggiunto `scripts/backup-scheduler-collections.test.mjs` come guardia CI: il rimedio accettato del repo per le liste mantenute a mano.
- **Claim smentito durante la verifica:** l'opzione fk-cascade sostiene che «e2e gira già con FK enforcement, provando che le query tollerano FK=ON». È falso: `scripts/prepare-e2e-db.mjs` attiva il pragma solo sulla propria connessione di bootstrap durante il replay delle migrazioni; l'app sotto e2e apre la propria connessione via `lib/db-server.ts` con FK OFF. Non esiste alcuna evidenza che l'app tolleri FK=ON a runtime.

> **Correzione post-merge (2026-06-10, WUL-336):** la premessa «`PRAGMA
> foreign_keys` spento di default» è risultata errata alla verifica empirica:
> better-sqlite3 attiva l'enforcement delle foreign key di default su ogni
> connessione che apre, quindi il runtime gira con FK=ON anche senza pragma
> espliciti in `lib/db-server.ts`. La decisione resta valida sotto entrambi i
> regimi: il percorso caldo non cancella più righe padre (soft-delete) e
> `purgePatientCascade` elimina i figli in ordine canonico prima del padre,
> quindi il disegno non dipende né da FK=OFF né da clausole CASCADE. Il punto
> 6 della Decisione va letto come «questa ADR non introduce pragma né
> rebuild», non come descrizione dello stato runtime delle FK.

## Opzioni

1. **tx-explicit-delete**: FK resta OFF; la cancellazione diventa una transazione sincrona che elimina esplicitamente ogni tabella figlia da una lista canonica `PATIENT_CHILD_TABLES` con guardia anti-drift; clear per membership; sweep una-tantum degli orfani in fix-orphans.
2. **soft-delete**: `patients` adotta `deletedAt`/`deletionReason` via `ensureColumn`; DELETE diventa tombstone version-guarded (copia del handler entries); filtri `isNull(deletedAt)` su ~18 percorsi di lettura; endpoint admin di purge esplicita (dry-run/execute) che cancella i figli in cascata; clear per membership con soft-delete.
3. **fk-cascade**: `PRAGMA foreign_keys=ON` + `onDelete:'cascade'` su 9 FK, con ricostruzione completa delle 9 tabelle figlie a boot sui DB già deployati, snapshot `.bak`, censimento orfani, e guardie 404 sui POST figli.

## Trade-off

### Tabella di valutazione (1-10)

| Criterio | tx-explicit-delete | soft-delete | fk-cascade |
|---|---|---|---|
| (a) Sicurezza PHI / recuperabilità da errore operatore | 6 | **9** | 4 |
| (b) Tensione cancellazione GDPR ↔ conservazione clinica italiana | 5 | **9** | 4 |
| (c) Raggio d'impatto / rischio regressione su DB deployati (niente framework di migrazione) | **10** | 7 | 3 |
| (d) Coerenza con i pattern esistenti del repo | 9 | **10** | 5 |
| (e) Risoluzione pulita di WUL-322 e WUL-300 a fianco | 7 | **9** | 4 |
| (f) Testabilità secondo le convenzioni del repo | **9** | 7 | 5 |
| **Totale** | **46** | **51** | **25** |

Motivazioni sintetiche:

- **tx-explicit-delete**: Footprint DDL nullo (c=10) e idioma identico a CLEAR_ORDER/BACKUP_COLLECTIONS + guardia WUL-316 (d=9, f=9). Ma rende l'erasure *immediata e irreversibile* sul percorso caldo: un fat-finger su un paziente con anni di storia è recuperabile solo da backup (a=6), e ignora l'obbligo italiano di conservazione della documentazione clinica (decenni per la cartella) trattando ogni DELETE come erasure Art. 17 (b=5). WUL-300 dichiaratamente fuori scope (e=7).
- **soft-delete**: È letteralmente il pattern che il repo ha già scelto per ogni altra risorsa clinica (WUL-308) e che la spec v1 già pubblica (d=10); reversibilità per il caso 99% e purge audited per l'erasure vera (a=9, b=9); rende il clear di WUL-322 *recuperabile* anche se selezionasse un paziente vivo (e=9). Costo reale: ~18 file con `from(patients)` da filtrare (ogni filtro mancato è un paziente fantasma); rischio disciplinare permanente mitigabile ma non eliminabile (c=7, f=7). Le ALTER sono additive via `ensureColumn`, meccanismo collaudato.
- **fk-cascade**: La diagnosi («i backup implementano già la semantica cascade») è corretta e verificata, ma la terapia è la più pericolosa: ricostruzione di 9 tabelle a init del modulo su DB di studio medico eterogenei (evoluti via `ensureColumn`, quindi con layout non identici ai file di migrazione), senza framework di migrazione, con pragma per-connessione e journal drizzle già divergente (c=3). Distruzione atomica senza undo (a=4); **aggrava WUL-322**: finché il clear filtra sulla colonna legacy, cascade trasforma il bug da "orfana i figli" a "distrugge atomicamente l'intera storia clinica di un paziente vivo" (e=4). L'evidenza chiave a favore («e2e gira già con FK ON») è risultata falsa alla verifica (f=5).

## Decisione

**Ibrido a dominanza soft-delete**, innestando dal secondo classificato la lista canonica con guardia anti-drift:

1. **Percorso caldo = soft-delete** (opzione 2): `patients.deleted_at` / `patients.deletion_reason` via due `ensureColumn`; le due route DELETE diventano UPDATE tombstone version-guarded ricalcando il handler entries (`app/api/v1/patients/[id]/entries/[entryId]/route.ts`); contratto wire invariato (stesso `PatientDeleteRequest {version}`, stessi 200/400/401/404/409/500, stesso payload 409); audit `patient.deleted` invariato. Restore = azione admin esplicita, audit `patient.restored` (già nel vocabolario); `deletedAt` non è forgiabile via PUT (whitelist di `lib/patient-write-normalization.ts` già lo esclude).
2. **Lista canonica + guardia anti-drift** (innesto da opzione 1): nuovo modulo `lib/patient-cascade.ts` con `PATIENT_CHILD_TABLES` ordinata (servicePrescriptionItems → servicePrescriptions → prostheticPrescriptions → sissHandoffEvents → observations → checkups → therapies → entries → attachments → patientsToAmbulatories) e `purgePatientCascade(tx, patientId)` sincrona (precedente: la transazione di restore in `backup-restore/route.ts`), che ritorna i conteggi `.changes` per tabella. Test di drift in stile WUL-316: ogni tabella esportata da `lib/schema.ts` con colonna `patientId` DEVE essere nella lista, più una scansione `PRAGMA table_info` su un DB bootstrappato per coprire le tabelle create in SQL grezzo (es. `observations` in `lib/db-server.ts`).
3. **Purge amministrata** (presente in entrambe le opzioni 1 e 2): endpoint `app/api/system/purge-patient` fuori dal contratto v1, modellato su fix-orphans (GET dry-run con conteggi per tabella / POST execute, `requireSession` + `role==='admin'`), che usa `purgePatientCascade` e emette il nuovo evento additivo `patient.purged` con i conteggi PHI-safe in `redactedMetadata`. Questo è lo strumento per l'erasure GDPR Art. 17 (deliberata, doppia conferma, audited), distinto dal delete operativo.
4. **WUL-322 = clear per membership + soft-delete**: `app/api/ambulatories/clear/route.ts` seleziona i pazienti via `patientsToAmbulatories` per l'ambulatorio test, **esclude** chi ha anche una membership in un ambulatorio live, e li soft-deleta con `deletionReason='test-container-clear'` in un'unica transazione, emettendo `patient.deleted` per ciascuno. Un paziente vivo travolto dalla deriva WUL-300 è così recuperabile invece che distrutto.
5. **Bonifica del debito storico (orfani pre-esistenti di WUL-306)**: estensione di `app/api/system/fix-orphans`: il GET dry-run riporta `orphanChildRowCounts` per tabella (figli il cui `patient_id` non risolve); il POST li purga solo dietro flag esplicito `purgeOrphanedClinicalRows: true`, DOPO il passo esistente di relink (l'attuale nozione di "orfano" lì è un paziente vivo non linkato: prima si rilinka, poi si purga), con evento di audit dei conteggi. Sicuro rispetto ai backup: gli artefatti esistenti sono già privi di orfani per costruzione.
6. **FK resta OFF.** Niente pragma, niente rebuild, niente cascade Drizzle-only cosmetico. L'attivazione di `PRAGMA foreign_keys=ON` diventa un *hardening opzionale futuro* (issue separata): con il percorso caldo che non cancella più righe padre, è l'unica strategia sotto cui il flip diventa a rischio quasi nullo, ma richiede prima le guardie 404 sui POST figli che oggi inseriscono senza verificare il paziente (`app/api/v1/patients/[id]/entries/route.ts` POST e fratelli) e la sanatoria di `servicePrescriptionItems.prescriptionId`.

**WUL-300 resta una issue separata** e NON viene piegata in questa: il punto 4 rimuove la dipendenza pericolosa (il clear smette di leggere la colonna legacy), declassando WUL-300 da "hazard di cancellazione" a "igiene del dato". La sua chiusura (smettere di scrivere/leggere `patients.ambulatoryId` ovunque, o backfillarla dalla M2M) ha un raggio proprio (assign/unassign/move/duplicate, normalizzazione write) e merita la sua slice. Nel frattempo questa ADR le lascia un vincolo: nessun nuovo codice deve usare `patients.ambulatoryId` per selezionare insiemi di pazienti da cancellare.

## Conseguenze

**Più semplice:**
- Il fat-finger delete diventa reversibile; il dato clinico resta conforme agli obblighi di conservazione italiani; l'erasure GDPR ha uno strumento dedicato, audited e con conteggi.
- Il paziente smette di essere l'anomalia del ciclo di vita clinico: stesso tombstone di entries/terapie/osservazioni/checkup, stessa semantica già pubblicata dalla spec v1.
- Niente più produzione di PHI orfano: l'unico punto che cancella righe figlie è `purgePatientCascade`, con lista canonica sorvegliata da CI.
- Contratto /api/v1 a deriva zero: il guard OpenAPI non vede cambi di path/schema/risposte; solo un ritocco descrittivo a `deletePatient`.

**Più difficile / rischi accettati:**
- **Filtri di lettura disciplinari**: ~18 file con `from(patients)` devono filtrare `isNull(deletedAt)`; backup, fix-orphans, purge e migrate NON devono filtrare. Mitigazione obbligatoria: helper condiviso (`activePatients()`) + test grep-based in stile WUL-316 che vincola gli accessi a `patients` fuori da una allowlist. Il rischio residuo (paziente fantasma da filtro mancato in codice futuro) è reale e permanente: è il prezzo pagato per la recuperabilità, ed è lo stesso prezzo già accettato per entries/terapie.
- I soft-deleted viaggiano nei backup (corretto per la conservazione, da documentare per le richieste di erasure: la purge non raggiunge artefatti già esportati; vero per ogni opzione).
- Ambiguità UX su ri-registrazione di un paziente con stesso `taxCode` (non-unique per schema): nessun vincolo si rompe, ma la dedup deve ignorare i soft-deleted.
- Il gap audit-after-commit (audit fuori transazione, failure ingoiate) resta un follow-up pre-esistente, comune a tutte le opzioni.

**Migrazione / rollout sicuro per i DB deployati:**
1. Due `ensureColumn('patients', 'deleted_at'|'deletion_reason', …)` in `lib/db-server.ts`: ALTER additive, idempotenti a ogni boot, identiche a come entries/checkups/therapies/observations hanno ricevuto le stesse colonne. Righe esistenti → NULL = attive. Zero rebuild, zero pragma, zero bump dell'artefatto di backup (formato v1 invariato; `deletedAt` già in DATE_FIELDS da WUL-317; `normalizeInsertRow` tollera artefatti vecchi senza il campo).
2. Ship del codice route + helper + purge: nessuna finestra di incoerenza. Un DB vecchio con codice nuovo ha le colonne dal boot; un DB nuovo con codice vecchio ignora colonne in più.
3. Bonifica orfani storici: solo manuale, admin, dietro dry-run + flag esplicito (punto 5 della Decisione). Mai automatica a boot.
4. Rollback: il codice precedente ignora le nuove colonne; i soft-deleted riappaiono come attivi (visibile, non distruttivo). Documentare nel CHANGELOG.

**Piano di test (convenzioni repo: `node --test scripts/*.test.mjs` + script bash + tsconfig di typecheck dedicato):**
- `scripts/patient-cascade.test.mjs` (guardia anti-drift): ogni tabella con `patientId` (via schema + PRAGMA su DB bootstrappato) è in `PATIENT_CHILD_TABLES`; purge su fixture cancella tutte le righe figlie e ritorna conteggi corretti.
- `scripts/patient-soft-delete.test.mjs` (DELETE v1/web): tombstone scritto, version+1, 409 su mismatch, 404 su GET successiva, PUT su soft-deleted → 404, `deletedAt` non forgiabile via PUT.
- Il guard OpenAPI (`openapi-contract-guard.yml`) deve passare senza voci in `breakingOverrides`.
- Test percorsi di lettura: lista pazienti, dettaglio, move/assign/unassign/duplicate, SISS context/prescription, FSE validate, network read/write escludono i soft-deleted; backup-restore NON esclude (roundtrip di un soft-deleted preserva il tombstone; estendere `scripts/backup-restore-date-fields.test.mjs`).
- Test guardia allowlist: nessun `from(patients)`/`.delete(patients)` fuori dai moduli autorizzati (stile `backup-scheduler-collections.test.mjs`).
- Clear WUL-322: fixture con paziente in test+live → sopravvive; paziente solo-test → soft-deleted con reason dedicata; audit emesso; colonna legacy stale ininfluente.
- Purge/fix-orphans: dry-run riporta conteggi esatti; POST senza flag non tocca nulla; con flag purga solo figli senza genitore, dopo il relink; `patient.purged` con conteggi in metadata.
- E2E smoke: delete → sparisce dalla UI; restore admin → riappare (parità web/native secondo ADR 0008).

## First Thin Slice

**Slice 1 (WUL-306, il più piccolo passo end-to-end che valida la decisione):**
1. `ensureColumn` × 2 in `lib/db-server.ts`; campi `deletedAt`/`deletionReason` su `patients` in `lib/schema.ts`.
2. Le due route DELETE diventano tombstone UPDATE (donor: handler entries WUL-308); audit invariato.
3. Filtro `isNull(deletedAt)` sui soli due percorsi di lettura primari (lista pazienti UI `app/api/patients/route.ts` e dettaglio v1) + helper condiviso; test soft-delete + contract-negative verdi.
   *Criterio di validazione: delete dalla UI → paziente sparito, riga e figli intatti nel DB, 409 invariato, guard OpenAPI verde.*

**Slice 2 (completamento WUL-306):** restanti filtri di lettura con allowlist-test; `lib/patient-cascade.ts` + guardia anti-drift; endpoint `purge-patient` (dry-run/execute, `patient.purged`); estensione fix-orphans per gli orfani storici; restore admin.

**Slice 3 (WUL-322):** clear per membership + esclusione live + soft-delete con `deletionReason='test-container-clear'` + audit per paziente. Dipende solo dalla Slice 1.

**Fuori da queste slice:** WUL-300 (issue separata, sbloccata e de-rischiata dalla Slice 3); flip `PRAGMA foreign_keys=ON` + guardie 404 sui POST figli (hardening futuro, ora reso possibile); audit dentro la transazione (follow-up pre-esistente).
