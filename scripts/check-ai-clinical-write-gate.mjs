#!/usr/bin/env node


import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = process.cwd();
const DEFAULT_OUT = 'tmp-ai-clinical-write-gate-report.json';
const SCHEMA_FILE = 'lib/schema.ts';

const AI_PATH_GLOBS = [
    { dir: 'lib', prefix: 'ai-' },
    { dir: 'lib', prefix: 'network-ai-' },
    { dir: 'lib', prefix: 'patient-insight' },
    { dir: 'lib', prefix: 'patient-smart-import' },
    { dir: 'lib', prefix: 'treatment-reasoning' },
    { dir: 'lib/ai-providers', prefix: '', ricorsiva: true },
    { dir: 'lib/domain/documents', prefix: '', ricorsiva: true },
];

const DERIVED_PROJECTION_FIELDS = new Map([
    ['aiSummary', 'ADR 0086 §3 — proiezione derivata'],
    ['aiSummaryGeneratedAt', 'ADR 0086 §3 — metadato della proiezione'],
    ['aiSummaryContextHash', 'ADR 0086 §3 — metadato della proiezione'],
    ['documentInsights', 'ADR 0084 — le diagnosi proposte restano qui'],
]);

const BOOKKEEPING_FIELDS = new Set(['version', 'updatedAt']);

const CLINICAL_TABLES = new Set([
    'patients', 'therapies', 'entries', 'observations',
    'prostheticPrescriptions', 'documentDiagnosisProposals',
]);

const AI_PATH_WRITE_CONTRACTS = [
    {
        module: 'lib/ai-providers/fabric/function-model-settings-write.ts',
        lane: 'host-configuration',
        policy: 'bounded-settings',
        table: 'settings',
        reason: 'Persiste le impostazioni autorizzate dai controller HTTP esistenti e la generazione di revoca AI nella stessa transazione; nessuna scrittura clinica o ammissione provider.',
        reference: 'docs/adr/0076-paired-document-domain-write-policy.md',
    },
    {
        module: 'lib/ai-providers/fabric/function-model-preferences-production.ts',
        lane: 'function-preferences',
        policy: 'bounded-settings',
        table: 'settings',
        reason: 'Solo preferenze per esperienza e quattro kill switch esistenti, da comando Web autenticato con CAS; nessuna scrittura clinica o ammissione provider.',
        reference: 'docs/adr/0129-function-model-catalog-preferences.md',
    },
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
];

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

function checkDerivedProjections(findings, observed) {
    for (const contract of AI_PATH_WRITE_CONTRACTS) {
        if (contract.policy !== 'derived-projection' && contract.policy !== 'bounded-settings') continue;
        const allowed = new Set(contract.allowedFields ?? []);
        for (const write of observed.get(contract.module) ?? []) {
            if (write.table !== contract.table) {
                addFinding(findings, 'AI_WRITE_TABLE_NOT_ALLOWED',
                    `${contract.module}:${write.line} scrive \`${write.table}\`, ma il contratto ammette solo \`${contract.table}\``,
                    { module: contract.module, lane: contract.lane, table: write.table, line: write.line });
                continue;
            }
            if (contract.policy === 'bounded-settings') continue;
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

function selfTest() {
    const failures = [];
    const check = (label, condition) => { if (!condition) failures.push(label); };

    const tables = new Set(['patients', 'therapies', 'settings']);
    const writesOf = (source) => findWrites(parse('fixture.ts', source), tables);

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

    check('falso positivo su una select',
        writesOf('const rows = tx.select().from(patients).where(c).get();').length === 0);
    check('falso positivo su db.patients.get',
        writesOf('const patient = await db.patients.get(patientId);').length === 0);

    check('falso positivo su Map.delete',
        writesOf('inflight.delete(patientId); pendingRerun.delete(patientId);').length === 0);
    check('scrittura drizzle persa dopo il filtro sui simboli',
        writesOf('tx.delete(patients).where(c).run();').length === 1);

    const policyFindings = [];
    checkWritePolicyClosedSet(policyFindings);
    check('il divieto di auto_apply viene segnalato come violazione',
        !policyFindings.some((finding) => finding.code === 'AI_WRITE_POLICY_AUTO_APPLY'));

    check('spread non rilevato come opaco',
        writesOf('await db.patients.update(id, { ...payload });')[0]?.keys === null);
    check('chiave calcolata non rilevata come opaca',
        writesOf('await db.patients.update(id, { [field]: value });')[0]?.keys === null);

    check('`diagnoses` ammesso come proiezione derivata',
        !DERIVED_PROJECTION_FIELDS.has('diagnoses') && !BOOKKEEPING_FIELDS.has('diagnoses'));
    const widened = [];
    checkAllowlistIntegrity(widened, new Set([...DERIVED_PROJECTION_FIELDS.keys()]));
    check('allowlist reale già non conforme', widened.length === 0);

    for (const contract of AI_PATH_WRITE_CONTRACTS.filter(item => item.policy === 'bounded-settings')) {
        check(`${contract.module} ammette una tabella diversa da settings`, contract.table === 'settings');
        const clinicalFindings = [];
        checkDerivedProjections(clinicalFindings, new Map([[contract.module, writesOf('db.insert(patients).values({ diagnoses: value }).run();')]]));
        check(`${contract.module} ammette una scrittura clinica`, clinicalFindings.some(item => item.code === 'AI_WRITE_TABLE_NOT_ALLOWED'));
        const settingsFindings = [];
        checkDerivedProjections(settingsFindings, new Map([[contract.module, writesOf('db.insert(settings).values({ key: key, value: value }).run();')]]));
        check(`${contract.module} rifiuta key/value`, settingsFindings.length === 0);
    }

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

export { findWrites, literalKeys, AI_PATH_WRITE_CONTRACTS };
