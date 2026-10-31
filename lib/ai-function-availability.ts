export const TREATMENT_REASONING_UNAVAILABLE_CODE = 'treatment_reasoning_unavailable_in_release' as const;
export const TREATMENT_REASONING_UNAVAILABLE_LABEL = 'Non disponibile in questa versione';
export const TREATMENT_REASONING_UNAVAILABLE_REASON = 'Le nuove proposte terapeutiche sono rinviate a una versione successiva. Le proposte salvate restano consultabili.';

export class AiFunctionUnavailableError extends Error {
    readonly code = TREATMENT_REASONING_UNAVAILABLE_CODE;
    constructor() { super(TREATMENT_REASONING_UNAVAILABLE_LABEL); this.name = 'AiFunctionUnavailableError'; }
}

export function assertFunctionAvailableInRelease(functionId: string): void {
    if (functionId === 'treatment_reasoning') throw new AiFunctionUnavailableError();
}
