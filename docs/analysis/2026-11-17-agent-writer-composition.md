# Composizione dei writer per la cassetta della visita

Data: 2026-11-17. WUL-866, WUL-868.
Base provata: `a3abfb53e2d668b4ea0613709e1c87f48344c382` di `origin/main`.
Node 24.22.3, better-sqlite3 12.6.2, Drizzle 0.45.1, macOS arm64.

## Esito

Le API attuali non offrono una composizione atomica utilizzabile da A5 per
nota, terapia e prestazione. L'implementazione del canale si ferma al vincolo
posto da ADR 0190. Nessun writer di prodotto viene modificato da questa prova.

Il riproduttore conservato in fondo al rapporto chiama `createEntryOperation`, `createTherapyOperation` e
`createHostServicePrescription` su un archivio sintetico appena creato nella
cartella temporanea del sistema. Imposta la directory dati prima degli import
del prodotto, disabilita l'adozione legacy e chiude e rimuove solo l'archivio
creato dalla prova. Non usa il database installato.

```sh
python3 - <<'PYTHON'
from pathlib import Path
report = Path('docs/analysis/2026-11-17-agent-writer-composition.md').read_text()
source = report.split('```typescript\n', 1)[1].split('```', 1)[0]
folder = Path('tmp-agent-writer-proof')
folder.mkdir(exist_ok=True)
(folder / 'reproduce.ts').write_text(source)
PYTHON
node scripts/run-strip-types.mjs tmp-agent-writer-proof/reproduce.ts
```

L'uscita attesa sulla base indicata è **1**, con l'asserzione del contratto A5
«zero clinical writes and zero success audit must remain after failure of any
element». Il comando è una riproduzione manuale del prerequisito ancora
mancante, distinta dalle suite di accettazione delle funzionalità consegnate.
Il fallimento non viene trasformato in un test verde.

## Osservazioni

1. **Controllo positivo.** Nota e terapia, con audit, eseguite dai writer
   esistenti dentro una transazione IMMEDIATE sincrona vengono annullate
   quando il chiamante solleva un errore. L'annidamento sincrono funziona.
2. **Callback asincrona.** Quando la transazione attende anche il writer della
   prestazione, better-sqlite3 rifiuta la callback con
   `TypeError: Transaction function cannot return a promise`. Tutte le righe
   del tentativo sono annullate.
3. **Promise ignorata.** Il candidato di composizione sincrono chiama il writer
   della prestazione senza attenderlo. Un trigger sintetico ne forza il
   fallimento. La transazione esterna termina prima che il chiamante osservi
   il rifiuto: restano una nota, una terapia e i relativi due audit di successo.
   La prestazione non è presente. L'asserzione finale del contratto fallisce.

| Conteggio | Prima | Dopo callback async | Dopo Promise ignorata |
| --- | ---: | ---: | ---: |
| Note | 0 | 0 | 1 |
| Terapie | 0 | 0 | 1 |
| Prestazioni | 0 | 0 | 0 |
| Audit | 1 | 1 | 3 |

L'audit iniziale è creato dal bootstrap sintetico. Il controllo confronta il
delta, senza attribuirlo alla cassetta.

Questa è una prova di un candidato di composizione, non una riproduzione di
un endpoint di applicazione della cassetta già esistente: quell'endpoint non
è stato implementato. Non dimostra che i writer sincroni singoli perdano
l'atomicità. Dimostra che ignorare il risultato asincrono per riusarli insieme
non soddisfa il contratto richiesto.

## Opzioni

**Raccomandata: nuclei sincroni nei writer esistenti.** Separare preparazione
eventualmente asincrona e commit sincrono. Ogni writer espone un nucleo che
riceve la transazione chiamante, conserva validazioni, ammissione e audit,
e restituisce subito un risultato. I chiamanti ordinari mantengono il proprio
wrapper. L'applicazione della cassetta usa un solo owner IMMEDIATE e converte
ogni diniego in rollback, con revisione attesa, ricevuta e consumo degli
elementi nella stessa transazione. Nessuna duplicazione delle regole cliniche.

Prima di riprendere A5 servono prove con errore ad ogni posizione, audit
fallito, revisione cambiata, retry e due applicatori concorrenti. Allegati,
trascrizione, diagnosi, esenzioni e osservazioni richiedono a loro volta il
controllo del confine reale, compresi eventuali effetti su file.

**Alternativa: mantenere solo il deposito.** Il canale potrebbe consegnare
cassette in attesa, rinviando l'applicazione finché i writer non siano
componibili. Questo riduce il risultato richiesto e richiede una decisione
esplicita. Non soddisfa la prova finale di WUL-866.

La compensazione dopo più commit non realizza «tutto o niente» e non è
un'alternativa accettabile.

## Non provato

Non sono implementati schema 12, mandato, abbinamento, ECIES, deposito,
In arrivo, CLI/MCP, identità della cassetta, condivisione della chiave o
ascolto. Non esiste una prova verde dopo una correzione dei writer.
Non sono stati eseguiti l'end-to-end delle dieci visite o il percorso del
medico. Il guard della repository e l'eventuale CI documentale attestano solo
la modifica di documentazione e la ricetta diagnostica, non queste funzionalità.

## Riproduttore manuale

Il sorgente seguente è la prova del prerequisito mancante. Non è selezionato
come test verde della CI e non è una verifica di accettazione chiusa.

```typescript
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const dir = mkdtempSync(join(tmpdir(), 'mediflow-agent-writer-composition-synthetic-'));
process.env.MEDIFLOW_DATA_DIR = dir;
process.env.MEDIFLOW_E2E_DISABLE_LEGACY_COPY = '1';
const { dbServer, openDbServer } = await import('../lib/db-server.ts');
openDbServer();
const { bindSyntheticArchiveSessions } = await import('../lib/security/web-auth-lifecycle-owner-test-fixture.ts');
const generation = bindSyntheticArchiveSessions('synthetic-composition');
const { createEntryOperation } = await import('../lib/entry-write-operation.ts');
const { createTherapyOperation } = await import('../lib/therapy-write-operation.ts');
const { createHostServicePrescription } = await import('../lib/service-prescription-write.ts');
const { patients, users } = await import('../lib/schema.ts');
dbServer.insert(users).values({ id: 'synthetic-doctor', username: 'synthetic-doctor', displayName: 'Medico Sintetico', passwordHash: 'unused', encryptedMasterKey: 'synthetic-wrapped-key', salt: 'synthetic-salt' }).run();
dbServer.insert(patients).values({ id: 'synthetic-patient', firstName: 'Sintetico', lastName: 'Composizione', taxCode: 'SYNTHETIC' }).run();
const audit = { actorType: 'user' as const, actorRef: 'synthetic-doctor', sourceSurface: 'web' as const, archiveGeneration: generation, flags: [] };
const entry = (id: string) => ({ patientId: 'synthetic-patient', id, values: { id, patientId: 'synthetic-patient', type: 'visit', title: 'ENC:synthetic:title', content: 'ENC:synthetic:content', date: new Date('2026-11-17') }, changedFields: ['content'], mode: 'web' as const, audit });
const therapy = (id: string) => ({ patientId: 'synthetic-patient', therapyId: id, values: { id, patientId: 'synthetic-patient', drugName: 'ENC:synthetic:drug', dosage: 'ENC:synthetic:dose', status: 'active', startDate: new Date('2026-11-17') }, changedFields: ['drugName'], mode: 'web' as const, audit });
const session = { id: 'synthetic-composition', userId: 'synthetic-doctor', username: 'synthetic-doctor', role: 'admin', authChannel: 'web' as const, createdAt: Date.now(), expiresAt: Date.now() + 60000 };
const context = { request: new Request('http://127.0.0.1/test'), session };
const body = { id: 'synthetic-service', patientId: 'synthetic-patient', prescribedAt: '2026-11-17', serviceName: 'ENC:synthetic:service' };
const counts = () => Object.fromEntries(['entries', 'therapies', 'service_prescriptions', 'audit_events'].map(table => [table, (dbServer.$client.prepare(`SELECT count(*) AS n FROM ${table}`).get() as {n:number}).n]));
const before = counts();
let positiveRollback = false;
try {
    dbServer.transaction(() => {
        assert.equal(createEntryOperation(entry('positive-note')).status, 201);
        assert.equal(createTherapyOperation(therapy('positive-therapy')).status, 201);
        throw new Error('SYNTHETIC_ROLLBACK');
    }, { behavior: 'immediate' });
} catch (e) { assert.match(String(e), /SYNTHETIC_ROLLBACK/); positiveRollback = true; }
assert.deepEqual(counts(), before);
let asyncError: string | null = null;
try {
    dbServer.transaction(async () => {
        assert.equal(createEntryOperation(entry('async-note')).status, 201);
        assert.equal(createTherapyOperation(therapy('async-therapy')).status, 201);
        const result = await createHostServicePrescription(context, body);
        assert.equal(result.status, 201);
    }, { behavior: 'immediate' });
} catch (e) { asyncError = String(e); }
await new Promise(resolve => setImmediate(resolve));
const afterAsync = counts();
assert.deepEqual(afterAsync, before);
assert.match(asyncError ?? '', /cannot return a promise/);
let pending: ReturnType<typeof createHostServicePrescription>;
dbServer.$client.exec("CREATE TRIGGER synthetic_service_fault BEFORE INSERT ON service_prescriptions BEGIN SELECT RAISE(ABORT, 'SYNTHETIC_SERVICE_FAILURE'); END");
dbServer.transaction(() => {
    assert.equal(createEntryOperation(entry('naive-note')).status, 201);
    assert.equal(createTherapyOperation(therapy('naive-therapy')).status, 201);
    pending = createHostServicePrescription(context, body);
    pending.catch(() => undefined);
}, { behavior: 'immediate' });
let serviceError: string | null = null;
try { await pending!; } catch (e) { serviceError = String(e); }
const afterNaive = counts();
const report = { positiveRollback, before, asyncError, afterAsync, serviceError, afterNaive, conclusion: 'Current public writer APIs cannot be awaited inside the synchronous transaction; ignoring the Promise permits partial commit.' };
console.log(JSON.stringify(report, null, 2));
dbServer.$client.close();
rmSync(dir, { recursive: true, force: true });
assert.deepEqual(afterNaive, before, 'A5: zero clinical writes and zero success audit must remain after failure of any element');
```
