/* @Codex */
export interface PatientIdentityLike {
    firstName: string;
    lastName: string;
}

/* @Codex */
export function normalizePersonToken(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/['’-]/g, '')
        .toLowerCase()
        .trim();
}

/* @Codex */
function splitPatientNameTokens(value: string): string[] {
    return normalizePersonToken(value)
        .split(/\s+/)
        .map((token) => token.trim())
        .filter(Boolean);
}

/* @Codex */
export function detectSuspiciousPersonNames(text: string | null | undefined, patient: PatientIdentityLike): string[] {
    if (!text || !text.trim()) return [];

    const firstNameTokens = splitPatientNameTokens(patient.firstName);
    const lastNameTokens = splitPatientNameTokens(patient.lastName);
    const patientNames = new Set([
        `${normalizePersonToken(patient.firstName)} ${normalizePersonToken(patient.lastName)}`.trim(),
        `${normalizePersonToken(patient.lastName)} ${normalizePersonToken(patient.firstName)}`.trim(),
    ]);
    const matches = new Set<string>();
    const pattern = /\b([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+)\s+([A-ZÀ-ÖØ-Ý][a-zà-öø-ÿ'’-]+)\b/g;

    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
        const fullName = `${match[1]} ${match[2]}`;
        const normalized = normalizePersonToken(fullName);
        if (!normalized || patientNames.has(normalized)) continue;

        const [firstToken, secondToken] = normalized.split(/\s+/);
        const matchesPatientTokens = Boolean(firstToken && secondToken) && (
            (firstNameTokens.includes(firstToken) && lastNameTokens.includes(secondToken))
            || (lastNameTokens.includes(firstToken) && firstNameTokens.includes(secondToken))
        );
        if (matchesPatientTokens) continue;

        matches.add(fullName);
    }

    return Array.from(matches);
}
