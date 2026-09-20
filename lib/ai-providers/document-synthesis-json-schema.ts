/* @Codex */
/** Static generation constraint, not source authority or a replacement for host validation. */
type Schema = Readonly<{
    type: 'object' | 'array' | 'string';
    properties?: Readonly<Record<string, Schema>>;
    required?: readonly string[];
    additionalProperties?: false;
    items?: Schema;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    const?: string;
    enum?: readonly string[];
    uniqueItems?: true;
}>;

function freezeDeep<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const child of Object.values(value)) freezeDeep(child);
        Object.freeze(value);
    }
    return value;
}
const text = (maxLength: number): Schema => ({ type: 'string', minLength: 1, maxLength, pattern: '^[^\\u0000-\\u001f\\u007f]+$' });
const enumeration = (...values: string[]): Schema => ({ type: 'string', enum: values });
const literal = (value: string): Schema => ({ type: 'string', const: value });
const list = (items: Schema, maxItems: number, minItems = 0): Schema => ({ type: 'array', items, minItems, maxItems });
const record = (properties: Record<string, Schema>, required = Object.keys(properties)): Schema => ({ type: 'object', properties, required, additionalProperties: false });
const confidence = enumeration('high', 'medium', 'low');
const category = enumeration('lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other');
const label: Schema = { type: 'string', minLength: 2, maxLength: 3, pattern: '^S([1-9]|[12][0-9]|3[0-2])$' };
const diagnosis = record({ code: text(120), description: text(300), system: enumeration('ICD-9', 'ICD-10', 'ICD-11'), evidence: text(400), confidence }, ['code', 'description', 'system']);
const problem = record({ label: text(180), icdQuery: text(160), confidence, evidence: text(400), explicitCode: text(120) }, ['label', 'icdQuery', 'confidence', 'evidence']);
const therapy = record({
    drugMention: text(180), drugQuery: text(180), confidence, evidence: text(400),
    activePrinciple: text(400), dosage: text(400), motivation: text(400), reviewNote: text(400),
    therapyState: enumeration('active', 'transition', 'uncertain', 'inactive'),
}, ['drugMention', 'drugQuery', 'confidence', 'evidence']);
const serviceItem = record({ serviceName: text(180), confidence, evidence: text(400), category, codeSystem: text(160), serviceCode: text(160) }, ['serviceName', 'confidence', 'evidence']);
const service = record({
    serviceName: text(180), confidence, evidence: text(400), category,
    priority: text(180), codeSystem: text(180), serviceCode: text(180), clinicalQuestion: text(180),
    provider: text(180), prescribedAt: text(180), requestReference: text(180), items: list(serviceItem, 32),
}, ['serviceName', 'confidence', 'evidence']);

/** No runtime inputs: quotes, membership, order, currentness and clinical meaning remain host checks. */
export const DOCUMENT_SYNTHESIS_V2_JSON_SCHEMA: Schema = freezeDeep(record({
    schemaVersion: literal('mediflow.document-synthesis.provider-envelope.v2'),
    output: record({
        schemaVersion: literal('mediflow.ai.extract.v1'),
        task: literal('document_synthesis'),
        summary: text(700),
        data: record({
            qualityLevel: enumeration('green', 'yellow', 'red'), qualityReason: text(220),
            medications: list(text(180), 64), diagnoses: list(diagnosis, 32),
            problemStatements: list(problem, 32), therapyCandidates: list(therapy, 32), servicePrescriptions: list(service, 32),
        }, ['qualityLevel', 'medications', 'diagnoses', 'problemStatements', 'therapyCandidates', 'servicePrescriptions']),
    }),
    // Quotes may contain the normalized LF/tab present in source text; never normalize them here.
    citations: list(record({ label, quote: { type: 'string', minLength: 1, maxLength: 12000 } }), 32, 1),
    claims: list(record({
        claimPath: {
            type: 'string', minLength: 7, maxLength: 40,
            pattern: '^(summary|data\\.quality(Level|Reason)|data\\.medications\\[([0-9]|[1-5][0-9]|6[0-3])\\]|data\\.(diagnoses|problemStatements|therapyCandidates)\\[([0-9]|[12][0-9]|3[01])\\]|data\\.servicePrescriptions\\[([0-9]|[12][0-9]|3[01])\\](\\.items\\[([0-9]|[12][0-9]|3[01])\\])?)$',
        },
        labels: { ...list(label, 32, 1), uniqueItems: true },
    }), 194, 2),
}));
