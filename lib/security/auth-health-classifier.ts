/* @Codex */
export type AuthHealthDbState =
    | 'ready'
    | 'missing'
    | 'schema-missing'
    | 'unavailable';

/* @Codex */
export type AuthHealthCategory =
    | 'native-dependency-invalid'
    | 'native-dependency-missing'
    | 'db-missing'
    | 'data-dir-unavailable'
    | 'schema-missing'
    | 'query-failed'
    | 'unknown';

/* @Codex */
export type AuthHealthErrorCode =
    | 'DB_NATIVE_DEPENDENCY_INVALID'
    | 'DB_NATIVE_DEPENDENCY_MISSING'
    | 'DB_MISSING'
    | 'DATA_DIR_UNAVAILABLE'
    | 'DB_SCHEMA_MISSING'
    | 'DB_QUERY_FAILED'
    | 'AUTH_CHECK_FAILED';

/* @Codex */
export type AuthHealthClassification = {
    code: AuthHealthErrorCode;
    category: AuthHealthCategory;
    dbState: AuthHealthDbState;
    message: string;
    remediationCommand?: string;
    nextAction?: string;
};

/* @Codex */
const NATIVE_ABI_PATTERNS = [
    /NODE_MODULE_VERSION/i,
    /was compiled against a different Node\.js version/i,
    /better[_-]sqlite3\.node/i,
    /ERR_DLOPEN_FAILED/i,
];

/* @Codex */
const NATIVE_MISSING_PATTERNS = [
    /Cannot find module ['"]better-sqlite3['"]/i,
    /Cannot find module ['"]drizzle-orm/i,
    /MODULE_NOT_FOUND/i,
];

/* @Codex */
function safeMessage(error: unknown): string {
    if (error instanceof Error && typeof error.message === 'string') {
        return error.message;
    }
    if (typeof error === 'string') return error;
    return 'Unknown error';
}

/* @Codex */
function errorCode(error: unknown): string | undefined {
    if (error && typeof error === 'object' && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        if (typeof code === 'string') return code;
    }
    return undefined;
}

/* @Codex */
export function classifyAuthHealthError(error: unknown): AuthHealthClassification {
    const message = safeMessage(error);
    const code = errorCode(error);

    const isNativeAbi =
        code === 'ERR_DLOPEN_FAILED' ||
        NATIVE_ABI_PATTERNS.some((re) => re.test(message));

    if (isNativeAbi) {
        return {
            code: 'DB_NATIVE_DEPENDENCY_INVALID',
            category: 'native-dependency-invalid',
            dbState: 'unavailable',
            message: 'Modulo nativo SQLite incompatibile con il runtime Node corrente.',
            remediationCommand: 'npm ci',
            nextAction:
                'Usa Node 24, reinstalla le dipendenze con npm ci e riavvia; i guard verificheranno il binding prima dell’avvio.',
        };
    }

    const isNativeMissing =
        code === 'MODULE_NOT_FOUND' ||
        NATIVE_MISSING_PATTERNS.some((re) => re.test(message));

    if (isNativeMissing) {
        return {
            code: 'DB_NATIVE_DEPENDENCY_MISSING',
            category: 'native-dependency-missing',
            dbState: 'unavailable',
            message: 'Modulo nativo SQLite mancante.',
            remediationCommand: 'npm install',
            nextAction: 'Reinstalla le dipendenze del progetto, poi riavvia l’app.',
        };
    }

    if (/no such table/i.test(message)) {
        return {
            code: 'DB_SCHEMA_MISSING',
            category: 'schema-missing',
            dbState: 'schema-missing',
            message: 'Schema del database locale mancante.',
            nextAction: 'Ripristina un database valido da backup o applica le migrazioni previste.',
        };
    }

    return {
        code: 'DB_QUERY_FAILED',
        category: 'query-failed',
        dbState: 'unavailable',
        message: 'Impossibile leggere il database locale.',
        nextAction: 'Verifica permessi e integrità del database locale oppure ripristina un backup recente.',
    };
}
