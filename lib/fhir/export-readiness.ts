import type { Bundle } from 'fhir/r4';
import type { ValidatePatientExportResponse } from '../fse-validate-patient-contract';
import { FhirExportPrecheckError, type ConfirmFhirDiagnosisWarnings } from './export-precheck';

export type ExportControlStatus = 'ready' | 'warning' | 'blocked' | 'unavailable';
type ReadinessPhase = ExportControlStatus | 'pending';
export type FhirExportChecks = {
    patientId: string;
    validation: ValidatePatientExportResponse | null;
    controls: readonly [ExportControlStatus, ExportControlStatus];
};

type ReadinessQuery = { loading: boolean; error: unknown; data: FhirExportChecks | undefined };
const PRESENTATION = {
    pending: { label: 'Controllo dei dati per l’esportazione FSE in corso.', tone: 'muted', role: 'status' },
    unavailable: { label: 'Controllo dei dati per l’esportazione FSE non disponibile.', tone: 'critical', role: 'alert' },
    blocked: { label: 'Dati da correggere per l’esportazione FSE.', tone: 'critical', role: 'alert' },
    warning: { label: 'Dati da verificare per l’esportazione FSE.', tone: 'warning', role: 'alert' },
    ready: { label: 'Dati pronti per l’esportazione FSE.', tone: 'success', role: 'status' },
} as const;

export function describeFhirExportReadiness(query: ReadinessQuery, patientId: string) {
    let phase: ReadinessPhase;
    if (query.loading) phase = 'pending';
    else if (query.error || !query.data) phase = 'unavailable';
    else if (query.data.patientId !== patientId) phase = 'pending';
    else phase = (['unavailable', 'blocked', 'warning'] as const).find(status => query.data!.controls.includes(status))
        ?? (query.data.controls.every(status => status === 'ready') ? 'ready' : 'unavailable');
    const presentation = PRESENTATION[phase];
    const validation = !query.error && phase !== 'pending' && query.data?.patientId === patientId ? query.data.validation : null;
    return {
        ...presentation,
        phase,
        loading: phase === 'pending',
        error: phase === 'unavailable' && !validation ? presentation.label : null,
        validation,
    };
}

export async function inspectFhirExportReadiness(
    patientId: string,
    validate: () => Promise<ValidatePatientExportResponse>,
    prepareBundle: (confirm: ConfirmFhirDiagnosisWarnings) => Promise<Bundle | null>,
): Promise<FhirExportChecks> {
    let diagnosisWarnings = false;
    const [validationResult, bundleResult] = await Promise.allSettled([
        Promise.resolve().then(validate).then(value => {
            if (!value || typeof value.hasErrors !== 'boolean' || typeof value.hasWarnings !== 'boolean') throw new Error('FSE_VALIDATION_UNAVAILABLE');
            return value;
        }),
        Promise.resolve().then(() => prepareBundle(warnings => {
            diagnosisWarnings = warnings.length > 0;
            return false;
        })),
    ]);
    const validation = validationResult.status === 'fulfilled' ? validationResult.value : null;
    const validationStatus: ExportControlStatus = !validation ? 'unavailable'
        : validation.hasErrors ? 'blocked' : validation.hasWarnings ? 'warning' : 'ready';
    const bundleStatus: ExportControlStatus = bundleResult.status === 'rejected'
        ? bundleResult.reason instanceof FhirExportPrecheckError ? 'blocked' : 'unavailable'
        : diagnosisWarnings ? 'warning' : bundleResult.value ? 'ready' : 'unavailable';
    return { patientId, validation, controls: [validationStatus, bundleStatus] };
}
