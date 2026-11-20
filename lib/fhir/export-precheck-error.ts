export class FhirExportPrecheckError extends Error {
    readonly severity = 'error';

    constructor(
        public readonly code: 'INVALID_SCALE_SCORE' | 'INVALID_SCALE_TITLE' | 'INVALID_DATE' | 'INVALID_ENCOUNTER_PAIR',
        public readonly recordId: string,
        public readonly category: 'scale' | 'diagnosis' | 'entry' | 'therapy' = 'scale',
    ) {
        super(code);
        this.name = 'FhirExportPrecheckError';
    }
}
