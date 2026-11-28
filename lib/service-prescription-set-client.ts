import { db, type ServicePrescription, type ServicePrescriptionItem } from './db';
import { notifyDbChange } from './live-query';
import type { PackagePrescriptionDraft } from './territorial/lombardia/service-packages';

export const SERVICE_PRESCRIPTION_SET_ENDPOINT = '/api/service-prescription-sets';

export type ServicePrescriptionSetOutcome =
    | { kind: 'saved'; count: number }
    | { kind: 'refused'; message: string }
    | { kind: 'unconfirmed' };

const REFUSAL_MESSAGES: Record<number, string> = {
    400: 'dati della prescrizione non validi',
    401: 'sessione scaduta, sblocca e riprova',
    403: 'operazione non consentita in questa sessione',
    404: 'la scheda non è più disponibile',
    409: 'le prestazioni sono cambiate nel frattempo, ricarica la scheda',
    413: 'troppe prestazioni in un solo gesto',
};

function isReceiptFor(value: unknown, drafts: readonly PackagePrescriptionDraft[]): boolean {
    const entries = (value as { entries?: unknown } | null)?.entries;
    return Array.isArray(entries) && entries.length === drafts.length && drafts.every((draft, index) =>
        entries[index]?.prescriptionId === draft.prescription.id && entries[index]?.itemId === draft.item.id);
}

/** Sends the drafts as one gesture; an unconfirmed outcome is retried with the same drafts. */
export async function submitServicePrescriptionSet(drafts: readonly PackagePrescriptionDraft[], fetchImpl: typeof fetch = fetch): Promise<ServicePrescriptionSetOutcome> {
    const entries = await Promise.all(drafts.map(async (draft) => ({
        prescription: await db.servicePrescriptions.prepareWritePayload(draft.prescription as Partial<ServicePrescription>),
        item: await db.servicePrescriptionItems.prepareWritePayload(draft.item as Partial<ServicePrescriptionItem>),
    })));
    let response: Response;
    try {
        response = await fetchImpl(SERVICE_PRESCRIPTION_SET_ENDPOINT, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ entries }),
        });
    } catch {
        return { kind: 'unconfirmed' };
    } finally {
        notifyDbChange('service_prescriptions');
        notifyDbChange('service_prescription_items');
    }
    const refusal = REFUSAL_MESSAGES[response.status];
    if (refusal) return { kind: 'refused', message: refusal };
    if (!response.ok) return { kind: 'unconfirmed' };
    const receipt = await response.json().catch(() => null);
    return isReceiptFor(receipt, drafts) ? { kind: 'saved', count: drafts.length } : { kind: 'unconfirmed' };
}
