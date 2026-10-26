'use client';

// WUL-297 Aspetto: moved from the monolithic settings page.

import { useRuntimeTwinDesign } from '@/components/runtime-twin-design';
import { ThemeToggle } from '@/components/theme-toggle';
import { useUIAccessibility } from '@/components/ui-accessibility-provider';
import { usePrivacy } from '@/components/privacy-provider';
import styles from '@/components/settings/account-pages.module.css';

export default function SettingsAppearancePage() {
    const {
        reduceMotion,
        setReduceMotion,
    } = useUIAccessibility();
    const { isPrivacyMode, togglePrivacyMode } = usePrivacy();
    const { enabled, proposal, composition, setComposition, setProposal } = useRuntimeTwinDesign();

    return (
        <section className={styles.page} data-testid="settings-appearance-section">
            <header className={styles.intro}><h2>Aspetto</h2><p>Tema, movimento e accessibilità per una lettura adatta al lavoro clinico.</p></header>
            {enabled && <fieldset className={styles.section} data-testid="settings-navigation-layout">
                <legend className={styles.heading}>Navigazione</legend>
                {([
                    { value: 'stream', title: 'Barra superiore', detail: 'Diario come ingresso della cartella' },
                    { value: 'workbench', title: 'Barra laterale', detail: 'Riepilogo come ingresso della cartella' },
                ] as const).map(({value, title, detail}) => <label key={value} className={styles.row}>
                    <span><strong className={styles.strong}>{title}</strong><span className={styles.copy}>{detail}</span></span>
                    <input type="radio" name="navigation-layout" value={value} aria-label={title}
                        checked={proposal && composition === value}
                        onChange={() => { setComposition(value); setProposal(true); }} />
                </label>)}
            </fieldset>}
            <div className={styles.section} data-testid="ui-accessibility-controls">
                <h3 className={styles.heading}>Tema e movimento</h3>
                <div className={styles.row}>
                    <span><strong className={styles.strong}>Tema interfaccia</strong><span className={styles.copy}>Giorno, Grafite o il tema del sistema.</span></span><ThemeToggle />
                </div>
                <button type="button" onClick={() => setReduceMotion(!reduceMotion)} aria-pressed={reduceMotion} className={`${styles.row} ${styles.preference}`}>
                    <span><strong className={styles.strong}>Riduci movimento</strong><span className={styles.copy}>Riduce le transizioni durante il lavoro.</span></span>
                    <span>{reduceMotion ? 'Attivo' : 'Disattivo'}</span>
                </button>
                <button type="button" onClick={togglePrivacyMode} aria-pressed={isPrivacyMode} data-testid="settings-privacy-mode-pointer" className={`${styles.row} ${styles.preference}`}>
                    <span><strong className={styles.strong}>Offuscamento dati</strong><span className={styles.copy}>Offusca alcuni dati sullo schermo. Non blocca la sessione.</span></span>
                    <span>{isPrivacyMode ? 'Attiva' : 'Spenta'}</span>
                </button>
            </div>
            <p className={styles.copy} data-testid="ui-style-runtime-notice">Schede, strumenti e impostazioni usano lo stesso spazio operativo.</p>
        </section>
    );
}
