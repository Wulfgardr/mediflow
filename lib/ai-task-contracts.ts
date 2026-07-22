/* @Codex */
import { filterServicePrescriptionTherapyCandidates, isServicePrescriptionLikeTherapy } from './prescription-boundary';
import { stripModelArtifacts } from './model-artifacts';
import { AI_TASK_EXTRACTION_SCHEMA_VERSION } from './ai-task-contract-prompts';

/* @Codex */
export {
    AI_TASK_EXTRACTION_SCHEMA_VERSION,
    buildDocumentSynthesisExtractionPrompt,
    buildPatientInsightExtractionPrompt,
    buildSmartImportExtractionPrompt,
} from './ai-task-contract-prompts';

/* @Codex */
export type AITaskKind = 'patient_insight' | 'smart_import' | 'document_synthesis';

/* @Codex */
export interface AITaskEnvelope<TTask extends AITaskKind, TData> {
    schemaVersion: typeof AI_TASK_EXTRACTION_SCHEMA_VERSION;
    task: TTask;
    summary: string;
    data: TData;
}

/* @Codex */
export interface AITaskParseResult<T> {
    value: T;
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    legacyContract: boolean;
    repairedTruncation: boolean;
}

/* @Codex */
export function isEnvelopeUsable(envelope: { validJson?: unknown; validTask?: unknown }): boolean {
    return envelope.validJson === true && envelope.validTask === true;
}

/* @Codex: contratto WUL-362 - rilevazione e risoluzione canonica degli envelope moderni.
   Evidenza minima bilanciata: schemaVersion col prefisso mediflow.ai.extract, oppure
   task noto accompagnato da almeno uno tra schemaVersion, data e summary. La sola
   chiave task non basta: uno snippet dimostrativo storico resta leggibile. */
export type ModernEnvelopeEvidence = 'present' | 'absent' | 'unknown';

const ENVELOPE_SCHEMA_PREFIX = 'mediflow.ai.extract';
const KNOWN_AI_TASK_IDS = new Set(['patient_insight', 'smart_import', 'document_synthesis']);

// Budget espliciti e condivisi della scansione: superarne uno degrada fail-closed
// (ambiguous nel resolver, unknown nel rilevatore tri-state), mai a legacy-text.
const ENVELOPE_SCAN_MAX_CHARS = 400000;
const ENVELOPE_SCAN_MAX_DEPTH = 8;
const ENVELOPE_SCAN_MAX_NODES = 256;
const ENVELOPE_SCAN_MAX_STRING_PARSES = 8;
const ENVELOPE_SCAN_MAX_FRAGMENTS = 8;
const ENVELOPE_SCAN_MAX_STRING_LENGTH = 100000;

// Gli sniff accettano sia doppi che singoli apici: i frammenti pseudo-JSON non
// parseabili restano dichiarazioni moderne.
const ENVELOPE_SNIFF_SCHEMA_PATTERN = /["']schemaversion["']\s*:\s*["']mediflow\.ai\.extract(?:\.|["'])/i;
const ENVELOPE_SNIFF_TASK_PATTERN = /["']task["']\s*:\s*["'](patient_insight|smart_import|document_synthesis)["']/i;
const ENVELOPE_SNIFF_SUPPORT_PATTERN = /["'](schemaversion|data|summary)["']\s*:/i;

/* @Codex */
type EnvelopeScanBudget = {
    chars: number;
    fragmentCharacterVisits: number;
    realFragments: number;
    nodes: number;
    stringParses: number;
    truncated: boolean;
};

/* @Codex */
function createEnvelopeScanBudget(): EnvelopeScanBudget {
    return {
        chars: 0,
        fragmentCharacterVisits: 0,
        realFragments: 0,
        nodes: 0,
        stringParses: 0,
        truncated: false,
    };
}

/* @Codex */
function consumeScanChars(budget: EnvelopeScanBudget, amount: number): boolean {
    budget.chars += amount;
    if (budget.chars > ENVELOPE_SCAN_MAX_CHARS) {
        budget.truncated = true;
        return false;
    }
    return true;
}

/* @Codex WUL-362 R5b: il limite dei candidati reali appartiene all'intera
   scansione, non alla singola stringa o al singolo layer. */
function consumeRealFragment(budget: EnvelopeScanBudget): boolean {
    if (budget.realFragments >= ENVELOPE_SCAN_MAX_FRAGMENTS) {
        budget.truncated = true;
        return false;
    }
    budget.realFragments += 1;
    return true;
}

/* @Codex */
function readEnvelopeKey(record: Record<string, unknown>, lowerCaseName: string): unknown {
    for (const key of Object.keys(record)) {
        if (key.toLowerCase() === lowerCaseName) return record[key];
    }
    return undefined;
}

/* @Codex: evidenza minima bilanciata (contratto punto 4) */
function declaresModernEnvelopeRecord(record: Record<string, unknown>): boolean {
    const schemaValue = readEnvelopeKey(record, 'schemaversion');
    if (typeof schemaValue === 'string' && isModernSchemaVersionValue(schemaValue)) {
        return true;
    }
    const taskValue = readEnvelopeKey(record, 'task');
    const taskId = typeof taskValue === 'string' ? taskValue.trim().toLowerCase() : null;
    if (taskId === null || !KNOWN_AI_TASK_IDS.has(taskId)) return false;
    return readEnvelopeKey(record, 'schemaversion') !== undefined
        || readEnvelopeKey(record, 'data') !== undefined
        || readEnvelopeKey(record, 'summary') !== undefined;
}

/* @Codex: applica una sola decodifica degli escape JavaScript al segmento.
   Gli escape di controllo restano caratteri di controllo; gli escape di
   identita rimuovono solo il backslash. Le sequenze Unicode o esadecimali non
   valide restano letterali, cosi non producono lettere sintetiche. */
function decodeJavascriptStyleEscapesOnce(text: string): string {
    let decoded = '';
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index];
        if (char !== '\\' || index + 1 >= text.length) {
            decoded += char;
            continue;
        }

        const escapeStart = index;
        const escaped = text[index + 1];
        index += 1;
        switch (escaped) {
            case 'b': decoded += '\b'; continue;
            case 'f': decoded += '\f'; continue;
            case 'n': decoded += '\n'; continue;
            case 'r': decoded += '\r'; continue;
            case 't': decoded += '\t'; continue;
            case 'v': decoded += '\v'; continue;
            case '0': decoded += '\0'; continue;
        }
        if (escaped === '\n') continue;
        if (escaped === '\r') {
            if (text[index + 1] === '\n') index += 1;
            continue;
        }
        if (escaped === 'x') {
            const hex = text.slice(index + 1, index + 3);
            if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                decoded += String.fromCharCode(Number.parseInt(hex, 16));
                index += 2;
            } else {
                decoded += text.slice(escapeStart, index + 1);
            }
            continue;
        }
        if (escaped === 'u') {
            if (text[index + 1] === '{') {
                let cursor = index + 2;
                while (cursor < text.length
                    && cursor < index + 8
                    && /^[0-9a-fA-F]$/.test(text[cursor])) {
                    cursor += 1;
                }
                const hex = text.slice(index + 2, cursor);
                const codePoint = hex.length > 0 ? Number.parseInt(hex, 16) : -1;
                if (text[cursor] === '}' && codePoint >= 0 && codePoint <= 0x10FFFF) {
                    decoded += String.fromCodePoint(codePoint);
                    index = cursor;
                } else {
                    decoded += text.slice(escapeStart, index + 1);
                }
                continue;
            }
            const hex = text.slice(index + 1, index + 5);
            if (/^[0-9a-fA-F]{4}$/.test(hex)) {
                decoded += String.fromCharCode(Number.parseInt(hex, 16));
                index += 4;
            } else {
                decoded += text.slice(escapeStart, index + 1);
            }
            continue;
        }
        decoded += escaped;
    }
    return decoded;
}

/* @Codex: sniff allineato all'evidenza minima, per frammenti dichiarati non parseabili */
function sniffMatchesModernEnvelope(text: string): boolean {
    return ENVELOPE_SNIFF_SCHEMA_PATTERN.test(text)
        || (ENVELOPE_SNIFF_TASK_PATTERN.test(text) && ENVELOPE_SNIFF_SUPPORT_PATTERN.test(text));
}

/* @Codex: il match usa il segmento grezzo oppure la sua singola decodifica.
   I layer stringificati successivi restano responsabilita del walk JSON. */
function sniffDeclaresModernEnvelope(text: string): boolean {
    if (sniffMatchesModernEnvelope(text)) return true;
    if (!text.includes('\\')) return false;
    return sniffMatchesModernEnvelope(decodeJavascriptStyleEscapesOnce(text));
}

/* @Codex: contratto WUL-362 F1 - evidenza aggregata delle chiavi RAW di un
   documento JSON, letta prima della riduzione last-wins di JSON.parse. La
   primitive decodifica internamente le chiavi e i soli valori stringa necessari
   (task, schemaVersion) e restituisce esclusivamente booleani aggregati: nessuna
   lista raw, nessun contenuto di data o summary conservato o loggato.
   Duplice chiave: uguaglianza esatta case-sensitive dopo il decoding JSON.
   Collisione di chiave riservata: confronto ASCII case-insensitive dopo il
   decoding. La scansione e lineare sul documento (gia dentro il budget caratteri
   del chiamante); un errore di decodifica o uno scope non chiuso degrada a
   unknown, mai a un esito permissivo. */
type JsonDocumentKeyEvidence =
    | {
        status: 'complete';
        hasAmbiguousKeys: boolean;
        declaresModernEnvelope: boolean;
    }
    | { status: 'unknown' };

const RESERVED_ENVELOPE_KEY_NAMES = new Set(['schemaversion', 'task', 'data', 'summary']);

// Solo A-Z: nessuna normalizzazione Unicode oltre la decodifica JSON.
function asciiLowerCase(value: string): string {
    return value.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
}

function isModernSchemaVersionValue(value: string): boolean {
    const normalized = asciiLowerCase(value.trim());
    // Prefisso esatto o dotted: mediflow.ai.extractor non e una dichiarazione.
    return normalized === ENVELOPE_SCHEMA_PREFIX || normalized.startsWith(`${ENVELOPE_SCHEMA_PREFIX}.`);
}

function isKnownTaskValue(value: string): boolean {
    return KNOWN_AI_TASK_IDS.has(asciiLowerCase(value.trim()));
}

/* @Codex */
type RawObjectScope = {
    kind: 'object';
    exactKeys: Set<string>;
    reservedLower: Set<string>;
    taskCollision: boolean;
    taskKnown: boolean;
    schemaModern: boolean;
    supportSeen: boolean;
};

/* @Codex: uno scope oggetto dichiara evidenza moderna se, sulle sole chiavi e
   valori RAW dello stesso scope, vale almeno uno dei tre casi del contratto:
   schemaVersion MediFlow valida; task noto con chiave di supporto; duplicazione
   o collisione di task con almeno un valore task noto. Scope, elementi di array
   e frammenti distinti non vengono mai combinati. */
function scanJsonDocumentKeyEvidence(rawJson: string): JsonDocumentKeyEvidence {
    const scopes: Array<{ kind: 'array' } | RawObjectScope> = [];
    let hasAmbiguousKeys = false;
    let declaresModernEnvelope = false;
    let index = 0;

    const closeScope = (scope: { kind: 'array' } | RawObjectScope | undefined): void => {
        if (scope?.kind !== 'object') return;
        if (scope.schemaModern
            || (scope.taskKnown && scope.supportSeen)
            || (scope.taskKnown && scope.taskCollision)) {
            declaresModernEnvelope = true;
        }
    };

    const readStringToken = (start: number): number => {
        let cursor = start + 1;
        let escaped = false;
        while (cursor < rawJson.length) {
            const tokenChar = rawJson[cursor];
            cursor += 1;
            if (escaped) {
                escaped = false;
                continue;
            }
            if (tokenChar === '\\') {
                escaped = true;
                continue;
            }
            if (tokenChar === '"') break;
        }
        return cursor;
    };

    while (index < rawJson.length) {
        const char = rawJson[index];
        if (char === '{') {
            scopes.push({
                kind: 'object',
                exactKeys: new Set<string>(),
                reservedLower: new Set<string>(),
                taskCollision: false,
                taskKnown: false,
                schemaModern: false,
                supportSeen: false,
            });
            index += 1;
            continue;
        }
        if (char === '[') {
            scopes.push({ kind: 'array' });
            index += 1;
            continue;
        }
        if (char === '}' || char === ']') {
            closeScope(scopes.pop());
            index += 1;
            continue;
        }
        if (char !== '"') {
            index += 1;
            continue;
        }

        const tokenStart = index;
        index = readStringToken(index);

        let next = index;
        while (next < rawJson.length && /\s/.test(rawJson[next] ?? '')) next += 1;
        const scope = scopes.at(-1);
        if (scope?.kind !== 'object' || rawJson[next] !== ':') continue;

        let key: string;
        try {
            key = JSON.parse(rawJson.slice(tokenStart, index)) as string;
        } catch {
            return { status: 'unknown' };
        }
        if (scope.exactKeys.has(key)) hasAmbiguousKeys = true;
        scope.exactKeys.add(key);

        const lowerKey = asciiLowerCase(key);
        if (!RESERVED_ENVELOPE_KEY_NAMES.has(lowerKey)) continue;
        if (scope.reservedLower.has(lowerKey)) {
            hasAmbiguousKeys = true;
            if (lowerKey === 'task') scope.taskCollision = true;
        }
        scope.reservedLower.add(lowerKey);
        if (lowerKey !== 'task') scope.supportSeen = true;
        if (lowerKey !== 'task' && lowerKey !== 'schemaversion') continue;

        let valueStart = next + 1;
        while (valueStart < rawJson.length && /\s/.test(rawJson[valueStart] ?? '')) valueStart += 1;
        if (rawJson[valueStart] !== '"') continue;
        const valueEnd = readStringToken(valueStart);
        let value: string;
        try {
            value = JSON.parse(rawJson.slice(valueStart, valueEnd)) as string;
        } catch {
            return { status: 'unknown' };
        }
        if (lowerKey === 'task' && isKnownTaskValue(value)) scope.taskKnown = true;
        if (lowerKey === 'schemaversion' && isModernSchemaVersionValue(value)) scope.schemaModern = true;
    }

    if (scopes.length > 0) return { status: 'unknown' };
    return { status: 'complete', hasAmbiguousKeys, declaresModernEnvelope };
}

/* @Codex */
function findBalancedJsonEnd(
    text: string,
    start: number,
    visitCharacter: () => boolean,
): number | null {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
        if (!visitCharacter()) return null;
        const char = text[index];
        if (inString) {
            if (escaped) {
                escaped = false;
                continue;
            }
            if (char === '\\') {
                escaped = true;
                continue;
            }
            if (char === '"') inString = false;
            continue;
        }
        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[') depth += 1;
        else if (char === '}' || char === ']') {
            depth -= 1;
            if (depth === 0) return index;
            if (depth < 0) return -1;
        }
    }
    return -1;
}

/* @Codex */
function findNextJsonOpener(
    text: string,
    start: number,
    visitCharacter: () => boolean,
): number | null {
    for (let index = start; index < text.length; index += 1) {
        if (!visitCharacter()) return null;
        const char = text[index];
        if (char === '{' || char === '[') return index;
    }
    return -1;
}

/* @Codex WUL-362 F2: segmenti top-level non sovrapposti di un testo libero. Un
   gruppo bilanciato non e da solo una prova di candidatura JSON: la
   classificazione (parse o sniff) resta al chiamante, che conta nel budget solo
   i candidati reali. Un opener senza chiusura non inghiotte il resto: il tratto
   fino al prossimo opener resta una regione da sniffare e la scansione riprende,
   cosi un frammento valido successivo viene comunque visitato. */
type JsonFragmentSegment =
    | { kind: 'balanced'; text: string }
    | { kind: 'unparsed'; text: string };

function* iterateJsonFragmentSegments(
    text: string,
    budget: EnvelopeScanBudget,
): Generator<JsonFragmentSegment> {
    const initialVisits = budget.fragmentCharacterVisits;
    const maxVisits = text.length * 3;
    const visitCharacter = (): boolean => {
        if (budget.fragmentCharacterVisits - initialVisits >= maxVisits) {
            budget.truncated = true;
            return false;
        }
        budget.fragmentCharacterVisits += 1;
        return consumeScanChars(budget, 1);
    };

    let index = 0;
    while (index < text.length) {
        if (!visitCharacter()) return;
        const char = text[index];
        if (char !== '{' && char !== '[') {
            index += 1;
            continue;
        }
        const end = findBalancedJsonEnd(text, index, visitCharacter);
        if (end === null) return;
        if (end !== -1) {
            yield { kind: 'balanced', text: text.slice(index, end + 1) };
            index = end + 1;
            continue;
        }
        const nextOpener = findNextJsonOpener(text, index + 1, visitCharacter);
        if (nextOpener === null) return;
        yield { kind: 'unparsed', text: nextOpener === -1 ? text.slice(index) : text.slice(index, nextOpener) };
        if (nextOpener === -1) return;
        index = nextOpener;
    }
}

/* @Codex: hook deterministico e limitato alla regressione del costo di scansione. */
export function __testMeasureJsonFragmentScanWork(text: string): {
    characterVisits: number;
    truncated: boolean;
} {
    const budget = createEnvelopeScanBudget();
    for (const _segment of iterateJsonFragmentSegments(text, budget)) {
        // Il consumo completo del generatore misura il percorso reale.
    }
    return {
        characterVisits: budget.fragmentCharacterVisits,
        truncated: budget.truncated,
    };
}

/* @Codex */
type EnvelopeRecordVisitor = (record: Record<string, unknown>, path: ReadonlyArray<string | number>) => void;

/* @Codex: attraversamento bounded condiviso di oggetti, array e stringhe annidate.
   I percorsi attraversano anche i layer stringificati, cosi la parentela dei
   candidati resta un confronto di prefissi. */
function walkEnvelopeTree(
    node: unknown,
    path: ReadonlyArray<string | number>,
    depth: number,
    budget: EnvelopeScanBudget,
    onRecord: EnvelopeRecordVisitor,
    onSniffDeclared: () => void,
): void {
    if (budget.truncated) return;
    if (node === null || node === undefined) return;
    if (typeof node === 'string') {
        const text = node.trim();
        if (!text.includes('{') && !text.includes('[')) return;
        // Le lunghezze si misurano sulla stringa grezza: il whitespace analizzato conta.
        if (node.length > ENVELOPE_SCAN_MAX_STRING_LENGTH) {
            budget.truncated = true;
            return;
        }
        if (!consumeScanChars(budget, node.length)) return;
        let chargedCandidateString = false;
        const admitCandidate = (): boolean => {
            if (chargedCandidateString) return true;
            if (budget.stringParses >= ENVELOPE_SCAN_MAX_STRING_PARSES) {
                budget.truncated = true;
                return false;
            }
            budget.stringParses += 1;
            chargedCandidateString = true;
            return true;
        };
        scanTextForEnvelopes(text, path, budget, onRecord, onSniffDeclared, admitCandidate, true);
        return;
    }
    if (typeof node !== 'object') return;
    if (depth > ENVELOPE_SCAN_MAX_DEPTH) {
        budget.truncated = true;
        return;
    }
    if (budget.nodes >= ENVELOPE_SCAN_MAX_NODES) {
        budget.truncated = true;
        return;
    }
    budget.nodes += 1;
    if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
            walkEnvelopeTree(node[index], [...path, index], depth + 1, budget, onRecord, onSniffDeclared);
        }
        return;
    }
    const record = node as Record<string, unknown>;
    if (declaresModernEnvelopeRecord(record)) onRecord(record, path);
    for (const key of Object.keys(record)) {
        walkEnvelopeTree(record[key], [...path, key], depth + 1, budget, onRecord, onSniffDeclared);
    }
}

/* @Codex: prima il parse diretto (contenuti persistiti JSON puri), poi TUTTI i
   frammenti non sovrapposti; un frammento dichiarato ma non parseabile passa
   dallo sniff fail-closed. */
function scanTextForEnvelopes(
    text: string,
    basePath: ReadonlyArray<string | number>,
    budget: EnvelopeScanBudget,
    onRecord: EnvelopeRecordVisitor,
    onSniffDeclared: () => void,
    admitCandidate: () => boolean = () => true,
    chargeParsedText: boolean = false,
): void {
    const scanParsedDocument = (rawJson: string, root: unknown, path: ReadonlyArray<string | number>) => {
        let documentDeclares = false;
        const onDocumentRecord: EnvelopeRecordVisitor = (record, recordPath) => {
            documentDeclares = true;
            onRecord(record, recordPath);
        };
        const onDocumentSniffDeclared = () => {
            documentDeclares = true;
            onSniffDeclared();
        };

        walkEnvelopeTree(root, path, 0, budget, onDocumentRecord, onDocumentSniffDeclared);
        // @Codex WUL-362 F1: l'evidenza si legge sulle chiavi RAW, prima della
        // riduzione last-wins di JSON.parse. Una dichiarazione moderna visibile
        // solo nelle chiavi raw (oscurata da duplicati o collisioni) e una
        // chiave ambigua in un documento che dichiara degradano entrambe
        // fail-closed; un esito unknown della primitive tronca la scansione.
        const keyEvidence = scanJsonDocumentKeyEvidence(rawJson);
        if (keyEvidence.status === 'unknown') {
            budget.truncated = true;
            return;
        }
        if (keyEvidence.declaresModernEnvelope && !documentDeclares) onSniffDeclared();
        if (keyEvidence.hasAmbiguousKeys && (documentDeclares || keyEvidence.declaresModernEnvelope)) {
            onSniffDeclared();
        }
    };
    try {
        const root = JSON.parse(text) as unknown;
        if (!admitCandidate()) return;
        if (chargeParsedText && !consumeRealFragment(budget)) return;
        scanParsedDocument(text, root, basePath);
        return;
    } catch {
        // non era JSON puro: scansione multi-frammento
    }
    // @Codex WUL-362 F2: nel budget frammenti contano solo i candidati reali,
    // cioe i gruppi JSON parseabili e i segmenti con sniff moderno. Un marcatore
    // canonico [Sx] o una parentesi bilanciata di prosa non consumano nulla. Il
    // nono candidato reale tronca fail-closed senza essere classificato:
    // l'evidenza gia raccolta precede il troncamento, che non diventa mai absent.
    let parsedFragmentOrdinal = 0;
    for (const segment of iterateJsonFragmentSegments(text, budget)) {
        if (segment.kind === 'balanced') {
            let root: unknown;
            let parsedFragment = false;
            try {
                root = JSON.parse(segment.text) as unknown;
                parsedFragment = true;
            } catch {
                // gruppo bilanciato non-JSON: resta solo materiale da sniffare
            }
            if (parsedFragment) {
                if (!admitCandidate()) return;
                if (!consumeRealFragment(budget)) return;
                scanParsedDocument(segment.text, root, [...basePath, `#${parsedFragmentOrdinal}`]);
                parsedFragmentOrdinal += 1;
                continue;
            }
        }
        if (sniffDeclaresModernEnvelope(segment.text)) {
            if (!admitCandidate()) return;
            if (!consumeRealFragment(budget)) return;
            onSniffDeclared();
        }
    }
}

/* @Codex: rilevazione tri-state per il rescue legacy (contratto punto 3).
   present blocca, unknown (limite raggiunto) blocca, solo absent consente. */
export function detectModernEnvelopeEvidence(text: string): ModernEnvelopeEvidence {
    const raw = text || '';
    const trimmed = raw.trim();
    if (!trimmed) return 'absent';
    if (!trimmed.includes('{') && !trimmed.includes('[')) return 'absent';
    const budget = createEnvelopeScanBudget();
    // Lunghezza grezza, prima del parse: il whitespace analizzato conta nel budget.
    if (!consumeScanChars(budget, raw.length)) return 'unknown';
    let present = false;
    scanTextForEnvelopes(trimmed, [], budget, () => {
        present = true;
    }, () => {
        present = true;
    });
    if (present) return 'present';
    if (budget.truncated) return 'unknown';
    return 'absent';
}

/* @Codex: risoluzione canonica dell'envelope per il read-path del Patient Insight.
   Il recupero testuale a valle gira solo sullo stato legacy-text; ogni esaurimento
   dei budget degrada fail-closed ad ambiguous. */
export type InsightEnvelopeResolution =
    | { status: 'usable'; envelope: AITaskParseResult<PatientInsightExtraction> }
    | { status: 'declared-invalid' }
    | { status: 'ambiguous' }
    | { status: 'legacy-text' };

/* @Codex */
type InsightCandidateClass =
    | { kind: 'usable'; envelope: AITaskParseResult<PatientInsightExtraction>; canonical: string }
    | { kind: 'other-task-valid' }
    | { kind: 'declared-invalid'; tolerableAncestor: boolean };

/* @Codex: la serializzazione del candidato e conteggiata nel budget caratteri */
function classifyInsightCandidate(
    record: Record<string, unknown>,
    budget: EnvelopeScanBudget,
): InsightCandidateClass | null {
    const serialized = JSON.stringify(record);
    if (!consumeScanChars(budget, serialized.length)) return null;
    const asInsight = parsePatientInsightExtractionResponse(serialized);
    if (isEnvelopeUsable(asInsight)) {
        return { kind: 'usable', envelope: asInsight, canonical: JSON.stringify(asInsight.value) };
    }
    const taskValue = readEnvelopeKey(record, 'task');
    const taskId = typeof taskValue === 'string' ? taskValue.trim().toLowerCase() : null;
    if (taskId === 'smart_import' && isEnvelopeUsable(parseSmartImportExtractionResponse(serialized))) {
        return { kind: 'other-task-valid' };
    }
    if (taskId === 'document_synthesis' && isEnvelopeUsable(parseDocumentSynthesisExtractionResponse(serialized, ''))) {
        return { kind: 'other-task-valid' };
    }
    // Tollerabile come antenato solo se parziale e compatibile: nessun task noto
    // diverso da patient_insight e nessuna schemaVersion diversa da quella supportata.
    const schemaValue = readEnvelopeKey(record, 'schemaversion');
    const compatibleSchema = schemaValue === undefined || schemaValue === AI_TASK_EXTRACTION_SCHEMA_VERSION;
    const compatibleTask = taskId === null || taskId === 'patient_insight';
    return { kind: 'declared-invalid', tolerableAncestor: compatibleSchema && compatibleTask };
}

/* @Codex */
function isStrictPathPrefix(prefix: ReadonlyArray<string | number>, path: ReadonlyArray<string | number>): boolean {
    if (prefix.length >= path.length) return false;
    return prefix.every((segment, index) => segment === path[index]);
}

/* @Codex */
export function resolveInsightEnvelope(content: string): InsightEnvelopeResolution {
    const raw = content || '';
    const trimmed = raw.trim();
    if (!trimmed) return { status: 'legacy-text' };
    if (!trimmed.includes('{') && !trimmed.includes('[')) return { status: 'legacy-text' };

    const budget = createEnvelopeScanBudget();
    // Limite applicato prima del parse del root, sulla lunghezza grezza (punto 5).
    if (!consumeScanChars(budget, raw.length)) return { status: 'ambiguous' };

    const usable = new Map<string, {
        envelope: AITaskParseResult<PatientInsightExtraction>;
        paths: Array<ReadonlyArray<string | number>>;
    }>();
    const otherTaskValidPaths: Array<ReadonlyArray<string | number>> = [];
    const declaredInvalid: Array<{ path: ReadonlyArray<string | number>; tolerableAncestor: boolean }> = [];
    let sniffDeclared = false;

    scanTextForEnvelopes(trimmed, [], budget, (record, path) => {
        const classified = classifyInsightCandidate(record, budget);
        if (!classified) return;
        if (classified.kind === 'usable') {
            const existing = usable.get(classified.canonical);
            if (existing) existing.paths.push(path);
            else usable.set(classified.canonical, { envelope: classified.envelope, paths: [path] });
        } else if (classified.kind === 'other-task-valid') {
            otherTaskValidPaths.push(path);
        } else {
            declaredInvalid.push({ path, tolerableAncestor: classified.tolerableAncestor });
        }
    }, () => {
        sniffDeclared = true;
    });

    if (budget.truncated) return { status: 'ambiguous' };
    if (usable.size > 1) return { status: 'ambiguous' };
    if (usable.size === 1) {
        if (otherTaskValidPaths.length > 0 || sniffDeclared) return { status: 'ambiguous' };
        const single = Array.from(usable.values())[0];
        if (!single) return { status: 'ambiguous' };
        const tolerated = declaredInvalid.every((candidate) =>
            candidate.tolerableAncestor
            && single.paths.some((usablePath) => isStrictPathPrefix(candidate.path, usablePath)));
        return tolerated ? { status: 'usable', envelope: single.envelope } : { status: 'ambiguous' };
    }
    if (otherTaskValidPaths.length > 0 || declaredInvalid.length > 0 || sniffDeclared) {
        return { status: 'declared-invalid' };
    }
    return { status: 'legacy-text' };
}

/* @Codex */
export type SmartImportConfidence = 'high' | 'medium' | 'low';

/* @Codex */
export type TherapySuggestionState = 'active' | 'transition' | 'uncertain' | 'inactive';

/* @Codex */
export type DocumentQualityLevel = 'green' | 'yellow' | 'red';

/* @Codex */
export interface DocumentDiagnosisSuggestionContract {
    code: string;
    description: string;
    system: 'ICD-9' | 'ICD-10' | 'ICD-11';
    evidence?: string;
    confidence?: SmartImportConfidence;
}

/* @Codex */
export interface PatientInsightExtractionData {
    currentState: string[];
    alerts: string[];
    nextSteps: string[];
    gaps: string[];
}

/* @Codex */
export type PatientInsightExtraction = AITaskEnvelope<'patient_insight', PatientInsightExtractionData>;

/* @Codex */
export interface PatientInsightRenderContract {
    currentState: string[];
    alerts: string[];
    nextSteps: string[];
    gaps: string[];
}

/* @Codex */
export interface SmartImportDiagnosisExtraction {
    label: string;
    icdQuery: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    explicitCode?: string;
}

/* @Codex */
export interface SmartImportTherapyExtraction {
    drugMention: string;
    drugQuery: string;
    activePrinciple?: string;
    dosage?: string;
    motivation?: string;
    therapyState?: TherapySuggestionState;
    reviewNote?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
}

/* @Codex */
export type SmartImportServicePrescriptionCategory = 'lab' | 'imaging' | 'visit' | 'rehab' | 'screening' | 'procedure' | 'other';

/* @Codex */
export interface SmartImportServicePrescriptionItemExtraction {
    serviceName: string;
    category?: SmartImportServicePrescriptionCategory;
    codeSystem?: string;
    serviceCode?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
}

/* @Codex */
export interface SmartImportServicePrescriptionExtraction {
    serviceName: string;
    category?: SmartImportServicePrescriptionCategory;
    priority?: string;
    codeSystem?: string;
    serviceCode?: string;
    clinicalQuestion?: string;
    provider?: string;
    prescribedAt?: string;
    requestReference?: string;
    confidence: SmartImportConfidence;
    evidence: string;
    sourceId?: string;
    items?: SmartImportServicePrescriptionItemExtraction[];
}

/* @Codex */
export interface SmartImportExtractionData {
    diagnoses: SmartImportDiagnosisExtraction[];
    therapies: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
}

/* @Codex */
export type SmartImportExtraction = AITaskEnvelope<'smart_import', SmartImportExtractionData>;

/* @Codex */
export interface DocumentSynthesisExtractionData {
    qualityLevel: DocumentQualityLevel;
    qualityReason?: string;
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestionContract[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
}

/* @Codex */
export type DocumentSynthesisExtraction = AITaskEnvelope<'document_synthesis', DocumentSynthesisExtractionData>;

const MAX_SHARED_SUMMARY_CHARS = 220;
const MAX_INSIGHT_CLAIM_CHARS = 220;
const MAX_SMART_IMPORT_TEXT_CHARS = 220;
const MAX_DOCUMENT_SUMMARY_CHARS = 700;
const MAX_DOCUMENT_MEDICATION_CHARS = 180;

function normalizeCompactText(value: unknown, maxChars: number): string {
    if (typeof value !== 'string') return '';
    const clean = stripModelArtifacts(value).replace(/\s+/g, ' ').trim();
    if (!clean) return '';
    return clean.slice(0, maxChars).trim();
}

function normalizeStringArray(value: unknown, maxItems: number, maxChars: number): string[] {
    if (!Array.isArray(value)) return [];

    const seen = new Set<string>();
    const items: string[] = [];

    for (const entry of value) {
        const normalized = normalizeCompactText(entry, maxChars)
            .replace(/^\s*(?:[-*]|\d+\.)\s*/, '')
            .trim();
        if (!normalized) continue;

        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        items.push(normalized);

        if (items.length >= maxItems) break;
    }

    return items;
}

function normalizeConfidence(value: unknown): SmartImportConfidence {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'high' || normalized === 'medium' || normalized === 'low') {
        return normalized;
    }
    return 'low';
}

function normalizeDiagnosisSystem(value: unknown): DocumentDiagnosisSuggestionContract['system'] | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/\s+/g, '');
    if (normalized === 'ICD-9' || normalized === 'ICD9') return 'ICD-9';
    if (normalized === 'ICD-10' || normalized === 'ICD10') return 'ICD-10';
    if (normalized === 'ICD-11' || normalized === 'ICD11') return 'ICD-11';
    return null;
}

function normalizeQualityLevel(value: unknown): DocumentQualityLevel {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'green' || normalized === 'yellow' || normalized === 'red') {
        return normalized;
    }
    return 'yellow';
}

function normalizeTaskData(
    value: unknown
): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function parseLegacyDocumentSynthesisPayload(response: string): {
    rawJson: string | null;
    validJson: boolean;
    repairedTruncation: boolean;
    summary: string;
    qualityLevel: DocumentQualityLevel;
    qualityReason: string;
    medications: string[];
    diagnoses: DocumentDiagnosisSuggestionContract[];
    problemStatements: SmartImportDiagnosisExtraction[];
    therapyCandidates: SmartImportTherapyExtraction[];
    servicePrescriptions: SmartImportServicePrescriptionExtraction[];
} | null {
    // @Codex: rescue consentito solo con evidenza moderna assente (tri-state);
    // present e unknown (scansione interrotta da un limite) bloccano entrambi.
    if (detectModernEnvelopeEvidence(response) !== 'absent') return null;
    const extraction = extractJsonObject(response);
    if (!extraction) return null;
    const { rawJson, repairedTruncation } = extraction;

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        const hasLegacySummary = Boolean(normalizeCompactText(parsed.summary_markdown ?? parsed.summary, MAX_DOCUMENT_SUMMARY_CHARS));
        const hasLegacyFields = ['quality', 'qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']
            .some((key) => Object.prototype.hasOwnProperty.call(parsed, key));
        if (!hasLegacySummary || !hasLegacyFields) return null;
        const quality = normalizeTaskData(parsed.quality);
        const medications = Array.isArray(parsed.medications)
            ? Array.from(
                new Set(
                    parsed.medications
                        .map(normalizeMedication)
                        .filter((item): item is string => Boolean(item)),
                ),
            )
            : [];
        const diagnoses = Array.isArray(parsed.diagnoses)
            ? parsed.diagnoses
                .map(normalizeDocumentDiagnosis)
                .filter((item): item is DocumentDiagnosisSuggestionContract => Boolean(item))
            : [];
        const problemStatements = Array.isArray(parsed.problemStatements)
            ? parsed.problemStatements
                .map(normalizeSmartImportDiagnosis)
                .filter((item): item is SmartImportDiagnosisExtraction => Boolean(item))
            : [];
        const therapyCandidates = Array.isArray(parsed.therapyCandidates)
            ? parsed.therapyCandidates
                .map(normalizeSmartImportTherapy)
                .filter((item): item is SmartImportTherapyExtraction => Boolean(item))
            : [];
        const servicePrescriptions = Array.isArray(parsed.servicePrescriptions)
            ? parsed.servicePrescriptions
                .map(normalizeServicePrescription)
                .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
            : [];

        return {
            rawJson,
            validJson: true,
            repairedTruncation,
            summary: normalizeCompactText(parsed.summary_markdown ?? parsed.summary, MAX_DOCUMENT_SUMMARY_CHARS),
            qualityLevel: normalizeQualityLevel(quality.level),
            qualityReason: normalizeCompactText(quality.reason, MAX_SHARED_SUMMARY_CHARS),
            medications,
            diagnoses,
            problemStatements,
            therapyCandidates,
            servicePrescriptions,
        };
    } catch {
        return null;
    }
}

function parseEnvelope(
    response: string,
    expectedTask: AITaskKind
): {
    rawJson: string | null;
    validJson: boolean;
    validTask: boolean;
    repairedTruncation: boolean;
    summary: string;
    data: Record<string, unknown>;
} {
    const extraction = extractJsonObject(response);
    if (!extraction) {
        return {
            rawJson: null,
            validJson: false,
            validTask: false,
            repairedTruncation: false,
            summary: '',
            data: {},
        };
    }

    const { rawJson, repairedTruncation } = extraction;

    try {
        const parsed = JSON.parse(rawJson) as Record<string, unknown>;
        // @Codex WUL-362 F1: duplicati esatti e collisioni ASCII case-insensitive
        // delle chiavi riservate invalidano l'envelope; un esito unknown della
        // primitive resta fail-closed, mai un envelope valido.
        const keyEvidence = scanJsonDocumentKeyEvidence(rawJson);
        if (keyEvidence.status === 'unknown' || keyEvidence.hasAmbiguousKeys) {
            return {
                rawJson,
                validJson: true,
                validTask: false,
                repairedTruncation,
                summary: '',
                data: {},
            };
        }
        const schemaVersion = parsed?.schemaVersion === AI_TASK_EXTRACTION_SCHEMA_VERSION;
        const taskMatches = parsed?.task === expectedTask;
        const data = normalizeTaskData(parsed?.data);

        return {
            rawJson,
            validJson: true,
            validTask: schemaVersion && taskMatches,
            repairedTruncation,
            summary: normalizeCompactText(parsed?.summary, MAX_SHARED_SUMMARY_CHARS),
            data,
        };
    } catch {
        return {
            rawJson,
            validJson: false,
            validTask: false,
            repairedTruncation,
            summary: '',
            data: {},
        };
    }
}

function renderListSection(title: string, items: string[]): string {
    if (items.length === 0) return '';
    return `**${title}:**\n${items.map((item) => `- ${item}`).join('\n')}`;
}

export function buildDocumentFallbackSummary(rawText: string): string {
    const normalized = rawText
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 6)
        .join('\n');

    return normalized
        ? `Riassunto clinico: ${normalized.slice(0, MAX_DOCUMENT_SUMMARY_CHARS)}`
        : 'Documento scannerizzato. Riassunto non disponibile.';
}

function normalizeMedication(value: unknown): string | null {
    const normalized = normalizeCompactText(value, MAX_DOCUMENT_MEDICATION_CHARS);
    return normalized.length >= 3 ? normalized : null;
}

function normalizeDocumentDiagnosis(value: unknown): DocumentDiagnosisSuggestionContract | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const code = normalizeCompactText(record.code, 32).toUpperCase();
    const description = normalizeCompactText(record.description, 160);
    const system = normalizeDiagnosisSystem(record.system);

    if (!code || !description || !system) return null;

    return {
        code,
        description,
        system,
        evidence: normalizeCompactText(record.evidence, 220) || undefined,
        confidence: normalizeConfidence(record.confidence),
    };
}

function normalizeSmartImportDiagnosis(value: unknown): SmartImportDiagnosisExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const label = normalizeCompactText(record.label, MAX_SMART_IMPORT_TEXT_CHARS);
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!label || !evidence) return null;

    return {
        label,
        icdQuery: normalizeCompactText(record.icdQuery, MAX_SMART_IMPORT_TEXT_CHARS) || label,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
        explicitCode: normalizeCompactText(record.explicitCode, 32).toUpperCase() || undefined,
    };
}

function normalizeServicePrescriptionCategory(value: unknown): SmartImportServicePrescriptionCategory | undefined {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'lab' || normalized === 'laboratorio') return 'lab';
    if (normalized === 'imaging' || normalized === 'radiologia' || normalized === 'diagnostica') return 'imaging';
    if (normalized === 'visit' || normalized === 'visita') return 'visit';
    if (normalized === 'rehab' || normalized === 'riabilitazione' || normalized === 'fisioterapia') return 'rehab';
    if (normalized === 'screening') return 'screening';
    if (normalized === 'procedure' || normalized === 'procedura') return 'procedure';
    if (normalized === 'other' || normalized === 'altro') return 'other';
    return undefined;
}

/* @Codex */
function normalizeServicePrescriptionItem(value: unknown, parent: { category?: SmartImportServicePrescriptionCategory; evidence: string; sourceId?: string }): SmartImportServicePrescriptionItemExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const serviceName = normalizeCompactText(
        record.serviceName ?? record.name ?? record.display ?? record.label,
        MAX_SMART_IMPORT_TEXT_CHARS,
    );
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS) || parent.evidence;
    if (!serviceName || !evidence) return null;

    return {
        serviceName,
        category: normalizeServicePrescriptionCategory(record.category) ?? parent.category ?? inferServicePrescriptionCategory(`${serviceName} ${evidence}`),
        codeSystem: normalizeCompactText(record.codeSystem, 80) || undefined,
        serviceCode: normalizeCompactText(record.serviceCode ?? record.code, 80) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || parent.sourceId,
    };
}

function inferServicePrescriptionCategory(text: string): SmartImportServicePrescriptionCategory {
    const normalized = text
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
    if (/\b(?:emocromo|creatinina|glicemia|hba1c|urine|colesterolo|pcr|proteina c reattiva|prelievo|laboratorio)\b/.test(normalized)) return 'lab';
    if (/\b(?:ecografia|ecocolordoppler|eco|rx|radiografia|tac|tc|rm|risonanza|ecg|elettrocardiogramma|spirometria)\b/.test(normalized)) return 'imaging';
    if (/\b(?:fisioterapia|riabilitazione|riabilitativa|fkt)\b/.test(normalized)) return 'rehab';
    if (/\b(?:screening)\b/.test(normalized)) return 'screening';
    if (/\b(?:visita|consulto|consulenza|controllo specialistico)\b/.test(normalized)) return 'visit';
    if (/\b(?:procedura|prestazione)\b/.test(normalized)) return 'procedure';
    return 'other';
}

function normalizeServicePrescription(value: unknown): SmartImportServicePrescriptionExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const serviceName = normalizeCompactText(
        record.serviceName ?? record.name ?? record.display ?? record.drugMention,
        MAX_SMART_IMPORT_TEXT_CHARS,
    );
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS)
        || normalizeCompactText(record.clinicalQuestion ?? record.motivation, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!serviceName || !evidence) return null;

    const normalized: SmartImportServicePrescriptionExtraction = {
        serviceName,
        category: normalizeServicePrescriptionCategory(record.category) ?? inferServicePrescriptionCategory(`${serviceName} ${evidence}`),
        priority: normalizeCompactText(record.priority, 16).toUpperCase() || undefined,
        codeSystem: normalizeCompactText(record.codeSystem, 80) || undefined,
        serviceCode: normalizeCompactText(record.serviceCode ?? record.code, 80) || undefined,
        clinicalQuestion: normalizeCompactText(record.clinicalQuestion ?? record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        provider: normalizeCompactText(record.provider, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        prescribedAt: normalizeCompactText(record.prescribedAt, 32) || undefined,
        requestReference: normalizeCompactText(record.requestReference, 80) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
    };
    const rawItems = Array.isArray(record.items) ? record.items : [];
    const items = rawItems
        .map((item) => normalizeServicePrescriptionItem(item, normalized))
        .filter((item): item is SmartImportServicePrescriptionItemExtraction => Boolean(item));
    if (items.length > 0) normalized.items = items.slice(0, 20);
    return normalized;
}

function normalizeServicePrescriptionFromTherapyLike(value: unknown): SmartImportServicePrescriptionExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const candidate = {
        drugMention: normalizeCompactText(record.drugMention, MAX_SMART_IMPORT_TEXT_CHARS),
        drugQuery: normalizeCompactText(record.drugQuery, MAX_SMART_IMPORT_TEXT_CHARS),
        activePrinciple: normalizeCompactText(record.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        dosage: normalizeCompactText(record.dosage, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        motivation: normalizeCompactText(record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        reviewNote: normalizeCompactText(record.reviewNote, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        evidence: normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS),
    };
    if (!isServicePrescriptionLikeTherapy(candidate)) return null;

    return normalizeServicePrescription({
        serviceName: candidate.drugMention || candidate.drugQuery,
        category: inferServicePrescriptionCategory([candidate.drugMention, candidate.drugQuery, candidate.evidence].join(' ')),
        clinicalQuestion: candidate.motivation || candidate.reviewNote,
        confidence: record.confidence,
        evidence: candidate.evidence || candidate.motivation || candidate.reviewNote,
        sourceId: record.sourceId,
    });
}

function servicePrescriptionDedupeKey(item: Pick<SmartImportServicePrescriptionExtraction, 'serviceName' | 'serviceCode'>): string {
    const code = normalizeCompactText(item.serviceCode, 80).toLowerCase();
    if (code) return `code:${code}`;
    return normalizeCompactText(item.serviceName, MAX_SMART_IMPORT_TEXT_CHARS)
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/\b(?:di controllo|con formula(?: leucocitaria)?|completo con formula|completo)\b/g, '')
        .replace(/\b\d+\s+sedut[ae]\b/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function normalizeTherapyKey(therapy: Pick<SmartImportTherapyExtraction, 'drugMention' | 'activePrinciple' | 'dosage' | 'therapyState'>): string {
    return [
        normalizeCompactText(therapy.drugMention, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        normalizeCompactText(therapy.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        normalizeCompactText(therapy.dosage, MAX_SMART_IMPORT_TEXT_CHARS).toLowerCase(),
        therapy.therapyState || 'active',
    ].join('|');
}

export function normalizeTherapyState(value: unknown): TherapySuggestionState | undefined {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    if (normalized === 'active' || normalized === 'transition' || normalized === 'uncertain' || normalized === 'inactive') {
        return normalized;
    }
    return undefined;
}

function normalizeSmartImportTherapy(value: unknown): SmartImportTherapyExtraction | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const record = value as Record<string, unknown>;
    const drugMention = normalizeCompactText(record.drugMention, MAX_SMART_IMPORT_TEXT_CHARS);
    const evidence = normalizeCompactText(record.evidence, MAX_SMART_IMPORT_TEXT_CHARS);

    if (!drugMention || !evidence) return null;

    const therapy = {
        drugMention,
        drugQuery: normalizeCompactText(record.drugQuery, MAX_SMART_IMPORT_TEXT_CHARS) || drugMention,
        activePrinciple: normalizeCompactText(record.activePrinciple, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        dosage: normalizeCompactText(record.dosage, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        motivation: normalizeCompactText(record.motivation, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        therapyState: normalizeTherapyState(record.therapyState),
        reviewNote: normalizeCompactText(record.reviewNote, MAX_SMART_IMPORT_TEXT_CHARS) || undefined,
        confidence: normalizeConfidence(record.confidence),
        evidence,
        sourceId: normalizeCompactText(record.sourceId, 80) || undefined,
    };

    return isServicePrescriptionLikeTherapy(therapy) ? null : therapy;
}

export interface ExtractedJsonObject {
    rawJson: string;
    repairedTruncation: boolean;
}

interface JsonContainer {
    opener: '{' | '[';
    parent: JsonContainer | null;
}

// @Codex: chiude solo i contenitori osservati nello stesso prefisso JSON.
function closeJsonContainers(fragment: string, container: JsonContainer | null): string {
    let closed = fragment;
    for (let current = container; current; current = current.parent) {
        closed += current.opener === '{' ? '}' : ']';
    }
    return closed;
}

// @Codex: delimita una radice completa senza interpretarne ancora il contenuto.
function extractBalancedJsonValue(candidate: string, rootStart: number): string | null {
    let container: JsonContainer | null = null;
    let inString = false;
    let escaping = false;

    for (let index = rootStart; index < candidate.length; index += 1) {
        const char = candidate[index];
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (char === '\\') {
                escaping = true;
                continue;
            }
            if (char === '"') inString = false;
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[') {
            container = { opener: char, parent: container };
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (container?.opener !== expected) return null;
            container = container.parent;
            if (!container) return candidate.slice(rootStart, index + 1);
        }
    }

    return null;
}

// @Codex: una riparazione dichiarata deve essere un oggetto JSON parsabile.
function isParsableJsonObject(value: string, requireMember = false): boolean {
    try {
        const parsed = JSON.parse(value) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
        return !requireMember || Object.keys(parsed).length > 0;
    } catch {
        return false;
    }
}

export function extractJsonObject(response: string): ExtractedJsonObject | null {
    const clean = stripModelArtifacts(response);
    const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
    // @Codex: usa lo stesso scanner per risposte libere e blocchi JSON recintati.
    const fencedCandidate = fenced?.[1]?.trim();
    const candidate = fencedCandidate && /[\[{]/.test(fencedCandidate)
        ? fencedCandidate
        : clean;
    let rootStart = -1;
    let searchStart = 0;

    while (searchStart < candidate.length) {
        const nextBrace = candidate.indexOf('{', searchStart);
        const nextBracket = candidate.indexOf('[', searchStart);
        if (nextBrace === -1 && nextBracket === -1) return null;

        if (nextBrace !== -1 && (nextBracket === -1 || nextBrace < nextBracket)) {
            rootStart = nextBrace;
            break;
        }

        const arrayCandidate = extractBalancedJsonValue(candidate, nextBracket);
        if (!arrayCandidate) return null;
        try {
            if (Array.isArray(JSON.parse(arrayCandidate))) {
                return { rawJson: arrayCandidate, repairedTruncation: false };
            }
        } catch {
            // Un blocco bilanciato ma non JSON puo essere un marcatore come [S1].
        }
        searchStart = nextBracket + arrayCandidate.length;
    }

    if (rootStart === -1) return null;

    const fragment = candidate.slice(rootStart).trim();
    let container: JsonContainer | null = null;
    let lastCommaCheckpoint: { endIndex: number; container: JsonContainer } | null = null;
    let inString = false;
    let escaping = false;
    let mismatchedClosing = false;

    for (let index = 0; index < fragment.length; index += 1) {
        const char = fragment[index];
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }
            if (char === '\\') {
                escaping = true;
                continue;
            }
            if (char === '"') {
                inString = false;
            }
            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }
        if (char === '{' || char === '[') {
            container = { opener: char, parent: container };
            continue;
        }
        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (container?.opener === expected) {
                container = container.parent;
                if (!container) {
                    return {
                        rawJson: fragment.slice(0, index + 1),
                        repairedTruncation: false,
                    };
                }
            } else {
                mismatchedClosing = true;
            }
            continue;
        }
        if (char === ',' && container) {
            lastCommaCheckpoint = { endIndex: index, container };
        }
    }

    if (mismatchedClosing || !container) return null;

    let repairablePrefix = inString
        ? fragment
        : fragment.replace(/,\s*$/g, '');
    if (inString) {
        if (escaping) repairablePrefix = repairablePrefix.slice(0, -1);
        repairablePrefix += '"';
    }

    const repaired = closeJsonContainers(repairablePrefix, container);
    if (isParsableJsonObject(repaired, true)) {
        return {
            rawJson: repaired,
            repairedTruncation: true,
        };
    }

    if (lastCommaCheckpoint) {
        const completePrefix = fragment
            .slice(0, lastCommaCheckpoint.endIndex)
            .trimEnd();
        const fallback = closeJsonContainers(completePrefix, lastCommaCheckpoint.container);
        if (isParsableJsonObject(fallback, true)) {
            return {
                rawJson: fallback,
                repairedTruncation: true,
            };
        }
    }

    return null;
}

export function parsePatientInsightExtractionResponse(response: string): AITaskParseResult<PatientInsightExtraction> {
    const envelope = parseEnvelope(response, 'patient_insight');
    const currentState = normalizeStringArray(envelope.data.currentState, 2, MAX_INSIGHT_CLAIM_CHARS);
    const alerts = normalizeStringArray(envelope.data.alerts, 2, MAX_INSIGHT_CLAIM_CHARS);
    const nextSteps = normalizeStringArray(envelope.data.nextSteps, 3, MAX_INSIGHT_CLAIM_CHARS);
    const gaps = normalizeStringArray(envelope.data.gaps, 1, MAX_INSIGHT_CLAIM_CHARS);

    return {
        rawJson: envelope.rawJson,
        validJson: envelope.validJson,
        validTask: envelope.validTask,
        legacyContract: false,
        repairedTruncation: envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'patient_insight',
            summary: envelope.summary,
            data: {
                currentState,
                alerts,
                nextSteps,
                gaps,
            },
        },
    };
}

export function toPatientInsightRenderContract(extraction: PatientInsightExtraction): PatientInsightRenderContract {
    return {
        currentState: extraction.data.currentState,
        alerts: extraction.data.alerts,
        nextSteps: extraction.data.nextSteps,
        gaps: extraction.data.gaps,
    };
}

export function renderPatientInsightMarkdown(render: PatientInsightRenderContract): string {
    const currentState = render.currentState.length > 0
        ? render.currentState.join(' ')
        : 'Supporto locale insufficiente o incoerente per un insight clinico affidabile. [DATI-INCOMPLETI]';

    return [
        `**Quadro attuale:** ${currentState}`,
        renderListSection('Attenzioni', render.alerts),
        renderListSection('Prossimi passi', render.nextSteps),
        renderListSection('Gap da chiarire', render.gaps),
    ].filter(Boolean).join('\n\n');
}

export function parseSmartImportExtractionResponse(response: string): AITaskParseResult<SmartImportExtraction> {
    const envelope = parseEnvelope(response, 'smart_import');

    const diagnoses: SmartImportDiagnosisExtraction[] = [];
    if (Array.isArray(envelope.data.diagnoses)) {
        for (const value of envelope.data.diagnoses) {
            const normalized = normalizeSmartImportDiagnosis(value);
            if (!normalized) continue;
            diagnoses.push(normalized);
            if (diagnoses.length >= 5) break;
        }
    }

    const seenTherapies = new Set<string>();
    const therapies: SmartImportTherapyExtraction[] = [];
    const servicePrescriptions: SmartImportServicePrescriptionExtraction[] = [];
    if (Array.isArray(envelope.data.therapies)) {
        for (const value of envelope.data.therapies) {
            const servicePrescription = normalizeServicePrescriptionFromTherapyLike(value);
            if (servicePrescription) {
                servicePrescriptions.push(servicePrescription);
                continue;
            }

            const normalized = normalizeSmartImportTherapy(value);
            if (!normalized) continue;

            const key = normalizeTherapyKey(normalized);
            if (seenTherapies.has(key)) continue;
            seenTherapies.add(key);
            therapies.push(normalized);

            if (therapies.length >= 10) break;
        }
    }
    if (Array.isArray(envelope.data.servicePrescriptions)) {
        for (const value of envelope.data.servicePrescriptions) {
            const normalized = normalizeServicePrescription(value);
            if (!normalized) continue;
            if (servicePrescriptions.findIndex((item) => servicePrescriptionDedupeKey(item) === servicePrescriptionDedupeKey(normalized)) >= 0) continue;
            servicePrescriptions.push(normalized);
            if (servicePrescriptions.length >= 10) break;
        }
    }

    return {
        rawJson: envelope.rawJson,
        validJson: envelope.validJson,
        validTask: envelope.validTask,
        legacyContract: false,
        repairedTruncation: envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'smart_import',
            summary: envelope.summary,
            data: {
                diagnoses,
                therapies,
                servicePrescriptions: servicePrescriptions.slice(0, 10),
            },
        },
    };
}

export function parseDocumentSynthesisExtractionResponse(
    response: string,
    rawText: string
): AITaskParseResult<DocumentSynthesisExtraction> {
    const envelope = parseEnvelope(response, 'document_synthesis');
    const legacyPayload = !envelope.validTask
        ? parseLegacyDocumentSynthesisPayload(response)
        : null;

    const medications = legacyPayload
        ? legacyPayload.medications
        : Array.isArray(envelope.data.medications)
            ? Array.from(
                new Set(
                    envelope.data.medications
                        .map(normalizeMedication)
                        .filter((item): item is string => Boolean(item)),
                ),
            )
            : [];
    const filteredMedications = medications.filter((medication) => !isServicePrescriptionLikeTherapy({
        drugMention: medication,
        drugQuery: medication,
        evidence: medication,
    }));

    const diagnoses = legacyPayload
        ? legacyPayload.diagnoses
        : Array.isArray(envelope.data.diagnoses)
            ? envelope.data.diagnoses
                .map(normalizeDocumentDiagnosis)
                .filter((item): item is DocumentDiagnosisSuggestionContract => Boolean(item))
            : [];
    const problemStatements = legacyPayload
        ? legacyPayload.problemStatements
        : Array.isArray(envelope.data.problemStatements)
            ? envelope.data.problemStatements
                .map(normalizeSmartImportDiagnosis)
                .filter((item): item is SmartImportDiagnosisExtraction => Boolean(item))
            : [];
    const therapyCandidates = legacyPayload
        ? legacyPayload.therapyCandidates
        : Array.isArray(envelope.data.therapyCandidates)
            ? envelope.data.therapyCandidates
                .map(normalizeSmartImportTherapy)
                .filter((item): item is SmartImportTherapyExtraction => Boolean(item))
            : [];
    const filteredTherapyCandidates = filterServicePrescriptionTherapyCandidates(therapyCandidates);
    const explicitServicePrescriptions = legacyPayload
        ? legacyPayload.servicePrescriptions
        : Array.isArray(envelope.data.servicePrescriptions)
            ? envelope.data.servicePrescriptions
                .map(normalizeServicePrescription)
                .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
            : [];
    const medicationServicePrescriptions = medications
        .map((medication) => normalizeServicePrescriptionFromTherapyLike({
            drugMention: medication,
            drugQuery: medication,
            evidence: medication,
            confidence: 'medium',
        }))
        .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item));
    const therapyServicePrescriptions = Array.isArray(envelope.data.therapyCandidates)
        ? envelope.data.therapyCandidates
            .map(normalizeServicePrescriptionFromTherapyLike)
            .filter((item): item is SmartImportServicePrescriptionExtraction => Boolean(item))
        : [];
    const servicePrescriptions = [...explicitServicePrescriptions, ...medicationServicePrescriptions, ...therapyServicePrescriptions]
        .filter((item, index, list) => (
            list.findIndex((candidate) => servicePrescriptionDedupeKey(candidate) === servicePrescriptionDedupeKey(item)) === index
        ))
        .slice(0, 10);

    const summary = (legacyPayload?.summary || envelope.summary) || buildDocumentFallbackSummary(rawText);
    const qualityLevel = legacyPayload?.qualityLevel ?? normalizeQualityLevel(envelope.data.qualityLevel);
    const qualityReason = legacyPayload?.qualityReason
        || normalizeCompactText(envelope.data.qualityReason, MAX_SHARED_SUMMARY_CHARS)
        || ((legacyPayload?.validJson || envelope.validJson)
            ? (diagnoses.length > 0 || filteredMedications.length > 0
                ? 'Dati clinici strutturati estratti'
                : 'Analisi completata con dati parziali')
            : 'JSON del modello non valido');

    return {
        rawJson: legacyPayload?.rawJson ?? envelope.rawJson,
        validJson: legacyPayload?.validJson ?? envelope.validJson,
        validTask: legacyPayload ? legacyPayload.validJson : envelope.validTask,
        legacyContract: Boolean(legacyPayload),
        repairedTruncation: legacyPayload?.repairedTruncation ?? envelope.repairedTruncation,
        value: {
            schemaVersion: AI_TASK_EXTRACTION_SCHEMA_VERSION,
            task: 'document_synthesis',
            summary,
            data: {
                qualityLevel,
                qualityReason,
                medications: filteredMedications,
                diagnoses,
                problemStatements,
                therapyCandidates: filteredTherapyCandidates,
                servicePrescriptions,
            },
        },
    };
}
