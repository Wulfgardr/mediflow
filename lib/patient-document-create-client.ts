import { clientArchiveGeneration } from './security/client-auth-api';

export const PATIENT_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;
export const PATIENT_DOCUMENT_ACCEPT = 'application/pdf,image/jpeg,image/png';

export type PatientDocumentField = Readonly<{ action: 'correct'; value: string }>;
export type PatientDocumentReview = Readonly<{
    firstName: PatientDocumentField; lastName: PatientDocumentField; taxCode: PatientDocumentField;
    birthDate?: PatientDocumentField; duplicate: 'none' | 'create-separate';
}>;
export type PatientDocumentView = Readonly<{
    commandId: string; viewId: string; text: string; identity: 'labelled' | 'ambiguous'; quality: 'ready' | 'uncertain' | 'ocr_error';
}>;
export type PatientDocumentReceipt =
    | Readonly<{ outcome: 'applied'; patientId: string; attachmentId: string; attachmentReadback: 'client-verification-required' }>
    | Readonly<{ outcome: 'retired' }>
    | Readonly<{ outcome: 'unknown' }>;
export type PatientDocumentResponse = Readonly<{ status: number; body: Record<string, unknown> | null }>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export async function requestPatientDocument(body: Record<string, unknown>, signal: AbortSignal): Promise<PatientDocumentResponse> {
    signal.throwIfAborted();
    const response = await fetch('/api/patients/document-create', { method: 'POST', signal, credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'x-mediflow-archive-generation': clientArchiveGeneration() }, body: JSON.stringify(body) });
    const parsed = await response.json().catch(() => null) as unknown;
    return { status: response.status, body: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null };
}

/** Only the three outcomes of the shared command are accepted; anything else is not a receipt. */
export function parsePatientDocumentReceipt(value: unknown): PatientDocumentReceipt | null {
    if (!value || typeof value !== 'object') return null;
    const receipt = value as Record<string, unknown>, keys = Object.keys(receipt).sort().join(',');
    if ((receipt.outcome === 'retired' || receipt.outcome === 'unknown') && keys === 'outcome') return { outcome: receipt.outcome };
    if (receipt.outcome === 'applied' && keys === 'attachmentId,attachmentReadback,outcome,patientId'
        && typeof receipt.patientId === 'string' && UUID.test(receipt.patientId)
        && typeof receipt.attachmentId === 'string' && UUID.test(receipt.attachmentId)
        && receipt.attachmentReadback === 'client-verification-required') {
        return { outcome: 'applied', patientId: receipt.patientId, attachmentId: receipt.attachmentId, attachmentReadback: 'client-verification-required' };
    }
    return null;
}

export type PreparedPatientDocument = Readonly<{ bytes: Uint8Array<ArrayBuffer>; fileName: string; converted: boolean }>;
export class PatientDocumentFileRejected extends Error {
    constructor(readonly reason: 'type' | 'size' | 'empty') { super(`Patient document rejected: ${reason}`); }
}

/** A PDF passes unchanged. A JPEG or PNG becomes a one-page PDF so that the server contract,
 * the local OCR of scans and the ENC2 attachment stay the ones already used by the native window. */
export async function preparePatientDocumentFile(file: File): Promise<PreparedPatientDocument> {
    if (file.size === 0) throw new PatientDocumentFileRejected('empty');
    if (file.size > PATIENT_DOCUMENT_MAX_BYTES) throw new PatientDocumentFileRejected('size');
    const input = new Uint8Array(await file.arrayBuffer());
    const isPdf = input.length >= 5 && String.fromCharCode(...input.subarray(0, 5)) === '%PDF-';
    const isJpeg = input.length >= 3 && input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff;
    const isPng = input.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => input[index] === byte);
    if (isPdf) return { bytes: input, fileName: file.name, converted: false };
    if (!isJpeg && !isPng) { input.fill(0); throw new PatientDocumentFileRejected('type'); }
    try {
        const { PDFDocument } = await import('pdf-lib');
        const pdf = await PDFDocument.create();
        const image = isJpeg ? await pdf.embedJpg(input) : await pdf.embedPng(input);
        pdf.addPage([image.width, image.height]).drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
        const bytes = new Uint8Array(await pdf.save());
        if (bytes.length > PATIENT_DOCUMENT_MAX_BYTES) { bytes.fill(0); throw new PatientDocumentFileRejected('size'); }
        return { bytes, fileName: `${file.name.replace(/\.(jpe?g|png)$/iu, '')}.pdf`, converted: true };
    } catch (error) {
        if (error instanceof PatientDocumentFileRejected) throw error;
        throw new PatientDocumentFileRejected('type');
    } finally { input.fill(0); }
}

/** Local reference to an issued command, kept until its outcome is read: a lost response or a
 * reload then shows the work to verify instead of offering a second creation. Not an authority. */
function markerKey(): string { return `mediflow:patient-document-command:v1:${encodeURIComponent(clientArchiveGeneration())}`; }
export const patientDocumentMarker = {
    read(): string | null {
        try {
            const raw = window.localStorage.getItem(markerKey());
            const value = raw === null ? null : JSON.parse(raw) as { commandId?: unknown };
            return value && typeof value.commandId === 'string' && UUID.test(value.commandId) ? value.commandId : null;
        } catch { return null; }
    },
    write(commandId: string): boolean {
        try {
            window.localStorage.setItem(markerKey(), JSON.stringify({ commandId }));
            return this.read() === commandId;
        } catch { return false; }
    },
    clear(commandId: string) {
        try { if (this.read() === commandId) window.localStorage.removeItem(markerKey()); } catch { /* nothing stored */ }
    },
};
