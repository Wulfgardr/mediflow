import styles from './settings-lume.module.css';
import proposalStyles from './settings-proposal.module.css';

/* @Codex LUME-110/68 */
export const SETTINGS_CARD_CLASS = `${styles.settingSurface} p-6 md:p-7`;
export const SETTINGS_SECTION_CARD_CLASS = `${styles.settingLayer} p-5 md:p-6`;
export const SETTINGS_INPUT_CLASS = styles.settingInput;
export const SETTINGS_LABEL_CLASS = styles.settingLabel;
export const SETTINGS_PRIMARY_BUTTON_CLASS = `${styles.primaryAction} lume-press disabled:opacity-50`;
export const SETTINGS_SECONDARY_BUTTON_CLASS = styles.secondaryAction;

/* @Codex WUL-676: proposal copy is explicit and presentation-only. The
   original description remains available on every non-proposal surface and
   inside the proposal disclosure when the short copy differs. */
const PROPOSAL_INTRO_COPY: Record<string, string> = {
    Profilo: 'Nome usato nei documenti.',
    Aspetto: 'Tema, movimento e accessibilità.',
    Ambulatori: 'Sedi e contesti di lavoro.',
    Accesso: 'PIN e sessione.',
    'Backup e ripristino': 'Pianificazione e ripristino dei backup locali.',
    'Evidenze e conformità': 'Evidenze tecniche, non una certificazione.',
    Repertori: 'AIFA ed esenzioni, in locale.',
    'Capacità e connessioni': 'Funzioni, sede del calcolo e uscita dati.',
    'Modelli e hardware': 'Hardware e Ollama. ATHENA resta separata.',
    'Funzioni cliniche': 'Interruttori e budget AI.',
    'Governance e rollout': 'Confronto modelli e stato di rilascio.',
    Diagnostica: 'Servizi, architettura e aggiornamenti.',
    Sviluppo: 'Dati demo e app nativa.',
    'Zona Pericolo': 'Reset della configurazione. Richiede nuovo accesso.',
};

export function SettingsSectionIntro({
    kicker,
    title,
    description,
}: {
    kicker: string;
    title: string;
    description: string;
}) {
    const proposalDescription = PROPOSAL_INTRO_COPY[title] ?? description;

    return (
        <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>{kicker}</p>
            <h2>{title}</h2>
            <div className={proposalStyles.proposalDescription}>
                <p>{proposalDescription}</p>
                {proposalDescription !== description ? (
                    <details className={proposalStyles.proposalDetail}>
                        <summary>Dettagli</summary>
                        <p>{description}</p>
                    </details>
                ) : null}
            </div>
            <p className={proposalStyles.originalDescription}>{description}</p>
        </div>
    );
}
