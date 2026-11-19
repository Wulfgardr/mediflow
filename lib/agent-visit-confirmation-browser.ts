'use client';

import { agentBase64, agentBytes } from './agent-cassette-crypto';
import { agentReviewFieldLabels, agentReviewFieldValues, agentReviewItemLabels } from './agent-visit-review-labels';
import { visitConfirmationPurpose, type VisitConfirmationPresentation } from './agent-visit-confirmation-contract';
import type { AgentVisitReview } from './agent-visit-review';
import type { AgentApplicationInput } from './agent-visit-application-contract';

export function agentVisitPresentation(review: AgentVisitReview, plan: AgentApplicationInput): VisitConfirmationPresentation {
    if (!review.patient || typeof review.visit.anchor.fiscalCode !== 'string') throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
    const planned = (id: string) => plan.items.some(item => item.id === id);
    const proposals = plan.items.flatMap((prepared): VisitConfirmationPresentation['proposals'] => {
        const sourceItem = review.visit.items.find(item => item.id === prepared.id && item.kind === prepared.kind);
        if (!sourceItem) throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
        if (sourceItem.kind === 'pdf') {
            if (!review.noteDocuments.some(document => document.id === sourceItem.id && planned(document.noteId))) throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
            return [];
        }
        if (sourceItem.kind === 'note') {
            const documents = review.noteDocuments.filter(document => document.noteId === sourceItem.id && planned(document.id));
            const note = sourceItem.value.text;
            if (documents.length !== 1 || typeof note !== 'string' || !note.trim()) throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
            return [{ title: agentReviewItemLabels.note, fields: [{ label: 'Testo', value: note }], current: 'Non presente',
                sourceName: documents[0]!.name, sourceQuote: 'Scritta dal modello', sourceHash: documents[0]!.hash }];
        }
        const { source, quote, values } = sourceItem.value;
        if (!source || typeof source !== 'object' || !('fileName' in source) || typeof source.fileName !== 'string'
            || !('sha256' in source) || typeof source.sha256 !== 'string' || typeof quote !== 'string' || !values || typeof values !== 'object') {
            throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
        }
        const fields = Object.entries(values).filter(([, value]) => value !== '').map(([field, value]) => {
            const label = agentReviewFieldLabels[field];
            if (!label || typeof value !== 'string') throw new Error('VISIT_PRESENTATION_UNAVAILABLE');
            return { label, value: agentReviewFieldValues[field]?.[value] ?? value };
        });
        return [{ title: agentReviewItemLabels[sourceItem.kind], fields,
            current: review.currentSummary.get(sourceItem.id) ?? 'Non presente', sourceName: source.fileName, sourceQuote: quote, sourceHash: source.sha256 }];
    });
    return { patient: review.patient.lastName + ' ' + review.patient.firstName, fiscalCode: review.visit.anchor.fiscalCode, proposals };
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
