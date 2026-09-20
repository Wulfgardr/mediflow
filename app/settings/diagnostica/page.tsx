'use client';

// WUL-297 Diagnostica: moved from the monolithic settings page.

import DiagnosticHub from '@/components/diagnostic-hub';
import Link from 'next/link';
import ServiceArchitecturePanel from '@/components/service-architecture-panel';
/* @Codex */
import UpdateAwarenessPanel from '@/components/settings/update-awareness-panel';
import { SETTINGS_SECONDARY_BUTTON_CLASS, SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsDiagnosticsPage() {
    return (
        <section className="space-y-4" data-testid="settings-diagnostics-section">
            <SettingsSectionIntro
                kicker="Sistema"
                title="Diagnostica"
                description="Stato dei servizi, architettura della postazione e aggiornamenti software."
            />

            <div className="space-y-6">
                <div id="who-setup">
                    <Link className={SETTINGS_SECONDARY_BUTTON_CLASS} href="/settings/repertori#who-setup">Configura WHO nei Repertori</Link>
                </div>
                <ServiceArchitecturePanel />
                <DiagnosticHub />
                <UpdateAwarenessPanel />
            </div>
        </section>
    );
}
