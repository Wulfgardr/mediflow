export const IDENTIFIER_TYPES = ['cf', 'stp', 'eni', 'passport', 'other', 'none'] as const;
export type PatientIdentifierType = typeof IDENTIFIER_TYPES[number];
export type BirthDatePrecision = 'exact' | 'estimated' | 'unknown';
export const IDENTIFIER_LABELS: Record<PatientIdentifierType, string> = {
    cf: 'Codice fiscale', stp: 'Codice STP', eni: 'Codice ENI', passport: 'Documento estero',
    other: 'Altro identificativo', none: 'Nessun identificativo per ora',
};
const digits = 'LMNPQRSTUV';
const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
export function decodeTaxCodeDigits(value: string): string {
    return value.replace(/[LMNPQRSTUV]/g, char => String(digits.indexOf(char)));
}
export function isValidItalianTaxCode(value: string): boolean {
    if (/[^A-Za-z0-9]/.test(value.trim())) return false;
    const cf = value.trim().toUpperCase();
    if (!/^[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/.test(cf)) return false;
    const day = Number(decodeTaxCodeDigits(cf.slice(9, 11)));
    if (!(day >= 1 && day <= 31 || day >= 41 && day <= 71)) return false;
    let sum = 0;
    for (let i = 0; i < 15; i++) {
        const code = cf.charCodeAt(i);
        const n = code >= 65 ? code - 65 : code - 48;
        sum += i % 2 === 0 ? odd[n] : n;
    }
    return cf[15] === String.fromCharCode(65 + sum % 26);
}
export function inferIdentifierType(value?: string | null): PatientIdentifierType {
    const normalized = value?.trim().toUpperCase() ?? '';
    return normalized.startsWith('STP') ? 'stp' : normalized.startsWith('ENI') ? 'eni' : normalized ? 'cf' : 'none';
}
export function normalizeIdentifierValue(type: PatientIdentifierType, value: string): string {
    return ['cf', 'stp', 'eni'].includes(type) ? value.trim().toUpperCase() : value.trim();
}
export function identifierError(type: unknown, value: unknown): string | null {
    if (!IDENTIFIER_TYPES.includes(type as PatientIdentifierType)) return 'Scegli il tipo di identificativo.';
    if (type === 'none') return value === undefined || value === null || value === '' ? null : 'Scegliendo nessun identificativo, lascia vuoto il valore.';
    if (typeof value !== 'string' || !value.trim()) return 'Inserisci l’identificativo del paziente.';
    if (type === 'cf') return isValidItalianTaxCode(value) ? null : 'Controlla il codice fiscale: formato o carattere finale non corretto.';
    if (type === 'stp' || type === 'eni') return new RegExp(`^${type.toUpperCase()}[0-9]{13}$`).test(value.trim().toUpperCase()) ? null : `Il codice ${type.toUpperCase()} deve avere il prefisso ${type.toUpperCase()} seguito da 13 cifre.`;
    return value.trim().length <= 128 && !/[\u0000-\u001f\u007f]/.test(value) ? null : 'L’identificativo deve contenere al massimo 128 caratteri, senza caratteri di controllo.';
}
export type PatientIdentityInput = {
    identifierType?: PatientIdentifierType; taxCode?: string | null;
    birthDate?: Date | string | null; birthDatePrecision?: BirthDatePrecision; birthYear?: number | null;
};
export function birthError(input: PatientIdentityInput): string | null {
    const precision = input.birthDatePrecision ?? (input.birthDate ? 'exact' : input.birthYear != null ? 'estimated' : 'unknown');
    if (!['exact', 'estimated', 'unknown'].includes(precision)) return 'Scegli quanto conosci della data di nascita.';
    if (precision === 'exact') {
        const date = input.birthDate ? new Date(input.birthDate) : null;
        if (!date || !Number.isFinite(date.getTime()) || date.getTime() > Date.now()) return 'Inserisci una data di nascita valida, non futura.';
        if (typeof input.birthDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) && date.toISOString().slice(0, 10) !== input.birthDate) return 'La data di nascita non esiste nel calendario.';
        if (input.birthYear != null) return 'Con la data esatta, lascia vuoto l’anno stimato.';
    } else if (precision === 'estimated') {
        if (!Number.isInteger(input.birthYear) || input.birthYear! < 1850 || input.birthYear! > new Date().getFullYear()) return 'Inserisci un anno di nascita stimato valido, non futuro.';
        if (input.birthDate) return 'Con l’anno stimato, lascia vuota la data esatta.';
    } else if (input.birthDate || input.birthYear != null) return 'Se la nascita è sconosciuta, lascia vuoti data e anno.';
    if ((input.identifierType ?? inferIdentifierType(input.taxCode)) === 'none' && precision === 'unknown') return 'Senza identificativo serve la data di nascita oppure l’anno stimato.';
    return null;
}
export function patientAgeLabel(patient: PatientIdentityInput, now = new Date()): string | null {
    const precision = patient.birthDatePrecision ?? (patient.birthDate ? 'exact' : patient.birthYear != null ? 'estimated' : 'unknown');
    if (precision === 'exact' && patient.birthDate) {
        const birth = new Date(patient.birthDate);
        if (!Number.isFinite(birth.getTime()) || birth > now) return null;
        let age = now.getUTCFullYear() - birth.getUTCFullYear();
        if (now.getUTCMonth() < birth.getUTCMonth() || now.getUTCMonth() === birth.getUTCMonth() && now.getUTCDate() < birth.getUTCDate()) age--;
        return `${age} ${age === 1 ? 'anno' : 'anni'}`;
    }
    let year = precision === 'estimated' ? patient.birthYear : null;
    if (!year && (patient.identifierType ?? inferIdentifierType(patient.taxCode)) === 'cf' && patient.taxCode && isValidItalianTaxCode(patient.taxCode)) {
        const yy = Number(decodeTaxCodeDigits(patient.taxCode.toUpperCase().slice(6, 8)));
        year = 2000 + yy;
        if (year > now.getFullYear()) year -= 100;
    }
    return year && year <= now.getFullYear() ? `circa ${now.getFullYear() - year} anni` : null;
}
