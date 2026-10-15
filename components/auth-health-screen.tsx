'use client';

import React from 'react';
import { RefreshCw } from 'lucide-react';
import type { AuthHealthPayload } from '@/lib/security/client-auth-api';
import styles from './auth-health-screen.module.css';

type AuthDbState = NonNullable<NonNullable<AuthHealthPayload['db']>['state']>;

const DB_STATE_LABEL: Record<AuthDbState, string> = {
    ready: 'pronto',
    missing: 'assente',
    'schema-missing': 'schema mancante',
    unavailable: 'non disponibile',
};

// Title and plain explanation for each condition; the server's nextAction stays the instruction.
const CONDITIONS: Record<string, { title: string; text: string }> = {
    DB_NATIVE_DEPENDENCY_INVALID: {
        title: 'Un componente va ricompilato',
        text: 'Il modulo SQLite non corrisponde alla versione di Node in uso, quindi l’archivio non si può aprire.',
    },
    DB_NATIVE_DEPENDENCY_MISSING: {
        title: 'Mancano le dipendenze',
        text: 'Il modulo SQLite non è installato, quindi l’archivio non si può aprire.',
    },
    DB_MISSING: {
        title: 'L’archivio non è dove dovrebbe essere',
        text: 'La cartella dei dati esiste, ma il file dell’archivio non c’è. MediFlow non ne crea uno nuovo al suo posto, per non nascondere un archivio spostato.',
    },
    DB_SCHEMA_MISSING: {
        title: 'L’archivio non è completo',
        text: 'Il file c’è, ma mancano le tabelle che MediFlow si aspetta.',
    },
    DB_QUERY_FAILED: {
        title: 'L’archivio non si riesce a leggere',
        text: 'Il file c’è, ma la lettura non riesce: di solito dipende dai permessi o dall’integrità del file.',
    },
    DATA_DIR_UNAVAILABLE: {
        title: 'La cartella dei dati non è raggiungibile',
        text: 'MediFlow non riesce ad aprire la cartella in cui conserva l’archivio.',
    },
};

const FALLBACK = {
    title: 'Non riesco a verificare l’archivio',
    text: 'Il controllo dell’archivio locale non è riuscito.',
};

export function AuthHealthScreen({
    health,
    onRetry,
    onRepair,
    isRepairing,
}: {
    health: AuthHealthPayload;
    onRetry: () => void;
    onRepair?: () => void;
    isRepairing?: boolean;
}) {
    const code = health.error?.code;
    const condition = (code && CONDITIONS[code]) || { ...FALLBACK, text: health.error?.message || FALLBACK.text };
    const remediationCommand = health.error?.remediationCommand;
    const nextAction = health.error?.nextAction;
    const details = [
        code ? ['Codice', code] : null,
        health.db?.state ? ['Stato dell’archivio', DB_STATE_LABEL[health.db.state] ?? 'non noto'] : null,
        health.error?.category ? ['Categoria', health.error.category] : null,
    ].filter(Boolean) as Array<[string, string]>;

    return (
        <div className={styles.screen}>
            <main className={styles.sheet} role="alert" aria-labelledby="auth-health-title">
                <p className={styles.brand}>MediFlow<b>.</b></p>
                <h1 id="auth-health-title" className={styles.title}>{condition.title}</h1>
                <p className={styles.text}>{condition.text}</p>

                {nextAction && (
                    <section className={styles.block}>
                        <h2 className={styles.label}>Cosa fare</h2>
                        <p className={styles.text}>{nextAction}</p>
                    </section>
                )}

                {remediationCommand && (
                    <section className={styles.block}>
                        <h2 className={styles.label}>Comando da eseguire nel terminale</h2>
                        <code className={styles.command}>{remediationCommand}</code>
                        <p className={styles.note}>Usa la stessa versione di Node con cui avvii MediFlow. Il comando non parte da solo.</p>
                    </section>
                )}

                <div className={styles.actions}>
                    <button type="button" onClick={onRetry} className="ui-btn-primary lume-press px-4 py-2">
                        <RefreshCw aria-hidden="true" className="h-4 w-4" />
                        Riprova
                    </button>
                    {onRepair && (
                        <button type="button" onClick={onRepair} disabled={isRepairing}
                            className="mf-btn-secondary lume-press px-4 py-2 disabled:opacity-60">
                            {isRepairing ? 'Recupero in corso' : 'Recupera dall’archivio precedente'}
                        </button>
                    )}
                </div>

                {details.length > 0 && (
                    <dl className={styles.details}>
                        {details.map(([label, value]) => (
                            <div key={label}>
                                <dt>{label}</dt>
                                <dd className={label === 'Codice' ? styles.code : undefined}>{value}</dd>
                            </div>
                        ))}
                    </dl>
                )}
            </main>
        </div>
    );
}
