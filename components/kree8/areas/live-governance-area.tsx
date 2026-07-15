import Link from 'next/link';
import {
  Activity,
  Database,
  HardDrive,
  KeyRound,
  Settings as SettingsIcon,
  Sparkles,
} from 'lucide-react';

import { PillBadge } from '../cockpit-shared';
import type { PillVariant } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit.module.css';


/* @Codex */
function LiveGovernanceArea({
  patientCount,
}: {
  patientCount: number;
}) {
  const settingsLinks: Array<{
    href: string;
    title: string;
    sub: string;
    icon: typeof KeyRound;
    pill: string;
    variant: PillVariant;
  }> = [
    {
      href: '/settings',
      title: 'Stato postazione',
      sub: 'sessione, servizi e dati locali',
      icon: Activity,
      pill: 'operativo',
      variant: 'success',
    },
    {
      href: '/settings/profilo',
      title: 'Account e PIN di sblocco',
      sub: 'profilo medico, ambulatorio e rotazione PIN',
      icon: KeyRound,
      pill: 'locale',
      variant: 'neutral',
    },
    {
      href: '/settings/ai/modelli',
      title: 'Modelli AI locali',
      sub: 'provider, modelli attivi e controlli di sicurezza',
      icon: Sparkles,
      pill: 'controlli attivi',
      variant: 'plum',
    },
    {
      href: '/settings/backup',
      title: 'Backup cifrati',
      sub: 'schedulazione, ripristino e prove operative',
      icon: HardDrive,
      pill: 'manuale',
      variant: 'neutral',
    },
    {
      href: '/settings/repertori',
      title: 'Repertori clinici',
      sub: 'AIFA, ICD ed esenzioni',
      icon: Database,
      pill: 'importazione manuale',
      variant: 'neutral',
    },
    {
      href: '/settings/diagnostica',
      title: 'Diagnostica e servizi',
      sub: 'servizi locali, manutenzione e app nativa',
      icon: Activity,
      pill: 'Mac locale',
      variant: 'neutral',
    },
    {
      href: '/settings/aspetto',
      title: 'Lettura e accessibilità',
      sub: 'riduzione movimento, leggibilità e aspetto',
      icon: SettingsIcon,
      pill: 'preferenze',
      variant: 'neutral',
    },
  ];

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Sistema e impostazioni</p>
          <h1 className={styles.areaTitle}>
            Stato operativo <em>· controlli della postazione</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Storage autorevole sul Mac home-base; accessi paired, cache ed export
            restano percorsi espliciti.
          </p>
        </div>
      </header>

      <div className={styles.threeCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Sessione</h2>
            <PillBadge variant="neutral">attiva</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>{patientCount} pazienti disponibili in elenco.</p>
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Audit</h2>
            <PillBadge variant="neutral">locale</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Registro locale consultabile dalle impostazioni di sistema.</p>
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Backup</h2>
            <PillBadge variant="neutral">Mac principale</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Backup e ripristino restano operazioni esplicite sul Mac.</p>
        </section>
      </div>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Accesso rapido alle impostazioni</h2>
        </header>
        <div className={styles.settingsQuickGrid}>
          {settingsLinks.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.href} href={item.href} className={styles.settingsQuickItem}>
                <span className={styles.modeIcon}><Icon size={15} /></span>
                <span className={styles.settingsQuickText}>
                  <span className={styles.modeTitle}>{item.title}</span>
                  <span className={styles.modeSub}>{item.sub}</span>
                </span>
                <span className={styles.settingsQuickPill}>
                  <PillBadge variant={item.variant}>{item.pill}</PillBadge>
                </span>
              </Link>
            );
          })}
        </div>
      </section>
    </div>
  );
}

export { LiveGovernanceArea };
