#!/usr/bin/env node
/* @Codex */

// Nessuna scrittura clinica sul percorso AI senza revisione umana esplicita.
//
// È la traduzione eseguibile di ADR 0084 e ADR 0086, oggi affidate alla sola disciplina.
// I due ADR dicono la stessa cosa da due angoli: la sintesi documentale non tocca
// `patients.diagnoses` (0084), e `aiSummary` è una proiezione derivata che non modifica
// diagnosi, terapie o altri record clinici strutturati (0086 §3). ADR 0086 chiude con una
// regola generale: diagnosi, prescrizioni e identità paziente non sono auto-applicabili.
//
// MediFlow è local-first: nel candidato 0.8.5 i quattro smart path attraversano route
// autenticate, ma la route resta un adapter. Il punto di enforcement è il production
// root e il writer del servizio; un gate limitato ai nomi delle route passerebbe a vuoto.
//
// Il confine reale ha due lati, e il gate controlla entrambi:
//
//   1. il percorso AI scrive solo proiezioni derivate — mai un campo clinico strutturato;
//   2. la lane che *può* scrivere dati clinici (Smart Import) non importa il percorso AI.
//
// Il secondo lato è quello che rende la revisione umana una proprietà strutturale invece
// che una convenzione: proporre e applicare sono due percorsi separati, e l'operatore che
// seleziona i candidati sta in mezzo. Se `commitPatientSmartImport` potesse chiamare un
// modello per riempire `diagnoses`, la selezione esplicita diventerebbe decorativa senza
// che nessun test lo noti.
//
// L'allowlist dei campi è chiusa e verificata contro lo schema: un campo nuovo su
// `patients` è vietato al percorso AI per default, e va ammesso solo dichiarandolo come
// proiezione derivata. Fail-closed sulla crescita dello schema.
//
// Come `check:schema-writers`, l'allowlist è stale-sensitive nelle due direzioni: un
// contratto che non descrive più una scrittura reale fa fallire il gate tanto quanto una
// scrittura non dichiarata. Un writer rimosso deve togliere la propria voce.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const DEFAULT_OUT = 'tmp-ai-clinical-write-gate-report.json';
const SCHEMA_FILE = 'lib/schema.ts';

// Il percorso AI, dichiarato per esteso. Il report stampa quanti file sono stati
// analizzati: se un refactor sposta un servizio fuori da questi glob, il numero cala e
// la riduzione di perimetro resta visibile invece di passare per un gate verde.
const AI_PATH_GLOBS = [
    { dir: 'lib', prefix: 'ai-' },
    { dir: 'lib', prefix: 'athena-' },
    { dir: 'lib', prefix: 'network-ai-' },
    { dir: 'lib', prefix: 'patient-insight' },
    { dir: 'lib', prefix: 'patient-smart-import' },
    { dir: 'lib', prefix: 'treatment-reasoning' },
    /* WUL-547. Queste due voci non filtrano per nome: dichiarano «questa directory È il
       percorso AI». La discesa deve quindi essere ricorsiva. Non lo era, e i 13 moduli
       non-test di `lib/ai-providers/fabric` restavano fuori: il gate stampava «75 file
       sul percorso AI» su un insieme che è di 88. Oggi lì non ci sono scritture su tabelle
       cliniche, solo `Set.add`, quindi nessun finding era sfuggito — ma un perimetro
       dichiarato più grande di quello ispezionato è verde per il motivo sbagliato, ed è
       la forma esatta di WUL-542.

       Le voci con `prefix` restano piatte di proposito: il prefisso filtra il basename, e
       ricorrere su tutto `lib/` (276 file in radice) tirerebbe dentro omonimi estranei. */
    { dir: 'lib/ai-providers', prefix: '', ricorsiva: true },
    { dir: 'lib/domain/documents', prefix: '', ricorsiva: true },
];

// I soli campi di `patients` che il percorso AI può scrivere: proiezioni derivate e
// rivedibili, non record clinici. Ogni voce cita l'ADR che la ammette.
const DERIVED_PROJECTION_FIELDS = new Map([
    ['aiSummary', 'ADR 0086 §3 — proiezione derivata'],
    ['aiSummaryGeneratedAt', 'ADR 0086 §3 — metadato della proiezione'],
    ['aiSummaryContextHash', 'ADR 0086 §3 — metadato della proiezione'],
    ['documentInsights', 'ADR 0084 — le diagnosi proposte restano qui'],
]);

// Contabilità di riga, non contenuto clinico.
const BOOKKEEPING_FIELDS = new Set(['version', 'updatedAt']);

// Tabelle che contengono record clinici strutturati. Una scrittura su queste dal percorso
// AI è vietata a prescindere dai campi.
const CLINICAL_TABLES = new Set([
    'patients', 'therapies', 'entries', 'observations',
    'prostheticPrescriptions', 'documentDiagnosisProposals',
]);

// Ogni scrittura del percorso AI, dichiarata. `policy` decide che cosa viene verificato.
const AI_PATH_WRITE_CONTRACTS = [
    {
        module: 'lib/ai-summary-service.ts',
        lane: 'patient-insight',
        policy: 'derived-projection',
        table: 'patients',
        allowedFields: ['aiSummary', 'aiSummaryGeneratedAt', 'aiSummaryContextHash', 'version', 'updatedAt'],
        reason: 'Patient Insight salva una proiezione derivata e rivedibile. Non modifica '
            + 'diagnosi, terapie o altri record clinici strutturati.',
        reference: 'docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md',
    },
    {
        module: 'lib/domain/documents/document-synthesis-service.ts',
        lane: 'document-synthesis',
        policy: 'derived-projection',
        table: 'patients',
        allowedFields: ['documentInsights', 'version', 'updatedAt'],
        reason: 'La sintesi documentale conserva summary, evidenza e diagnosi proposte in '
            + '`documentInsights`. Non aggiunge né aggiorna `patients.diagnoses`.',
        reference: 'docs/adr/0084-document-diagnoses-review-only.md',
    },
    {
        module: 'lib/ai-insight-settings.ts',
        lane: 'ai-settings',
        policy: 'non-clinical',
        table: 'settings',
        reason: 'Preferenze della lane Patient Insight: configurazione, non dato clinico.',
        reference: 'docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md',
    },
    {
        module: 'lib/ai-models.ts',
        lane: 'ai-settings',
        policy: 'non-clinical',
        table: 'settings',
        reason: 'Selezione del modello e default: configurazione, non dato clinico.',
        reference: 'docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md',
    },
    {
        module: 'lib/ai-providers/fabric/durable-review-record-store.ts',
        lane: 'durable-review',
        policy: 'non-clinical',
        table: 'durableReviewRecords',
        reason: 'Conserva soltanto envelope review sigillati e ledger di replay con digest; non scrive record clinici strutturati, decisioni o apply.',
        reference: 'docs/adr/0094-intelligence-fabric-headless-contract-085.md',
    },
    {
        module: 'lib/ai-providers/fabric/physician-review-command.ts',
        lane: 'physician-review',
        policy: 'non-clinical',
        table: 'durableReviewCommandStates',
        reason: 'La transazione registra solo stato review terminale, replay idempotente e audit PHI-safe; non scrive record clinici strutturati né espone apply.',
        reference: 'docs/adr/0095-broker-projection-e-servizi-host-per-capability.md',
    },
    {
        module: 'lib/patient-smart-import-apply.ts',
        lane: 'smart-import',
        policy: 'operator-confirmed',
        table: 'patients',
        entryPoint: 'commitPatientSmartImport',
        concurrencyField: 'expectedVersion',
        selectionEntryPoint: {
            module: 'lib/domain/documents/patient-smart-import-service.ts',
            name: 'applyPatientSmartImportSelection',
            parameter: 'selection',
        },
        reason: 'Unica lane autorizzata a scrivere dati clinici da un percorso AI. La '
            + 'scrittura avviene solo sui candidati selezionati esplicitamente '
            + 'dall\'operatore, con versione concorrente attesa e audit. Il writer non '
            + 'importa il percorso AI: proporre e applicare restano separati.',
        reference: 'docs/adr/0086-intelligent-scaffold-and-graded-automation-boundary.md',
    },
];

// ADR 0086 §4: le write policy di Atena sono un insieme chiuso. `auto_apply` non esiste.
const TREATMENT_REASONING_CONTRACT = 'lib/treatment-reasoning-contract.ts';
const ALLOWED_WRITE_POLICIES = ['no_write', 'review_only', 'form_prefill_only'];
const FORBIDDEN_WRITE_POLICY = 'auto_apply';

function read(relativePath) {
    return fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
}

function exists(relativePath) {
    return fs.existsSync(path.join(ROOT, relativePath));
}

function addFinding(findings, code, message, details = {}) {
    findings.push({ code, message, ...details });
}

function parse(relativePath, source) {
    return ts.createSourceFile(relativePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

function aiPathFiles() {
    const files = [];
    for (const { dir, prefix, ricorsiva } of AI_PATH_GLOBS) {
        const absolute = path.join(ROOT, dir);
        if (!fs.existsSync(absolute)) continue;
        const voci = fs.readdirSync(absolute, {
            recursive: Boolean(ricorsiva),
            withFileTypes: true,
        });
        for (const voce of voci) {
            if (!voce.isFile()) continue;
            const { name } = voce;
            if (!name.endsWith('.ts') && !name.endsWith('.tsx')) continue;
            if (name.includes('.test.') || name.includes('.fixtures.')) continue;
            if (!name.startsWith(prefix)) continue;
            /* Con `recursive` il file puo' stare in una sottodirectory: `parentPath` la porta. */
            const relativa = path.relative(absolute, path.join(voce.parentPath ?? absolute, name));
            files.push(path.posix.join(dir, relativa.split(path.sep).join('/')));
        }
    }
    return [...new Set(files)].sort();
}

function unwrap(expression) {
    let current = expression;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
        || ts.isNonNullExpression(current) || ts.isAwaitExpression(current)
        || ts.isSatisfiesExpression(current)) current = current.expression;
    return current;
}

// Le chiavi di un object literal, oppure `null` se la forma non è analizzabile
// staticamente: spread e chiavi calcolate possono introdurre qualunque campo, quindi
// valgono come fallimento e non come assenza di campi.
function literalKeys(node) {
    if (!node || !ts.isObjectLiteralExpression(node)) return null;
    const keys = [];
    for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) return null;
        if (!property.name) return null;
        if (ts.isComputedPropertyName(property.name)) return null;
        if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
            keys.push(property.name.text);
            continue;
        }
        return null;
    }
    return keys;
}

// Trova le scritture in un modulo, in due forme:
//   - astrazione db:  db.<table>.update(id, {...})  ·  db.<table>.put({...})
//   - drizzle:        tx.update(<table>).set({...}) ·  tx.insert(<table>).values(...)
function findWrites(sourceFile, tableSymbols = schemaTableSymbols()) {
    const writes = [];
    const collectionMethods = new Set(['update', 'create', 'delete', 'put', 'add']);
    const drizzleMethods = new Set(['update', 'insert', 'delete']);
    const at = (node) => sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;

    const visit = (node) => {
        if (ts.isCallExpression(node)) {
            const callee = unwrap(node.expression);
            if (ts.isPropertyAccessExpression(callee)) {
                const method = callee.name.text;
                const receiver = unwrap(callee.expression);

                // Astrazione db: db.<table>.<method>(...)
                if (collectionMethods.has(method)
                    && ts.isPropertyAccessExpression(receiver)
                    && ts.isIdentifier(receiver.expression)
                    && /^db/i.test(receiver.expression.text)) {
                    const argument = method === 'put' || method === 'add'
                        ? node.arguments[0]
                        : node.arguments[1];
                    writes.push({
                        table: receiver.name.text,
                        method,
                        keys: literalKeys(argument),
                        line: at(node),
                    });
                }

                // Drizzle: (tx|db).update(<table>).set({...}) · .insert(<table>) · .delete(<table>)
                // L'argomento deve essere un simbolo tabella dello schema, altrimenti
                // `inflight.delete(patientId)` verrebbe letto come una cancellazione.
                if (drizzleMethods.has(method)
                    && ts.isIdentifier(receiver)
                    && node.arguments.length === 1) {
                    const argument = unwrap(node.arguments[0]);
                    if (ts.isIdentifier(argument) && tableSymbols.has(argument.text)) {
                        writes.push({
                            table: argument.text,
                            method,
                            keys: method === 'update' ? drizzleSetKeys(node) : null,
                            line: at(node),
                        });
                    }
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(sourceFile);
    return writes;
}

// Da `tx.update(patients)` risale la catena fluente fino a `.set({...})`.
function drizzleSetKeys(updateCall) {
    let current = updateCall;
    while (current.parent && ts.isPropertyAccessExpression(current.parent)
        && ts.isCallExpression(current.parent.parent)) {
        const call = current.parent.parent;
        if (current.parent.name.text === 'set') return literalKeys(call.arguments[0]);
        current = call;
    }
    return null;
}

function importedModules(sourceFile) {
    return sourceFile.statements.flatMap((statement) => {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) return [];
        if (statement.importClause?.isTypeOnly) return [];
        return [statement.moduleSpecifier.text];
    });
}

// Risolve uno specifier relativo o con alias `@/` a un percorso repo-relative.
function resolveSpecifier(fromModule, specifier) {
    const base = specifier.startsWith('@/')
        ? specifier.slice(2)
        : specifier.startsWith('.')
            ? path.posix.normalize(path.posix.join(path.posix.dirname(fromModule), specifier))
            : null;
    if (!base) return null;
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.posix.join(base, 'index.ts')]) {
        if (exists(candidate)) return candidate;
    }
    return null;
}

// I simboli tabella esportati da lib/schema.ts. Servono a distinguere una scrittura
// drizzle (`tx.delete(patients)`) da un'omonimia innocua (`inflight.delete(patientId)`):
// senza questo confronto un `Map.delete` risulta una cancellazione di tabella.
function schemaTableSymbols() {
    return new Set([...read(SCHEMA_FILE).matchAll(/^export const ([a-zA-Z][a-zA-Z0-9_]*) = sqliteTable\(/gm)]
        .map((match) => match[1]));
}

function schemaPatientFields() {
    const source = read(SCHEMA_FILE);
    const block = source.match(/export const patients = sqliteTable\([\s\S]*?\n\}/);
    if (!block) return null;
    return new Set([...block[0].matchAll(/^\s{2,}([a-zA-Z][a-zA-Z0-9_]*):/gm)].map((match) => match[1]));
}

// 1 + 2. Ogni scrittura del percorso AI è dichiarata, e ogni contratto descrive una
// scrittura che esiste ancora.
function checkDeclaredWrites(findings, files, tableSymbols) {
    const declared = new Map(AI_PATH_WRITE_CONTRACTS.map((contract) => [contract.module, contract]));
    const observed = new Map();

    for (const file of files) {
        const writes = findWrites(parse(file, read(file)), tableSymbols);
        if (writes.length > 0) observed.set(file, writes);
        if (writes.length === 0 || declared.has(file)) continue;
        for (const write of writes) {
            addFinding(findings, 'AI_WRITE_UNDECLARED',
                `Scrittura non dichiarata sul percorso AI: ${file}:${write.line} scrive \`${write.table}\``, {
                    module: file, table: write.table, line: write.line,
                    hint: CLINICAL_TABLES.has(write.table)
                        ? 'Tabella clinica. ADR 0086 vieta l\'auto-applicazione: serve una lane '
                          + 'con selezione esplicita dell\'operatore, non una voce in questo file.'
                        : 'Aggiungi un contratto in AI_PATH_WRITE_CONTRACTS con motivo e riferimento.',
                });
        }
    }

    for (const [module, contract] of declared) {
        if (!exists(module)) {
            addFinding(findings, 'AI_WRITE_STALE_CONTRACT',
                `Contratto dichiarato per un modulo assente: ${module}. Rimuovi la voce.`,
                { module, lane: contract.lane });
            continue;
        }
        if (!observed.has(module)) {
            addFinding(findings, 'AI_WRITE_STALE_CONTRACT',
                `Il contratto di ${module} non descrive più una scrittura reale. Rimuovi la voce.`,
                { module, lane: contract.lane });
        }
    }
    return observed;
}

// 3. Le proiezioni derivate scrivono solo i campi ammessi, e in forma analizzabile.
function checkDerivedProjections(findings, observed) {
    for (const contract of AI_PATH_WRITE_CONTRACTS) {
        if (contract.policy !== 'derived-projection') continue;
        const allowed = new Set(contract.allowedFields);
        for (const write of observed.get(contract.module) ?? []) {
            if (write.table !== contract.table) {
                addFinding(findings, 'AI_WRITE_TABLE_NOT_ALLOWED',
                    `${contract.module}:${write.line} scrive \`${write.table}\`, ma il contratto ammette solo \`${contract.table}\``,
                    { module: contract.module, lane: contract.lane, table: write.table, line: write.line });
                continue;
            }
            if (write.keys === null) {
                addFinding(findings, 'AI_WRITE_OPAQUE_PAYLOAD',
                    `${contract.module}:${write.line} scrive con spread o chiave calcolata: i campi non sono verificabili staticamente`,
                    { module: contract.module, lane: contract.lane, line: write.line });
                continue;
            }
            for (const key of write.keys) {
                if (allowed.has(key)) continue;
                addFinding(findings, 'AI_WRITE_FIELD_NOT_ALLOWED',
                    `${contract.module}:${write.line} scrive il campo \`${key}\`, fuori dall'allowlist della lane ${contract.lane}`, {
                        module: contract.module, lane: contract.lane, field: key, line: write.line,
                        reference: contract.reference,
                    });
            }
        }
    }
}

// 4. L'allowlist stessa non può essere allargata a un campo clinico. È il controllo che
// impedisce di aggirare il gate aggiungendo `diagnoses` all'elenco dei campi ammessi.
function checkAllowlistIntegrity(findings, patientFields) {
    for (const contract of AI_PATH_WRITE_CONTRACTS) {
        if (contract.policy !== 'derived-projection') continue;
        for (const field of contract.allowedFields) {
            if (DERIVED_PROJECTION_FIELDS.has(field) || BOOKKEEPING_FIELDS.has(field)) continue;
            addFinding(findings, 'AI_WRITE_ALLOWLIST_WIDENED',
                `L'allowlist della lane ${contract.lane} ammette \`${field}\`, che non è una proiezione derivata riconosciuta`, {
                    module: contract.module, lane: contract.lane, field,
                    hint: 'ADR 0086: diagnosi, prescrizioni e identità paziente non sono auto-applicabili. '
                        + 'Un campo nuovo va prima riconosciuto come proiezione derivata in DERIVED_PROJECTION_FIELDS.',
                });
        }
    }
    if (!patientFields) {
        addFinding(findings, 'AI_WRITE_SCHEMA_UNREADABLE',
            `Impossibile leggere i campi di \`patients\` da ${SCHEMA_FILE}: il gate non può verificare l'allowlist`);
        return;
    }
    for (const [field] of DERIVED_PROJECTION_FIELDS) {
        if (patientFields.has(field)) continue;
        addFinding(findings, 'AI_WRITE_STALE_PROJECTION_FIELD',
            `\`${field}\` è dichiarato proiezione derivata ma non esiste più in ${SCHEMA_FILE}. Rimuovi la voce.`,
            { field });
    }
}

// 5 + 6. La lane autorizzata resta disaccoppiata dal percorso AI e conserva il gesto
// esplicito: selezione dell'operatore e versione concorrente attesa.
function checkOperatorConfirmedLane(findings, aiPath) {
    const aiPathSet = new Set(aiPath);
    for (const contract of AI_PATH_WRITE_CONTRACTS) {
        if (contract.policy !== 'operator-confirmed') continue;
        if (!exists(contract.module)) continue;
        const sourceFile = parse(contract.module, read(contract.module));

        for (const specifier of importedModules(sourceFile)) {
            const resolved = resolveSpecifier(contract.module, specifier);
            if (!resolved || resolved === contract.module || !aiPathSet.has(resolved)) continue;
            addFinding(findings, 'AI_WRITE_LANE_COUPLING',
                `${contract.module} importa il percorso AI (${resolved}): proporre e applicare devono restare separati`, {
                    module: contract.module, lane: contract.lane, imported: resolved,
                    hint: 'La revisione umana è garantita dalla separazione fra la proposta e '
                        + 'l\'applicazione. Un writer che invoca il modello la annulla.',
                });
        }

        const entry = sourceFile.statements.find((statement) => ts.isFunctionDeclaration(statement)
            && statement.name?.text === contract.entryPoint);
        if (!entry) {
            addFinding(findings, 'AI_WRITE_ENTRY_MISSING',
                `Entry point assente o rinominato: ${contract.entryPoint} in ${contract.module}`,
                { module: contract.module, lane: contract.lane });
        } else if (!read(contract.module).includes(`${contract.concurrencyField}`)) {
            addFinding(findings, 'AI_WRITE_NO_CONCURRENCY',
                `${contract.entryPoint} non usa \`${contract.concurrencyField}\`: la scrittura confermata perde la versione concorrente`,
                { module: contract.module, lane: contract.lane });
        }

        const selection = contract.selectionEntryPoint;
        if (!selection || !exists(selection.module)) {
            addFinding(findings, 'AI_WRITE_SELECTION_MISSING',
                `Modulo di selezione assente per la lane ${contract.lane}`, { lane: contract.lane });
            continue;
        }
        const selectionSource = parse(selection.module, read(selection.module));
        const selectionEntry = selectionSource.statements.find((statement) =>
            ts.isFunctionDeclaration(statement) && statement.name?.text === selection.name);
        if (!selectionEntry) {
            addFinding(findings, 'AI_WRITE_SELECTION_MISSING',
                `Entry point di selezione assente o rinominato: ${selection.name} in ${selection.module}`,
                { module: selection.module, lane: contract.lane });
            continue;
        }
        const hasSelectionParameter = selectionEntry.parameters.some((parameter) =>
            ts.isIdentifier(parameter.name) && parameter.name.text === selection.parameter);
        if (!hasSelectionParameter) {
            addFinding(findings, 'AI_WRITE_SELECTION_IMPLICIT',
                `${selection.name} non riceve più un parametro \`${selection.parameter}\`: l'applicazione non è più vincolata a una scelta esplicita`, {
                    module: selection.module, lane: contract.lane,
                    hint: 'ADR 0086: la scrittura avviene solo dopo selezione esplicita nel flusso Smart Import.',
                });
        }
    }
}

// 7. Le write policy di Atena restano un insieme chiuso, senza auto-applicazione.
function checkWritePolicyClosedSet(findings) {
    if (!exists(TREATMENT_REASONING_CONTRACT)) {
        addFinding(findings, 'AI_WRITE_POLICY_CONTRACT_MISSING',
            `Contratto assente: ${TREATMENT_REASONING_CONTRACT}`);
        return;
    }
    const source = read(TREATMENT_REASONING_CONTRACT);
    for (const policy of ALLOWED_WRITE_POLICIES) {
        if (source.includes(`'${policy}'`)) continue;
        addFinding(findings, 'AI_WRITE_POLICY_INCOMPLETE',
            `Write policy mancante dal contratto Atena: ${policy}`,
            { file: TREATMENT_REASONING_CONTRACT, policy });
    }
    // Solo `auto_apply` come valore quotato conta come violazione. Il contratto lo nomina
    // dentro il prompt che lo vieta ("...: mai auto_apply."), e un match su sottostringa
    // segnalerebbe il divieto stesso.
    if (source.includes(`'${FORBIDDEN_WRITE_POLICY}'`) || source.includes(`"${FORBIDDEN_WRITE_POLICY}"`)) {
        addFinding(findings, 'AI_WRITE_POLICY_AUTO_APPLY',
            `Il contratto Atena ammette \`${FORBIDDEN_WRITE_POLICY}\` come valore: ADR 0086 §4 limita le policy a ${ALLOWED_WRITE_POLICIES.join(', ')}`,
            { file: TREATMENT_REASONING_CONTRACT });
    }
}

function parseArgs(argv) {
    const options = { out: process.env.MEDIFLOW_AI_CLINICAL_WRITE_GATE_OUT || DEFAULT_OUT };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--out' && argv[index + 1]) {
            options.out = argv[index + 1];
            index += 1;
        }
    }
    return options;
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const findings = [];
    const files = aiPathFiles();

    const observed = checkDeclaredWrites(findings, files, schemaTableSymbols());
    checkDerivedProjections(findings, observed);
    checkAllowlistIntegrity(findings, schemaPatientFields());
    checkOperatorConfirmedLane(findings, files);
    checkWritePolicyClosedSet(findings);

    const report = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        status: findings.length === 0 ? 'pass' : 'fail',
        checked: {
            aiPathFiles: files.length,
            declaredContracts: AI_PATH_WRITE_CONTRACTS.length,
            observedWriteModules: observed.size,
            derivedProjectionFields: [...DERIVED_PROJECTION_FIELDS.keys()],
            clinicalTables: [...CLINICAL_TABLES],
        },
        findings,
    };

    const outPath = path.join(ROOT, options.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);

    if (findings.length === 0) {
        process.stdout.write(`AI clinical write gate passed: ${files.length} file(s) sul percorso AI, `
            + `${observed.size} con scritture, tutte dichiarate. Report: ${options.out}\n`);
        return;
    }

    process.stderr.write(`AI clinical write gate failed with ${findings.length} finding(s). Report: ${options.out}\n`);
    for (const finding of findings) {
        process.stderr.write(`- ${finding.code}: ${finding.message}\n`);
        if (finding.hint) process.stderr.write(`  ${finding.hint}\n`);
    }
    process.exit(1);
}

// Il gate deve dimostrare di saper fallire: un controllo che non distingue una violazione
// da un caso lecito passa in silenzio proprio quando serve.
function selfTest() {
    const failures = [];
    const check = (label, condition) => { if (!condition) failures.push(label); };

    const tables = new Set(['patients', 'therapies', 'settings']);
    const writesOf = (source) => findWrites(parse('fixture.ts', source), tables);

    // Forme di scrittura riconosciute.
    const dbUpdate = writesOf('await db.patients.update(id, { aiSummary: x, version: 1 });');
    check('db.<table>.update non riconosciuta',
        dbUpdate.length === 1 && dbUpdate[0].table === 'patients');
    check('campi di db.<table>.update non estratti',
        JSON.stringify(dbUpdate[0]?.keys) === JSON.stringify(['aiSummary', 'version']));

    const dbPut = writesOf('await db.settings.put({ key: k, value: v });');
    check('db.<table>.put non riconosciuta', dbPut.length === 1 && dbPut[0].table === 'settings');

    const drizzle = writesOf('tx.update(patients).set({ diagnoses: d, version: 2 }).where(c).run();');
    check('drizzle update().set() non riconosciuta',
        drizzle.length === 1 && drizzle[0].table === 'patients');
    check('campi di drizzle .set() non estratti',
        JSON.stringify(drizzle[0]?.keys) === JSON.stringify(['diagnoses', 'version']));

    const insert = writesOf('tx.insert(therapies).values(row).run();');
    check('drizzle insert non riconosciuta', insert.length === 1 && insert[0].table === 'therapies');

    // Le letture non sono scritture.
    check('falso positivo su una select',
        writesOf('const rows = tx.select().from(patients).where(c).get();').length === 0);
    check('falso positivo su db.patients.get',
        writesOf('const patient = await db.patients.get(patientId);').length === 0);

    // Regressione: `Map.delete` ha la stessa forma di `tx.delete(<table>)`. A distinguerli
    // è solo il confronto con i simboli tabella dello schema. Senza, il gate segnalava
    // tre scritture inesistenti in lib/ai-summary-service.ts.
    check('falso positivo su Map.delete',
        writesOf('inflight.delete(patientId); pendingRerun.delete(patientId);').length === 0);
    check('scrittura drizzle persa dopo il filtro sui simboli',
        writesOf('tx.delete(patients).where(c).run();').length === 1);

    // Il divieto di `auto_apply` non deve segnalare sé stesso: il contratto Atena nomina
    // la policy dentro la stringa che la vieta.
    const policyFindings = [];
    checkWritePolicyClosedSet(policyFindings);
    check('il divieto di auto_apply viene segnalato come violazione',
        !policyFindings.some((finding) => finding.code === 'AI_WRITE_POLICY_AUTO_APPLY'));

    // Payload non analizzabili: devono risultare opachi, non vuoti.
    check('spread non rilevato come opaco',
        writesOf('await db.patients.update(id, { ...payload });')[0]?.keys === null);
    check('chiave calcolata non rilevata come opaca',
        writesOf('await db.patients.update(id, { [field]: value });')[0]?.keys === null);

    // Il fail-closed dell'allowlist: `diagnoses` non è una proiezione derivata.
    check('`diagnoses` ammesso come proiezione derivata',
        !DERIVED_PROJECTION_FIELDS.has('diagnoses') && !BOOKKEEPING_FIELDS.has('diagnoses'));
    const widened = [];
    checkAllowlistIntegrity(widened, new Set([...DERIVED_PROJECTION_FIELDS.keys()]));
    check('allowlist reale già non conforme', widened.length === 0);

    // Ogni contratto porta motivo e riferimento leggibili.
    for (const contract of AI_PATH_WRITE_CONTRACTS) {
        check(`contratto ${contract.module} senza motivo o riferimento`,
            Boolean(contract.reason && contract.reference));
        check(`riferimento inesistente per ${contract.module}`, exists(contract.reference));
    }

    if (failures.length === 0) {
        process.stdout.write('AI clinical write gate self-test passed: '
            + `${AI_PATH_WRITE_CONTRACTS.length} contratto/i documentato/i, forme di scrittura e casi opachi distinti.\n`);
        return;
    }
    process.stderr.write('AI clinical write gate self-test failed:\n');
    for (const failure of failures) process.stderr.write(`- ${failure}\n`);
    process.exit(1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    if (process.argv.includes('--self-test')) selfTest();
    else main();
}

export { findWrites, literalKeys, resolveSpecifier, AI_PATH_WRITE_CONTRACTS };
