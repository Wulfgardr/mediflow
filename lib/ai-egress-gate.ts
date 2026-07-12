/* @Codex */

export type EgressGateStatus = 'allowed' | 'closed_pending_redaction_lane' | 'blocked_residual_entities';

export type EgressEntityCounts = Record<string, number>;

export interface EgressGateResult {
    status: EgressGateStatus;
    redactedText?: string;
    entityCounts: EgressEntityCounts;
    rehydrationMap?: Map<string, string>;
}

export interface EvaluateEgressInput {
    text: string;
    lane: string;
    knownIdentifiers?: {
        names?: string[];
        birthDates?: string[];
    };
}

// ADR 0033 and ADR 0077 require a promoted neural redaction lane before any
// narrative clinical payload can leave the device. OpenMed is benchmark-only,
// so this gate intentionally remains closed even after Layer 1 redaction.
export function isEgressGateOpen(): false {
    return false;
}

const ITALIAN_TAX_CODE_REGEX = /\b[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]\b/gi;
const CF_STRUCTURE_REGEX = /^[A-Z]{6}[0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]$/;
const NRE_REGION_CODES = new Set([
    '010', '020', '030', '041', '042', '050', '060', '070', '080', '090',
    '100', '110', '120', '130', '140', '150', '160', '170', '180', '190', '200',
]);
const NRE_REGEX = /\b\d{3}[A-Z0-9]{2}\d{10}\b/gi;
const ITALIAN_TEAM_REGEX = /\b80380\d{15}\b/g;
// Etichette disgiunte dal separatore e quantificatori limitati stile RFC:
// il punto dentro la classe del dominio rendeva ambiguo lo split e apriva a
// backtracking superlineare su input avversariali lunghi.
const EMAIL_REGEX = /\b[A-Z0-9._%+-]{1,64}@(?:[A-Z0-9-]{1,63}\.){1,8}[A-Z]{2,24}\b/gi;
// Il nosologico non ha un formato nazionale affidabile: si redige solo quando
// e' etichettato nel testo; i numeri nudi restano compito del layer 2 neurale.
const NOSOLOGICO_REGEX = /\b(?:n(?:\.|r\.?|umero)?\s+)?nosologico\s*(?:n(?:\.|r\.?|umero)?)?\s*:?\s*\d{5,12}\b/gi;
const PHONE_REGEX = /(?<![\w+])(?:(?:\+|00)39[\s.-]?)?(?:0\d{1,4}|3\d{2})[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?!\w)/g;
const DATE_REGEX = /\b(?:0[1-9]|[12]\d|3[01])[/.\-](?:0[1-9]|1[0-2])[/.\-](?:19|20)\d{2}\b/g;

const CF_ODD_VALUES: Record<string, number> = {
    '0': 1, '1': 0, '2': 5, '3': 7, '4': 9, '5': 13, '6': 15, '7': 17, '8': 19, '9': 21,
    A: 1, B: 0, C: 5, D: 7, E: 9, F: 13, G: 15, H: 17, I: 19, J: 21,
    K: 2, L: 4, M: 18, N: 20, O: 11, P: 3, Q: 6, R: 8, S: 12, T: 14,
    U: 16, V: 10, W: 22, X: 25, Y: 24, Z: 23,
};
const CF_EVEN_VALUES: Record<string, number> = {
    '0': 0, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
    A: 0, B: 1, C: 2, D: 3, E: 4, F: 5, G: 6, H: 7, I: 8, J: 9,
    K: 10, L: 11, M: 12, N: 13, O: 14, P: 15, Q: 16, R: 17, S: 18, T: 19,
    U: 20, V: 21, W: 22, X: 23, Y: 24, Z: 25,
};

export function isValidItalianTaxCodeChecksum(taxCode: string): boolean {
    const cf = taxCode.trim().toUpperCase();
    if (cf.length !== 16 || !CF_STRUCTURE_REGEX.test(cf)) return false;

    let sum = 0;
    for (let index = 0; index < 15; index += 1) {
        const value = index % 2 === 0 ? CF_ODD_VALUES[cf[index]] : CF_EVEN_VALUES[cf[index]];
        if (value === undefined) return false;
        sum += value;
    }
    return String.fromCharCode(65 + (sum % 26)) === cf[15];
}

export function evaluateEgress(input: EvaluateEgressInput): EgressGateResult {
    const rehydrationMap = new Map<string, string>();
    const entityCounts: EgressEntityCounts = {};
    const tokensByEntity = new Map<string, Map<string, string>>();
    let redactedText = input.text;

    const redact = (entity: string, pattern: RegExp, predicate?: (value: string) => boolean) => {
        redactedText = redactedText.replace(pattern, (value) => {
            if (predicate && !predicate(value)) return value;
            const normalized = value.toLocaleUpperCase('it-IT');
            let tokens = tokensByEntity.get(entity);
            if (!tokens) {
                tokens = new Map<string, string>();
                tokensByEntity.set(entity, tokens);
            }
            let token = tokens.get(normalized);
            if (!token) {
                token = `{{${tokenLabel(entity)}_${tokens.size + 1}}}`;
                tokens.set(normalized, token);
                rehydrationMap.set(token, value);
            }
            entityCounts[entity] = (entityCounts[entity] ?? 0) + 1;
            return token;
        });
    };

    redact('team', ITALIAN_TEAM_REGEX);
    redact('nre', NRE_REGEX, (value) => NRE_REGION_CODES.has(value.slice(0, 3)));
    redact('nosologico', NOSOLOGICO_REGEX);
    redact('codice_fiscale', ITALIAN_TAX_CODE_REGEX, isValidItalianTaxCodeChecksum);
    // A checksum failure is common in OCR, but it is still an identifier-shaped
    // value. Redact it conservatively rather than letting it cross the boundary.
    redact('codice_fiscale_candidate', ITALIAN_TAX_CODE_REGEX);
    redact('email', EMAIL_REGEX);
    redact('phone', PHONE_REGEX);
    redact('birth_date', DATE_REGEX);

    for (const date of input.knownIdentifiers?.birthDates ?? []) {
        redactKnownValue('birth_date', date, redact);
    }
    for (const name of input.knownIdentifiers?.names ?? []) {
        redactKnownValue('known_name', name, redact);
    }

    return {
        status: 'closed_pending_redaction_lane',
        redactedText,
        entityCounts,
        rehydrationMap,
    };
}

export function rehydrate(text: string, rehydrationMap: ReadonlyMap<string, string>): string {
    let rehydrated = text;
    for (const [token, value] of rehydrationMap) {
        rehydrated = rehydrated.replaceAll(token, value);
    }
    return rehydrated;
}

function redactKnownValue(
    entity: string,
    value: string,
    redact: (entity: string, pattern: RegExp, predicate?: (value: string) => boolean) => void,
): void {
    const trimmed = value.trim();
    if (!trimmed) return;
    redact(entity, new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(trimmed)}(?![\\p{L}\\p{N}])`, 'giu'));
}

function tokenLabel(entity: string): string {
    return {
        birth_date: 'DATA_NASCITA',
        codice_fiscale: 'CF',
        codice_fiscale_candidate: 'CF_CANDIDATO',
        email: 'EMAIL',
        known_name: 'PERSONA',
        nosologico: 'NOSOLOGICO',
        nre: 'NRE',
        phone: 'TELEFONO',
        team: 'TEAM',
    }[entity] ?? entity.toUpperCase();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
