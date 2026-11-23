'use client';

import { ArrowRight, ArrowUpRight, BrainCircuit, Database, LifeBuoy, Monitor, Palette } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Disclosure } from '@/components/disclosure';
import { ViewState } from '@/components/ui/view-state';
import { SettingsThemeControl } from '@/components/settings/settings-theme-control';
import surface from '@/components/record-surface.module.css';
import {
    deriveNetworkOperatingModeViewModel,
    type NetworkOverviewPayload,
} from '@/lib/network-operating-mode';
import { SETTINGS_NAV_GROUPS } from '@/lib/settings-navigation';

import styles from '@/components/settings/settings-lume.module.css';
import overviewStyles from './overview.module.css';

const GROUP_ICONS = new Map([
    ['generale', Monitor],
    ['sicurezza-dati', Database],
    ['ai', BrainCircuit],
    ['avanzate', LifeBuoy],
]);

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

/* LUME-110/68 */
export default function SettingsPage() {
    const router = useRouter();
    const [networkOverview, setNetworkOverview] = useState<NetworkOverviewPayload | null>(null);
    const [confirmedNetworkMode, setConfirmedNetworkMode] = useState<
        NetworkOverviewPayload['session']['operatingMode'] | null
    >(null);
    const [isNetworkLoading, setIsNetworkLoading] = useState(true);
    const [isNetworkSaving, setIsNetworkSaving] = useState(false);
    const [networkError, setNetworkError] = useState<string | null>(null);
    const [isNetworkUnverified, setIsNetworkUnverified] = useState(false);

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
        setIsNetworkUnverified(false);
        setNetworkError(null);
        try {
            const response = await fetch('/api/settings/network.mode', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: nextMode }),
            });
            if ([400, 401, 403, 409].includes(response.status)) {
                const refusal = await response.json().catch(() => null) as { code?: string } | null;
                setNetworkError(refusal?.code === 'NETWORK_MODE_LOCAL_ADMIN_REQUIRED'
                    ? 'Solo un amministratore su questo computer può attivare il modo di rete. La modalità non è cambiata.'
                    : 'La richiesta è stata rifiutata. La modalità non è cambiata.');
                return;
            }
            if (!response.ok) throw new Error('network mode update not confirmed');
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
            setNetworkOverview(null);
            setConfirmedNetworkMode(null);
            setIsNetworkUnverified(true);
            setIsNetworkLoading(true);
            setNetworkError('Esito del cambio non verificato. Rileggo la modalità corrente.');
            try {
                const refreshedOverview = await readNetworkOverview();
                setNetworkOverview(refreshedOverview);
                setConfirmedNetworkMode(refreshedOverview.session.operatingMode);
                setIsNetworkUnverified(false);
                setNetworkError('La risposta al cambio è stata interrotta. È mostrata la modalità corrente riletta.');
            } catch {
                setNetworkError('Esito del cambio non verificato. La modalità corrente non è disponibile. Verificala dalla diagnostica.');
            } finally {
                setIsNetworkLoading(false);
            }
        } finally {
            setIsNetworkSaving(false);
        }
    };

    const currentNetworkMode = networkOverview?.session.operatingMode ?? confirmedNetworkMode;
    const isHomeBase = currentNetworkMode === 'network-home-base';
    const connectionDetail = !currentNetworkMode
        ? 'La modalità operativa non è verificabile. Home-base non confermato.'
        : isHomeBase
            ? networkOverview
                ? 'Il canale dati resta disponibile solo ai dispositivi associati con sessione operatore valida.'
                : 'Abbinamento e sessione non sono verificabili finché i dettagli del nodo non tornano disponibili.'
            : 'Questa postazione non espone il canale dati ai dispositivi associati.';

    return (
        <div className={overviewStyles.overview} data-testid="settings-overview-section">
            <div className={surface.tray} data-record-tray="settings-workstation">
                <section className={surface.island} aria-labelledby="settings-workstation-title"
                    data-testid="settings-focus-section" data-settings-section="system-status">
                    <div className={surface.islandHeader}>
                        <span className={surface.islandIcon}><Monitor size={16} aria-hidden="true" /></span>
                        <h2 id="settings-workstation-title">Postazione</h2>
                    </div>
                    <div className={overviewStyles.row}>
                        <div>
                            <div data-testid="settings-network-mode-value" aria-live="polite">
                                {currentNetworkMode ? <p className={overviewStyles.status}>Modalità operativa <strong>{isHomeBase ? 'Home-base' : 'Locale'}</strong></p>
                                    : <ViewState state={isNetworkUnverified || networkError ? 'unavailable' : 'loading'}
                                        title={isNetworkUnverified ? 'Non verificata' : networkError ? 'Non disponibile' : 'Lettura della modalità operativa…'}
                                        detail={networkError ?? undefined} />}
                            </div>
                            <Disclosure title="Dettagli della connessione">
                                <p>{connectionDetail}</p>
                                {networkViewModel ? <p>{networkViewModel.currentState.label}. {networkViewModel.currentState.description}</p> : null}
                                <p>Esportazione e backup restano percorsi separati ed espliciti.</p>
                            </Disclosure>
                            {currentNetworkMode && networkError ? <p className={overviewStyles.notice} role="status">{networkError}</p> : null}
                        </div>
                        <div className={overviewStyles.actions}>
                            <button type="button" className={styles.primaryAction} data-settings-primary="true"
                                data-testid="settings-network-mode-action" disabled={isNetworkLoading || isNetworkSaving || !currentNetworkMode}
                                onClick={() => void updateNetworkMode()}>
                                {isNetworkSaving ? 'Aggiornamento' : !currentNetworkMode
                                    ? isNetworkLoading ? 'Lettura stato' : 'Stato non disponibile'
                                    : isHomeBase ? 'Disattiva home-base' : 'Abilita home-base'}
                            </button>
                            <Link href="/settings/diagnostica" className={styles.secondaryAction}>
                                Apri diagnostica<ArrowUpRight size={16} aria-hidden="true" />
                            </Link>
                        </div>
                    </div>
                </section>
                <section className={`${surface.island} ${overviewStyles.appearance}`} aria-labelledby="settings-appearance-title"
                    data-testid="settings-preview-section" data-settings-section="appearance-preview">
                    <div className={surface.islandHeader}>
                        <span className={surface.islandIcon}><Palette size={16} aria-hidden="true" /></span>
                        <h2 id="settings-appearance-title">Aspetto</h2>
                    </div>
                    <SettingsThemeControl />
                </section>
            </div>
            <nav className={`${surface.tray} ${overviewStyles.index}`} data-record-tray="settings-sections" aria-label="Sezioni">
                {SETTINGS_NAV_GROUPS.map(group => {
                    const Icon = GROUP_ICONS.get(group.id);
                    return (
                        <section className={surface.island} key={group.id} aria-labelledby={`settings-group-${group.id}`}>
                            <div className={surface.islandHeader}>
                                {Icon && <span className={surface.islandIcon}><Icon size={16} aria-hidden="true" /></span>}
                                <h2 id={`settings-group-${group.id}`}>{group.label}</h2>
                            </div>
                            <ul className={overviewStyles.list}>
                                {group.items.filter(item => item.href !== '/settings').map(item => (
                                    <li key={item.id}>
                                        <Link href={item.href} className={overviewStyles.indexLink}
                                            data-testid={`settings-overview-link-${item.id}`} data-tone={item.tone ?? 'default'}>
                                            <span><strong>{item.label}</strong><small>{item.description}</small></span>
                                            <ArrowRight size={16} aria-hidden="true" />
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        </section>
                    );
                })}
            </nav>
        </div>
    );
}
