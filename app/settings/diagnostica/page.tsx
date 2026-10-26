'use client';

// WUL-297 Diagnostica: moved from the monolithic settings page.

import DiagnosticHub from '@/components/diagnostic-hub';
import Link from 'next/link';
import ServiceArchitecturePanel from '@/components/service-architecture-panel';
import UpdateAwarenessPanel from '@/components/settings/update-awareness-panel';
import { Disclosure } from '@/components/disclosure';
import styles from '@/components/settings/evidence-pages.module.css';
import { SETTINGS_SECONDARY_BUTTON_CLASS } from '@/components/settings/settings-ui';

export default function SettingsDiagnosticsPage() {
    return (
        <section className={styles.page} data-testid="settings-diagnostics-section">
            <header className={styles.intro}>
                <h2>Diagnostica</h2>
                <p>Stato dei servizi, architettura della postazione e aggiornamenti software.</p>
            </header>
            <ServiceArchitecturePanel />
            <Disclosure title="Diagnostica di Sistema" headingLevel={3} className={styles.section}>
                <DiagnosticHub />
            </Disclosure>
            <UpdateAwarenessPanel />
            <div id="who-setup" className={styles.actions}>
                <Link className={SETTINGS_SECONDARY_BUTTON_CLASS} href="/settings/repertori#who-setup">Configura WHO nei Repertori</Link>
            </div>
        </section>
    );
}
