const text = (maxLength: number) => Object.freeze({ type: 'string', minLength: 1, maxLength });
const list = (items: Readonly<Record<string, unknown>>, maxItems: number) => Object.freeze({ type: 'array', items, minItems: 0, maxItems });
const record = (properties: Record<string, unknown>, required = Object.keys(properties)) => Object.freeze({ type: 'object', additionalProperties: false, required: Object.freeze(required), properties: Object.freeze(properties) });
const confidence = Object.freeze({ type: 'string', enum: Object.freeze(['high', 'medium', 'low']) });
const category = Object.freeze({ type: 'string', enum: Object.freeze(['lab', 'imaging', 'visit', 'rehab', 'screening', 'procedure', 'other']) });
// Il controllo dell'host (patient-smart-import-capability-contract.ts) pretende la fonte su ogni
// elemento, items compresi: lo schema la chiede negli stessi punti (ADR 0012).
const diagnosis = record({ label: text(240), icdQuery: text(240), confidence, evidence: text(240), sourceId: text(80), explicitCode: text(80) }, ['label', 'icdQuery', 'confidence', 'evidence', 'sourceId']);
const therapy = record({ drugMention: text(240), drugQuery: text(240), activePrinciple: text(240), dosage: text(240), motivation: text(240), therapyState: Object.freeze({ type: 'string', enum: Object.freeze(['active', 'transition', 'uncertain', 'inactive']) }), reviewNote: text(240), confidence, evidence: text(240), sourceId: text(80) }, ['drugMention', 'drugQuery', 'confidence', 'evidence', 'sourceId']);
const serviceItem = record({ serviceName: text(240), category, codeSystem: text(80), serviceCode: text(80), confidence, evidence: text(240), sourceId: text(80) }, ['serviceName', 'confidence', 'evidence', 'sourceId']);
const service = record({ serviceName: text(240), category, priority: text(80), codeSystem: text(80), serviceCode: text(80), clinicalQuestion: text(240), provider: text(240), prescribedAt: text(32), requestReference: text(80), confidence, evidence: text(240), sourceId: text(80), items: list(serviceItem, 32) }, ['serviceName', 'confidence', 'evidence', 'sourceId']);

// Patient Insight accepts a claim only with a source marker (host check in
// patient-insight-host-capability.ts): the schema asks the model for the same rule, summary included.
const CITED_CLAIM_PATTERN = '.*\\[(S[0-9]+|DATI-INCOMPLETI)(, ?(S[0-9]+|DATI-INCOMPLETI))*\\].*';
const cited = (maxLength: number) => Object.freeze({ ...text(maxLength), pattern: CITED_CLAIM_PATTERN });
// Il prompt dichiara lo stesso limite (ai-task-contract-prompts.ts): Ollama non applica maxLength.
export const PATIENT_INSIGHT_CLAIM_MAX_LENGTH = 220;
const claim = cited(PATIENT_INSIGHT_CLAIM_MAX_LENGTH);
export const PATIENT_INSIGHT_JSON_SCHEMA = record({ schemaVersion: Object.freeze({ type: 'string', const: 'mediflow.ai.extract.v1' }), task: Object.freeze({ type: 'string', const: 'patient_insight' }), summary: claim, data: record({ currentState: list(claim, 2), alerts: list(claim, 2), nextSteps: list(claim, 3), gaps: list(claim, 1) }) });
export const SMART_IMPORT_JSON_SCHEMA = record({ schemaVersion: Object.freeze({ type: 'string', const: 'mediflow.ai.extract.v1' }), task: Object.freeze({ type: 'string', const: 'smart_import' }), summary: text(220), data: record({ diagnoses: list(diagnosis, 32), therapies: list(therapy, 32), servicePrescriptions: list(service, 32) }) });
