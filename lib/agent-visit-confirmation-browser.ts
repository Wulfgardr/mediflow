'use client';

import { agentBase64, agentBytes } from './agent-cassette-crypto';
import { agentReviewFieldLabels, agentReviewFieldValues, agentReviewItemLabels } from './agent-visit-review-labels';
import { visitConfirmationPurpose, type VisitConfirmationPresentation } from './agent-visit-confirmation-contract';
import type { AgentVisitReview } from './agent-visit-review';
import type { AgentApplicationInput } from './agent-visit-application-contract';

const unavailable = () => new Error('VISIT_PRESENTATION_UNAVAILABLE');
const nativeFieldBytes = 16_384;
function shownWhole(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > nativeFieldBytes
        || /[\p{Cf}]|(?!\n)\p{Cc}/u.test(value)) throw unavailable();
    return value;
}
async function textHash(value: string): Promise<string> {
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
const depositedText = { note: 'Scritta dal modello', transcription: 'Depositata dall’agente' } as const;

export async function agentVisitPresentation(review: AgentVisitReview, plan: AgentApplicationInput): Promise<VisitConfirmationPresentation> {
    if (!review.patient || typeof review.visit.anchor.fiscalCode !== 'string') throw unavailable();
    const proposals: VisitConfirmationPresentation['proposals'] = [];
    for (const prepared of plan.items) {
        const sourceItem = review.visit.items.find(item => item.id === prepared.id && item.kind === prepared.kind);
        if (!sourceItem) throw unavailable();
        if (sourceItem.kind === 'pdf') {
            const document = review.documents.find(value => value.id === sourceItem.id);
            if (!document || document.beyondText) throw unavailable();
            proposals.push({ id: sourceItem.id, kind: sourceItem.kind, title: agentReviewItemLabels.pdf, fields: [{ label: 'Testo', value: shownWhole(document.text.trim()) }], current: 'Non presente',
                sourceName: shownWhole(document.name), sourceQuote: 'Depositato dall’agente', sourceHash: document.hash });
            continue;
        }
        if (sourceItem.kind === 'note' || sourceItem.kind === 'transcription') {
            const value = shownWhole(sourceItem.value.text);
            proposals.push({ id: sourceItem.id, kind: sourceItem.kind, title: agentReviewItemLabels[sourceItem.kind], fields: [{ label: 'Testo', value }], current: 'Non presente',
                sourceName: 'Cassetta della visita', sourceQuote: depositedText[sourceItem.kind], sourceHash: await textHash(value) });
            continue;
        }
        const { source, quote, values } = sourceItem.value;
        if (!source || typeof source !== 'object' || !('fileName' in source) || typeof source.fileName !== 'string'
            || !('sha256' in source) || typeof source.sha256 !== 'string' || typeof quote !== 'string' || !values || typeof values !== 'object') {
            throw unavailable();
        }
        const fields = Object.entries(values).filter(([, value]) => value !== '').map(([field, value]) => {
            const label = agentReviewFieldLabels[field];
            if (!label || typeof value !== 'string') throw unavailable();
            return { label, value: agentReviewFieldValues[field]?.[value] ?? value };
        });
        proposals.push({ id: sourceItem.id, kind: sourceItem.kind, title: agentReviewItemLabels[sourceItem.kind], fields,
            current: review.currentSummary.get(sourceItem.id) ?? 'Non presente', sourceName: source.fileName, sourceQuote: quote, sourceHash: source.sha256 });
    }
    return { patient: (review.patient.lastName + ' ' + review.patient.firstName).trim() || review.patient.taxCode, fiscalCode: review.visit.anchor.fiscalCode, proposals };
}

export async function sealVisitConfirmationPresentation(reference: string, agreementPublicKey: string, presentation: VisitConfirmationPresentation) {
    const encode = new TextEncoder();
    const peer = await crypto.subtle.importKey('raw', agentBytes(agreementPublicKey), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
    const sender = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    const secret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, sender.privateKey, 256));
    const input = encode.encode(JSON.stringify(presentation));
    const aad = encode.encode(reference);
    try {
        if (input.length > 200_000) throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
        const material = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
        const key = await crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: encode.encode(visitConfirmationPurpose), info: aad },
            material, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad }, key, input);
        const envelope = { publicKey: agentBase64(new Uint8Array(await crypto.subtle.exportKey('raw', sender.publicKey))),
            iv: agentBase64(iv), ciphertext: agentBase64(new Uint8Array(ciphertext)) };
        return agentBase64(encode.encode(JSON.stringify(envelope)));
    } finally {
        secret.fill(0);
        input.fill(0);
    }
}
