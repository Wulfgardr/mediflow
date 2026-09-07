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
import proposalStyles from '@/components/settings/settings-proposal.module.css';
import overviewStyles from './overview.module.css';

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
    const networkEffectForProposal = !currentNetworkMode
        ? networkError
            ? 'Stato non verificabile. Home-base non confermato.'
            : 'Lettura in corso. Home-base non ancora determinato.'
        : isHomeBase
            ? 'Home-base attivo.'
            : 'Home-base disattivato.';
    const networkStatusForProposal = !currentNetworkMode
        ? networkError ? 'Non disponibile' : 'Lettura'
        : isHomeBase ? 'Home-base' : 'Locale';
    const networkDetailForProposal = !currentNetworkMode
        ? networkError
            ? 'La modalità operativa non è verificabile. Non viene fatta alcuna ipotesi sullo stato di home-base.'
            : 'La modalità operativa è ancora in lettura. Lo stato di home-base non è determinato.'
        : isHomeBase
            ? networkOverview
                ? 'Il canale dati resta disponibile solo ai dispositivi associati con sessione operatore valida.'
                : 'Pairing e sessione non sono verificabili finché i dettagli del nodo non tornano disponibili.'
            : 'Questa postazione non espone il canale dati ai dispositivi associati.';

    return (
        <div className={`${styles.overview} ${overviewStyles.overview}`} data-testid="settings-overview-section">
            <section
                className={`${styles.overviewFocus} ${proposalStyles.proposalOverviewFocus} ${overviewStyles.section}`}
                data-testid="settings-focus-section"
                data-settings-section="system-status"
                data-lume-elevation="focal"
            >
                <div>
                    <p className={`${styles.sectionLabel} ${proposalStyles.blockOriginal}`}>Modalità operativa</p>
                    <h2>
                        <span className={proposalStyles.inlineOriginal}>
                            {networkViewModel?.currentState.title
                                ?? (currentNetworkMode
                                    ? 'Modalità salvata, dettagli del nodo non disponibili'
                                    : 'Lettura del nodo locale')}
                        </span>
                        <span className={proposalStyles.inlineProposal}>Postazione</span>
                    </h2>
                    <p
                        className={`${styles.overviewValue} ${proposalStyles.proposalNetworkStatus} ${overviewStyles.status} lume-registro`}
                        data-lume-register-value="true"
                        data-testid="settings-network-mode-value"
                        aria-live="polite"
                    >
                        <span className={proposalStyles.inlineOriginal}>{networkStatus}</span>
                        <span className={proposalStyles.proposalStatusLabel}>Stato</span>
                        <span className={`${proposalStyles.inlineProposal} ${proposalStyles.proposalNetworkStatusValue}`}>
                            {networkStatusForProposal}
                        </span>
                    </p>
                    <p className={styles.supportingCopy}>
                        <span className={proposalStyles.inlineOriginal}>
                            {networkEffect} Esportazione e backup restano percorsi separati ed espliciti.
                        </span>
                        <span className={proposalStyles.inlineProposal}>{networkEffectForProposal}</span>
                    </p>
                    <details className={`${proposalStyles.proposalDetail} ${overviewStyles.details}`}>
                        <summary>Dettagli della connessione</summary>
                        <p>{networkDetailForProposal} Esportazione e backup restano percorsi separati ed espliciti.</p>
                    </details>
                    {networkError ? <p className={styles.errorNote} role="status">{networkError}</p> : null}
                </div>
                <div className={`${styles.focusActions} ${proposalStyles.proposalFocusActions} ${overviewStyles.actions}`}>
                    <button
                        type="button"
                        className={`${styles.primaryAction} ${proposalStyles.proposalAction}`}
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
                    <Link href="/settings/diagnostica" className={`${styles.secondaryAction} ${proposalStyles.proposalAction}`}>
                        Apri diagnostica
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </div>
            </section>

            <section
                className={`${styles.previewSection} ${proposalStyles.previewSectionProposal} ${overviewStyles.section}`}
                data-testid="settings-preview-section"
                data-settings-section="appearance-preview"
            >
                <div className={styles.previewCopy}>
                    <p className={`${styles.sectionLabel} ${proposalStyles.blockOriginal}`}>Anteprima immediata</p>
                    <h2>
                        <span className={proposalStyles.inlineOriginal}>Lettura della postazione</span>
                        <span className={proposalStyles.inlineProposal}>Aspetto</span>
                    </h2>
                    <p className={styles.supportingCopy}>
                        <span className={proposalStyles.inlineOriginal}>
                            Il cambio di registro si vede subito su questa superficie ed è reversibile dallo stesso controllo.
                        </span>
                        <span className={proposalStyles.inlineProposal}>Scegli il tema chiaro, scuro o di sistema.</span>
                    </p>
                </div>
                <div className={`${styles.previewField} ${proposalStyles.originalOnly}`} aria-live="polite">
                    <span className={proposalStyles.inlineOriginal}>Valore verificabile</span>
                    <strong className={`${proposalStyles.inlineOriginal} lume-registro`} data-lume-register-value="true">08:30</strong>
                    <span className={proposalStyles.inlineOriginal}>Testo operativo nella Voce</span>
                </div>
                <div className={`${styles.previewActions} ${overviewStyles.actions}`}>
                    <ThemeToggle />
                    <Link
                        href="/settings/aspetto"
                        className={styles.primaryAction}
                        data-settings-primary="true"
                    >
                        <span className={proposalStyles.inlineOriginal}>Regola aspetto</span>
                        <span className={proposalStyles.inlineProposal}>Apri aspetto</span>
                        <ArrowUpRight aria-hidden="true" />
                    </Link>
                </div>
            </section>

            <nav className={styles.settingsIndex} aria-labelledby="settings-index-title">
                <div className={`${styles.indexHeading} ${proposalStyles.originalOnly}`}>
                    <p className={styles.sectionLabel}>Indice</p>
                    <div>
                        <h2 id="settings-index-title">Tutte le impostazioni</h2>
                        <p>Apri una sezione oppure premi ⌘K. La configurazione resta separata dal lavoro clinico.</p>
                    </div>
                </div>

                <div className={`${styles.indexGroups} ${proposalStyles.originalOnly}`}>
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
                                                <small className={proposalStyles.blockOriginal}>{item.description}</small>
                                            </span>
                                            <ArrowUpRight aria-hidden="true" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    ))}
                </div>

                <div className={proposalStyles.proposalQuickLinks} aria-label="Scorciatoie impostazioni">
                    <Link href="/settings/backup" className={styles.secondaryAction}>Backup</Link>
                    <Link href="/settings/profilo" className={styles.secondaryAction}>Profilo</Link>
                    <Link href="/settings/repertori" className={styles.secondaryAction}>Repertori</Link>
                </div>
            </nav>
        </div>
    );
}
