import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { agentPrivateDirectory, readAgentCredential, readAgentRegistration, saveAgentCredential, saveAgentRegistration, type AgentCredential } from './credentials';
import { sealAgentItemNode } from './cassette-crypto';
import { AGENT_OPERATIONS, MANDATE_MAX_DURATION_MS, type AgentOperation } from '../../../lib/agent-mandate-contract';
import { AGENT_ITEM_OPERATION, cassetteItems, type AgentCassetteItem } from '../../../lib/agent-cassette-contract';
import { AGENT_MAX_ITEM_BYTES, isAgentId, validAgentEnvelope, type AgentEnvelope } from '../../../lib/agent-cassette-crypto';
import { parsePreparedExtraction, DOSSIER_PREPARED_MAX_BYTES } from '../../../lib/domain/documents/dossier-prepared';
import type { VisitConfirmationReceipt } from '../../../lib/agent-visit-confirmation-contract';
import { isValidItalianTaxCode } from '../../../lib/patient-identity';

export class AgentClientError extends Error {
    constructor(readonly code: 'AGENT_INPUT_INVALID' | 'AGENT_FILE_INVALID' | 'AGENT_HTTP_UNAVAILABLE' | 'AGENT_ACCESS_DENIED' | 'AGENT_STATE_INVALID' | 'AGENT_CANCELLED', readonly status?: number, readonly visitId?: string) { super(code); }
}
const invalid = () => new AgentClientError('AGENT_INPUT_INVALID');
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export function agentOrigin(value: string): string {
    try {
        const url = new URL(value);
        if (url.origin !== value || url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)) throw invalid();
        return url.origin;
    } catch { throw invalid(); }
}
export function agentRequest(origin: string, endpoint: '/api/agent/v1/confirmation' | `/api/agent/v1/confirmation?reference=${string}` | '/api/agent/v1/context' | '/api/agent/v1/mandate' | '/api/agent/v1/visits' | '/api/agent/v1/pairings' | `/api/agent/v1/pairings?requestId=${string}`, authorization?: string, body?: unknown, signal?: AbortSignal): Promise<Record<string, unknown>> {
    if (signal?.aborted) throw new AgentClientError('AGENT_CANCELLED');
    agentOrigin(origin);
    if (!/^\/api\/agent\/v1\/(?:context|mandate|visits|pairings(?:\?requestId=[a-f0-9-]{36})?|confirmation(?:\?reference=[a-f0-9-]{36})?)$/u.test(endpoint)) throw invalid();
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    if (payload && payload.length > 24 * 1024 * 1024) throw invalid();
    return new Promise((resolve, reject) => {
        const request = http.request(new URL(endpoint, origin), { method: payload ? 'POST' : 'GET', agent: false,
            headers: { Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}), ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, response => {
            const chunks: Buffer[] = []; let length = 0;
            response.on('data', (chunk: Buffer) => {
                length += chunk.length;
                if (length > 1024 * 1024) request.destroy(new AgentClientError('AGENT_HTTP_UNAVAILABLE'));
                else chunks.push(chunk);
            });
            response.once('error', () => reject(new AgentClientError(signal?.aborted ? 'AGENT_CANCELLED' : 'AGENT_HTTP_UNAVAILABLE')));
            response.once('end', () => {
                if (signal?.aborted) { reject(new AgentClientError('AGENT_CANCELLED')); return; }
                const status = response.statusCode ?? 0;
                if (status < 200 || status >= 300) { reject(new AgentClientError('AGENT_ACCESS_DENIED', status)); return; }
                try {
                    if (!/^application\/json(?:;|$)/iu.test(response.headers['content-type'] ?? '')) throw invalid();
                    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
                    if (!record(value)) throw invalid();
                    resolve(value);
                } catch { reject(new AgentClientError('AGENT_HTTP_UNAVAILABLE')); }
            });
        });
        const deadline = setTimeout(() => request.destroy(new AgentClientError('AGENT_HTTP_UNAVAILABLE')), 15000);
        request.once('close', () => clearTimeout(deadline));
        request.setTimeout(15000, () => request.destroy(new AgentClientError('AGENT_HTTP_UNAVAILABLE')));
        const cancel = () => request.destroy(new AgentClientError('AGENT_CANCELLED'));
        signal?.addEventListener('abort', cancel, { once: true });
        request.once('close', () => signal?.removeEventListener('abort', cancel));
        request.once('error', () => reject(new AgentClientError(signal?.aborted ? 'AGENT_CANCELLED' : 'AGENT_HTTP_UNAVAILABLE')));
        if (payload) request.end(payload); else request.end();
    });
}
function statePath(directory: string, kind: 'pairing' | 'visit', id: string): string {
    if (!isAgentId(id)) throw invalid();
    return path.join(agentPrivateDirectory(directory), `${kind}-${id}.json`);
}
function readState(directory: string, kind: 'pairing' | 'visit', id: string): unknown {
    const file = statePath(directory, kind, id);
    let fd: number | undefined;
    try {
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > 52 * 1024 * 1024 || process.platform !== 'win32' && (stat.uid !== process.getuid?.() || (stat.mode & 0o7777) !== 0o600)) throw invalid();
        return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(fs.readFileSync(fd)));
    } catch { throw new AgentClientError('AGENT_STATE_INVALID'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
}
function createState(directory: string, kind: 'pairing' | 'visit', id: string, value: unknown): void {
    const file = statePath(directory, kind, id), temporary = file + '.' + randomUUID() + '.tmp';
    let owned = false;
    try {
        const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); owned = true;
        try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
        fs.linkSync(temporary, file); fs.unlinkSync(temporary); owned = false;
    } catch { throw new AgentClientError('AGENT_STATE_INVALID'); }
    finally { if (owned) fs.unlinkSync(temporary); }
}
export async function requestAgentPairing(directory: string, origin: string, name: string, operations: AgentOperation[] = [...AGENT_OPERATIONS], signal?: AbortSignal) {
    agentPrivateDirectory(directory); agentOrigin(origin);
    if (!name.trim() || name.length > 80 || !operations.length || new Set(operations).size !== operations.length || !operations.every(value => AGENT_OPERATIONS.includes(value))) throw invalid();
    const value = await agentRequest(origin, '/api/agent/v1/pairings', undefined, { name, operations }, signal);
    const receipt = value.receipt, credential = value.pairingCredential;
    if (!record(receipt) || !isAgentId(receipt.id) || typeof receipt.code !== 'string' || !/^[A-F0-9]{8}$/u.test(receipt.code)
        || !Number.isSafeInteger(receipt.expiresAt) || !record(credential) || typeof credential.claim !== 'string' || !/^[A-Za-z0-9_-]{43}$/u.test(credential.claim)) throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    createState(directory, 'pairing', receipt.id, { version: 1, id: receipt.id, origin, claim: credential.claim, expiresAt: receipt.expiresAt });
    return { requestId: receipt.id, code: receipt.code, status: 'pending' as const, expiresAt: receipt.expiresAt };
}
export async function completeAgentPairing(directory: string, requestId: string, signal?: AbortSignal) {
    const state = readState(directory, 'pairing', requestId);
    if (!record(state) || state.version !== 1 || state.id !== requestId || typeof state.origin !== 'string' || typeof state.claim !== 'string'
        || !/^[A-Za-z0-9_-]{43}$/u.test(state.claim) || !Number.isSafeInteger(state.expiresAt) || Number(state.expiresAt) <= Date.now()) throw new AgentClientError('AGENT_STATE_INVALID');
    const value = await agentRequest(state.origin, `/api/agent/v1/pairings?requestId=${requestId}`, 'Pairing ' + state.claim, undefined, signal);
    const receipt = value.receipt, issued = value.credential;
    if (!record(receipt) || receipt.requestId !== requestId) throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    if (receipt.status === 'pending' && issued === null) return { requestId, status: 'pending' as const };
    if (receipt.status === 'registered' && receipt.agentRef === requestId && issued === null) {
        const registration = value.registrationCredential;
        if (!record(registration) || typeof registration.token !== 'string' || !/^mfr_[A-Za-z0-9_-]{43}$/u.test(registration.token))
            throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
        saveAgentRegistration(directory, { agentRef: requestId, token: registration.token, origin: state.origin });
        return { agentRef: requestId, status: 'registered' as const };
    }
    if (receipt.status !== 'approved' || receipt.agentRef !== requestId || !isAgentId(receipt.mandateRef) || !record(issued)
        || typeof issued.token !== 'string' || !Number.isSafeInteger(issued.expiresAt)) throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    saveAgentCredential(directory, { agentRef: requestId, mandateRef: receipt.mandateRef, token: issued.token, expiresAt: Number(issued.expiresAt), origin: state.origin });
    return { agentRef: requestId, mandateRef: receipt.mandateRef, status: 'approved' as const, expiresAt: issued.expiresAt };
}
async function retrieveMandate(directory: string, agentRef: string, signal?: AbortSignal, origin?: string) {
    const registration = readAgentRegistration(directory, agentRef);
    if (!registration || origin && registration.origin !== origin) throw new AgentClientError('AGENT_ACCESS_DENIED', 401);
    const value = await agentRequest(registration.origin, '/api/agent/v1/mandate', 'Bearer ' + registration.token, undefined, signal);
    const receipt = value.receipt, issued = value.credential;
    if (!record(receipt) || receipt.agentRef !== agentRef || !isAgentId(receipt.mandateRef)
        || typeof receipt.issuedAt !== 'number' || typeof receipt.expiresAt !== 'number' || !Number.isSafeInteger(receipt.issuedAt)
        || !Number.isSafeInteger(receipt.expiresAt) || receipt.expiresAt <= Date.now()
        || receipt.expiresAt - receipt.issuedAt !== MANDATE_MAX_DURATION_MS
        || !record(issued) || typeof issued.token !== 'string' || !/^mfa_[A-Za-z0-9_-]{43}$/u.test(issued.token))
        throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    const access = { agentRef, mandateRef: receipt.mandateRef, expiresAt: receipt.expiresAt, token: issued.token, origin: registration.origin };
    saveAgentCredential(directory, access);
    return { access, receipt: { agentRef, mandateRef: access.mandateRef, issuedAt: receipt.issuedAt, expiresAt: access.expiresAt } };
}
export async function retrieveAgentMandate(directory: string, agentRef: string, signal?: AbortSignal, origin?: string) {
    return (await retrieveMandate(directory, agentRef, signal, origin)).receipt;
}

export type AgentVisitPlan = { version: 1; inputFingerprint: string; agentRef: string; mandateRef: string; visitId: string; anchor: AgentEnvelope; items: AgentCassetteItem[] };
function readSource(file: string, max: number): Buffer {
    let fd: number | undefined;
    try {
        const original = fs.lstatSync(file), physical = fs.realpathSync(file);
        if (original.isSymbolicLink()) throw invalid();
        fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        if (stat.dev !== original.dev || stat.ino !== original.ino || !stat.isFile() || stat.nlink !== 1 || !stat.size || stat.size > max) throw invalid();
        const bytes = fs.readFileSync(fd);
        if (bytes.length !== stat.size || fs.fstatSync(fd).mtimeMs !== stat.mtimeMs) throw invalid();
        return bytes;
    } catch { throw new AgentClientError('AGENT_FILE_INVALID'); }
    finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function prepareAgentVisit(publicKey: string, agentRef: string, mandateRef: string, extractionFile: string, fiscalCode: string, transcriptionFile?: string, visitId: string = randomUUID()): AgentVisitPlan {
    if (!extractionFile.toLowerCase().endsWith('.json') || transcriptionFile && !transcriptionFile.toLowerCase().endsWith('.txt')) throw invalid();
    if (!isAgentId(visitId) || !isAgentId(agentRef) || !isAgentId(mandateRef) || !isValidItalianTaxCode(fiscalCode) || fiscalCode !== fiscalCode.toUpperCase()) throw invalid();
    const extractionBytes = readSource(extractionFile, DOSSIER_PREPARED_MAX_BYTES);
    const fingerprint = createHash('sha256').update(JSON.stringify([agentRef, mandateRef, fiscalCode])).update(extractionBytes);
    const parsed = parsePreparedExtraction(new TextDecoder('utf-8', { fatal: true }).decode(extractionBytes));
    if (!parsed.ok || parsed.warnings.length || !parsed.value.sources.length) throw invalid();
    const items: AgentCassetteItem[] = [];
    const seal = (kind: AgentCassetteItem['kind'], value: unknown, documentHash: string | null = null) => {
        const id = randomUUID(), bytes = new TextEncoder().encode(JSON.stringify(value));
        try { items.push({ id, kind, envelope: sealAgentItemNode(publicKey, { mandateRef, visitId, itemId: id, kind }, bytes), byteLength: bytes.length, documentHash }); }
        finally { bytes.fill(0); }
    };
    const kinds = { therapy: 'therapy', service_prescription: 'service', diagnosis: 'diagnosis', exemption: 'exemption', observation: 'observation' } as const;
    for (const source of parsed.value.sources) {
        if (source.patient?.taxCode !== fiscalCode || path.basename(source.fileName) !== source.fileName || !source.fileName.toLowerCase().endsWith('.pdf')) throw invalid();
        const bytes = readSource(path.join(path.dirname(extractionFile), source.fileName), AGENT_MAX_ITEM_BYTES);
        if (sha(bytes) !== source.sha256 || bytes.subarray(0, 5).toString() !== '%PDF-') throw new AgentClientError('AGENT_FILE_INVALID');
        fingerprint.update(source.sha256);
        const provenance = { sha256: source.sha256, fileName: source.fileName, documentDate: source.documentDate };
        seal('pdf', { name: source.fileName, base64: bytes.toString('base64') }, source.sha256);
        for (const fact of source.facts) {
            if (fact.kind === 'document_entry' && source.fileName === 'nota-visita.pdf' && fact.values.text) {
                seal('note', { text: fact.values.text, date: fact.values.date || source.documentDate, source: provenance, quote: fact.quote ?? null });
            } else if (Object.hasOwn(kinds, fact.kind)) {
                seal(kinds[fact.kind as keyof typeof kinds], { values: fact.values, source: provenance, quote: fact.quote ?? null });
            } else throw invalid();
        }
    }
    if (transcriptionFile) {
        const bytes = readSource(transcriptionFile, AGENT_MAX_ITEM_BYTES); fingerprint.update(bytes);
        seal('transcription', { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes) });
    }
    cassetteItems({ itemsCiphertext: JSON.stringify(items) });
    const anchor = sealAgentItemNode(publicKey, { mandateRef, visitId, itemId: visitId, kind: 'anchor' }, new TextEncoder().encode(JSON.stringify({ fiscalCode })));
    return { version: 1, inputFingerprint: fingerprint.digest('hex'), agentRef, mandateRef, visitId, anchor, items };
}
function credential(directory: string, agentRef: string): AgentCredential {
    const value = readAgentCredential(directory, agentRef);
    if (!value) throw new AgentClientError('AGENT_ACCESS_DENIED', 401);
    return value;
}
function visitPlan(value: unknown): value is AgentVisitPlan {
    if (!record(value) || Object.keys(value).sort().join(',') !== 'agentRef,anchor,inputFingerprint,items,mandateRef,version,visitId' || value.version !== 1
        || typeof value.inputFingerprint !== 'string' || !/^[a-f0-9]{64}$/u.test(value.inputFingerprint)
        || ![value.agentRef, value.mandateRef, value.visitId].every(isAgentId) || !validAgentEnvelope(value.anchor) || !Array.isArray(value.items)) return false;
    try { cassetteItems({ itemsCiphertext: JSON.stringify(value.items) }); return true; } catch { return false; }
}
async function depositAgentVisit(access: AgentCredential, plan: AgentVisitPlan, signal?: AbortSignal) {
    if (!visitPlan(plan) || access.agentRef !== plan.agentRef) throw new AgentClientError('AGENT_STATE_INVALID');
    if (access.mandateRef !== plan.mandateRef) throw new AgentClientError('AGENT_STATE_INVALID');
    const call = async (body: unknown) => {
        const value = await agentRequest(access.origin, '/api/agent/v1/visits', 'Bearer ' + access.token, body, signal);
        const receipt = value.receipt;
        if (!record(receipt) || receipt.visitId !== plan.visitId || receipt.mandateRef !== access.mandateRef || receipt.agentRef !== access.agentRef
            || !Number.isSafeInteger(receipt.revision) || !['open', 'closed'].includes(String(receipt.status)) || !Number.isSafeInteger(receipt.itemCount)
            || !['openai', 'anthropic', 'local'].includes(String(receipt.modelProvider)) || typeof receipt.allowsClinicalEgress !== 'boolean') throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
        return { visitId: plan.visitId, mandateRef: access.mandateRef, agentRef: access.agentRef, revision: Number(receipt.revision), status: String(receipt.status), itemCount: Number(receipt.itemCount), modelProvider: receipt.modelProvider, allowsClinicalEgress: receipt.allowsClinicalEgress };
    };
    let receipt = await call({ operation: 'visita.apri', visitId: plan.visitId, anchor: plan.anchor });
    if (receipt.status === 'closed') return receipt;
    for (const item of plan.items) receipt = await call({ operation: AGENT_ITEM_OPERATION[item.kind], visitId: plan.visitId, expectedRevision: receipt.revision, item });
    return call({ operation: 'visita.chiudi', visitId: plan.visitId, expectedRevision: receipt.revision });
}
async function withCurrentAgentCredential<T>(directory: string, agentRef: string, signal: AbortSignal | undefined,
    origin: string | undefined, perform: (access: AgentCredential) => Promise<T>) {
    const cached = readAgentCredential(directory, agentRef);
    if (cached && origin && cached.origin !== origin) throw new AgentClientError('AGENT_ACCESS_DENIED', 401);
    if (cached) {
        try { return { access: cached, result: await perform(cached) }; }
        catch (error) {
            if (!(error instanceof AgentClientError) || error.status !== 401 || !readAgentRegistration(directory, agentRef)) throw error;
        }
    }
    const { access } = await retrieveMandate(directory, agentRef, signal, origin);
    return { access, result: await perform(access) };
}
export async function loadAgentVisitContext(directory: string, agentRef: string, signal?: AbortSignal, origin?: string) {
    const { access, result: context } = await withCurrentAgentCredential(directory, agentRef, signal, origin,
        current => agentRequest(current.origin, '/api/agent/v1/context', 'Bearer ' + current.token, undefined, signal));
    if (context.agentRef !== agentRef || context.mandateRef !== access.mandateRef || typeof context.publicKey !== 'string' || !Array.isArray(context.operations)) throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    return { access, publicKey: context.publicKey, operations: context.operations as unknown[],
        modelProvider: context.modelProvider, allowsClinicalEgress: context.allowsClinicalEgress };
}
export async function prepareAndDepositAgentVisit(directory: string, agentRef: string, extraction: string, fiscalCode: string, transcription?: string, visitId?: string, signal?: AbortSignal) {
    const { access, publicKey, operations } = await loadAgentVisitContext(directory, agentRef, signal);
    let plan = prepareAgentVisit(publicKey, agentRef, access.mandateRef, extraction, fiscalCode, transcription, visitId);
    if (!['visita.apri', 'visita.chiudi', ...plan.items.map(item => AGENT_ITEM_OPERATION[item.kind])].every(operation => operations.includes(operation))) throw new AgentClientError('AGENT_ACCESS_DENIED', 403);
    try { createState(directory, 'visit', plan.visitId, plan); }
    catch (error) {
        const existing = readState(directory, 'visit', plan.visitId);
        if (!visitPlan(existing) || existing.inputFingerprint !== plan.inputFingerprint) throw error;
        plan = existing;
    }
    return depositAgentVisit(access, plan, signal).catch(error => {
        throw new AgentClientError(error instanceof AgentClientError ? error.code : 'AGENT_HTTP_UNAVAILABLE', error instanceof AgentClientError ? error.status : undefined, plan.visitId);
    });
}
export async function resumeAgentVisit(directory: string, agentRef: string, visitId: string, signal?: AbortSignal) {
    const plan = readState(directory, 'visit', visitId);
    if (!visitPlan(plan) || plan.agentRef !== agentRef) throw new AgentClientError('AGENT_STATE_INVALID');
    return depositAgentVisit(credential(directory, agentRef), plan, signal);
}

export function resumeAgentReference(directory: string, visitId: string): string | undefined {
    const file = statePath(directory, 'visit', visitId);
    if (!fs.existsSync(file)) return undefined;
    const plan = readState(directory, 'visit', visitId);
    if (!visitPlan(plan)) throw new AgentClientError('AGENT_STATE_INVALID');
    return plan.agentRef;
}

export async function requestAgentVisitConfirmation(directory: string, agentRef: string,
    operation: { visitId: string } | { reference: string }, signal?: AbortSignal, origin?: string): Promise<VisitConfirmationReceipt> {
    const id = 'visitId' in operation ? operation.visitId : operation.reference;
    if (!isAgentId(id)) throw invalid();
    const { result } = await withCurrentAgentCredential(directory, agentRef, signal, origin, access => 'visitId' in operation
        ? agentRequest(access.origin, '/api/agent/v1/confirmation', 'Bearer ' + access.token, { visitId: id }, signal)
        : agentRequest(access.origin, `/api/agent/v1/confirmation?reference=${id}`, 'Bearer ' + access.token, undefined, signal));
    if (!isAgentId(result.reference) || typeof result.status !== 'string' || !['waiting', 'applied', 'not_applied', 'unavailable'].includes(result.status)
        || ('reference' in operation && id !== result.reference)) throw new AgentClientError('AGENT_HTTP_UNAVAILABLE');
    return { reference: result.reference, status: result.status as VisitConfirmationReceipt['status'] };
}
