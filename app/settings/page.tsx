'use client';

import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { ThemeToggle } from '@/components/theme-toggle';
import {
    deriveNetworkOperatingModeViewModel,
    type NetworkOverviewPayload,
} from '@/lib/network-operating-mode';
import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';

import styles from '@/components/settings/settings-lume.module.css';

const LEGACY_ANCHOR_REDIRECTS: Record<string, string> = {
    '#account': '/settings/profilo',
    '#ai': '/settings/ai/modelli',
    '#backups': '/settings/backup',
    '#data': '/settings/repertori',
    '#operations': '/settings/diagnostica',
    '#appearance': '/settings/aspetto',
};

async function readNetworkOverview(): Promise<NetworkOverviewPayload> {
    const response = await fetch('/api/system/network-overview', { cache: 'no-store' });
    if (!response.ok) throw new Error('network overview failed');
    return response.json() as Promise<NetworkOverviewPayload>;
}

/* @Codex LUME-110/68 */
export default function SettingsPage() {
    const router = useRouter();
    const [networkOverview, setNetworkOverview] = useState<NetworkOverviewPayload | null>(null);
    const [confirmedNetworkMode, setConfirmedNetworkMode] = useState<
        NetworkOverviewPayload['session']['operatingMode'] | null
    >(null);
    const [isNetworkLoading, setIsNetworkLoading] = useState(true);
    const [isNetworkSaving, setIsNetworkSaving] = useState(false);
    const [networkError, setNetworkError] = useState<string | null>(null);

    const networkViewModel = useMemo(
        () => (networkOverview ? deriveNetworkOperatingModeViewModel(networkOverview) : null),
        [networkOverview],
    );

    useEffect(() => {
        const target = LEGACY_ANCHOR_REDIRECTS[window.location.hash];
        if (target) router.replace(target);
    }, [router]);

    useEffect(() => {
        let cancelled = false;
        void readNetworkOverview()
            .then((overview) => {
                if (!cancelled) {
                    setNetworkOverview(overview);
                    setConfirmedNetworkMode(overview.session.operatingMode);
                }
            })
            .catch(() => {
                if (!cancelled) setNetworkError('Stato rete non disponibile. Riprova dalla diagnostica.');
            })
            .finally(() => {
                if (!cancelled) setIsNetworkLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    const updateNetworkMode = async () => {
        const activeMode = networkOverview?.session.operatingMode ?? confirmedNetworkMode;
        if (!activeMode || isNetworkSaving) return;
        const nextMode = activeMode === 'network-home-base'
            ? 'local-only'
            : 'network-home-base';
        setIsNetworkSaving(true);
        setNetworkError(null);
        try {
            const response = await fetch('/api/settings/network.mode', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: nextMode }),
            });
            if (!response.ok) throw new Error('network mode update failed');
            setConfirmedNetworkMode(nextMode);
            try {
                const refreshedOverview = await readNetworkOverview();
                setNetworkOverview(refreshedOverview);
                setConfirmedNetworkMode(refreshedOverview.session.operatingMode);
            } catch {
                setNetworkOverview(null);
                setNetworkError('Modalità aggiornata. I dettagli del nodo non sono ancora disponibili.');
            }
        } catch {
            setNetworkError('La modalità non è cambiata. Riprova dalla diagnostica.');
        } finally {
            setIsNetworkSaving(false);
        }
    };

    const currentNetworkMode = networkOverview?.session.operatingMode ?? confirmedNetworkMode;
    const isHomeBase = currentNetworkMode === 'network-home-base';
    const networkStatus = networkViewModel?.currentState.label
        ?? (currentNetworkMode === 'network-home-base'
            ? 'Home-base'
            : currentNetworkMode === 'local-only'
                ? 'Locale'
                : networkError ? 'Non disponibile' : 'Lettura');
    const networkEffect = !currentNetworkMode
        ? networkError
            ? 'La modalità operativa non è verificabile. Non viene fatta alcuna ipotesi sullo stato di home-base.'
            : 'Lettura della modalità operativa in corso. Lo stato di home-base non è ancora determinato.'
        : isHomeBase
            ? networkOverview
                ? 'Home-base abilitato. Il canale dati resta disponibile solo ai dispositivi associati con sessione operatore valida.'
                : 'Home-base abilitato. Pairing e sessione non sono verificabili finché i dettagli del nodo non tornano disponibili.'
            : 'Home-base disabilitato. Questa postazione non espone il canale dati ai dispositivi associati.';

    return (
        <div className={styles.overview} data-testid="settings-overview-section">
            <section
                className={styles.overviewFocus}
                data-testid="settings-focus-section"
                data-settings-section="system-status"
                data-lume-elevation="focal"
            >
                <div>
                    <p className={styles.sectionLabel}>Modalità operativa</p>
                    <h2>
                        {networkViewModel?.currentState.title
                            ?? (currentNetworkMode
                                ? 'Modalità salvata, dettagli del nodo non disponibili'
                                : 'Lettura del nodo locale')}
                    </h2>
                    <p
                        className={`${styles.overviewValue} lume-registro`}
                        data-lume-register-value="true"
                        data-testid="settings-network-mode-value"
                        aria-live="polite"
                    >
                        {networkStatus}
                    </p>
                    <p className={styles.supportingCopy}>
                        {networkEffect} Esportazione e backup restano percorsi separati ed espliciti.
                    </p>
                    {networkError ? <p className={styles.errorNote} role="status">{networkError}</p> : null}
                </div>
                <div className={styles.focusActions}>
                    <button
                        type="button"
                        className={styles.primaryAction}
                        data-settings-primary="true"
                        data-testid="settings-network-mode-action"
                        disabled={isNetworkLoading || isNetworkSaving || !currentNetworkMode}
                        onClick={() => void updateNetworkMode()}
                    >
                        {isNetworkSaving
                            ? 'Aggiornamento'
                            : !currentNetworkMode
                                ? isNetworkLoading ? 'Lettura stato' : 'Stato non disponibile'
                                : isHomeBase
                                    ? 'Disattiva home-base'
                                    : 'Abilita home-base'}
                    </button>
                    <Link href="/settings/diagnostica" className={styles.secondaryAction}>
                        Apri diagnostica
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </div>
            </section>

            <section
                className={styles.previewSection}
                data-testid="settings-preview-section"
                data-settings-section="appearance-preview"
            >
                <div className={styles.previewCopy}>
                    <p className={styles.sectionLabel}>Anteprima immediata</p>
                    <h2>Lettura della postazione</h2>
                    <p className={styles.supportingCopy}>
                        Il cambio di registro si vede subito su questa superficie ed è reversibile dallo stesso controllo.
                    </p>
                </div>
                <div className={styles.previewField} aria-live="polite">
                    <span>Valore verificabile</span>
                    <strong className="lume-registro" data-lume-register-value="true">08:30</strong>
                    <span>Testo operativo nella Voce</span>
                </div>
                <div className={styles.previewActions}>
                    <ThemeToggle />
                    <Link
                        href="/settings/aspetto"
                        className={styles.primaryAction}
                        data-settings-primary="true"
                    >
                        Regola aspetto
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </div>
            </section>

            <nav className={styles.settingsIndex} aria-labelledby="settings-index-title">
                <div className={styles.indexHeading}>
                    <p className={styles.sectionLabel}>Indice</p>
                    <div>
                        <h2 id="settings-index-title">Tutte le impostazioni</h2>
                        <p>Apri una sezione oppure premi ⌘K. La configurazione resta separata dal lavoro clinico.</p>
                    </div>
                </div>

                <div className={styles.indexGroups}>
                    {SETTINGS_NAV_GROUPS.map((group) => (
                        <div className={styles.indexGroup} key={group.id}>
                            <p className={styles.indexGroupTitle}>{group.label}</p>
                            <ul className={styles.indexList}>
                                {group.items.map((item) => (
                                    <li key={item.id}>
                                        <Link
                                            href={item.href}
                                            className={styles.indexLink}
                                            data-testid={`settings-overview-link-${item.id}`}
                                            data-tone={item.tone ?? 'default'}
                                        >
                                            <span>
                                                <strong>{item.label}</strong>
                                                <small>{item.description}</small>
                                            </span>
                                            <ArrowUpRight aria-hidden="true" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>
            </nav>
        </div>
    );
}
