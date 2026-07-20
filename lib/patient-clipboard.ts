/* @Codex */
export type ClipboardOperation = 'copy' | 'cut';

export interface PatientClipboardState {
    patientIds: string[];
    patientVersions: Record<string, number>;
    operation: ClipboardOperation | null;
    sourceAmbulatoryId: string | null;
}

type PatientClipboardRequest = (
    url: string,
    init: RequestInit,
) => Promise<{ ok: boolean }>;

type PatientClipboardEffects = {
    request?: PatientClipboardRequest;
    onSuccess?: () => void;
};

export async function executePatientClipboardPaste(
    clipboard: PatientClipboardState,
    targetAmbulatoryId: string,
    isTestEnvironment: boolean,
    effects: PatientClipboardEffects = {},
): Promise<boolean> {
    if (clipboard.patientIds.length === 0 || !clipboard.operation || targetAmbulatoryId.trim().length === 0) {
        return false;
    }

    let endpoint: string;
    let body: Record<string, unknown>;
    if (isTestEnvironment) {
        endpoint = '/api/patients/duplicate';
        body = { patientIds: clipboard.patientIds, targetAmbulatoryId };
    } else if (clipboard.operation === 'copy') {
        endpoint = '/api/patients/assign';
        body = { patientIds: clipboard.patientIds, targetAmbulatoryId };
    } else {
        if (!clipboard.sourceAmbulatoryId || !hasExactPatientVersions(clipboard)) return false;
        endpoint = '/api/patients/move';
        body = {
            patientIds: clipboard.patientIds,
            patientVersions: clipboard.patientVersions,
            targetAmbulatoryId,
            sourceAmbulatoryId: clipboard.sourceAmbulatoryId,
        };
    }

    const request = effects.request ?? ((url, init) => fetch(url, init));
    const response = await request(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!response.ok) return false;

    effects.onSuccess?.();
    return true;
}

function hasExactPatientVersions(clipboard: PatientClipboardState): boolean {
    const requestedIds = new Set(clipboard.patientIds);
    if (Object.keys(clipboard.patientVersions).length !== requestedIds.size) return false;
    return Array.from(requestedIds).every((patientId) => (
        Object.hasOwn(clipboard.patientVersions, patientId)
        && Number.isInteger(clipboard.patientVersions[patientId])
        && clipboard.patientVersions[patientId] > 0
    ));
}
