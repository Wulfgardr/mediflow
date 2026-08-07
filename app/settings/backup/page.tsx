'use client';

// WUL-297 Backup e Ripristino: moved from the monolithic settings page.

import BackupRestoreUI from '@/components/backup-restore-ui';
import BackupSchedulerUI from '@/components/backup-scheduler-ui';
import { SettingsSectionIntro } from '@/components/settings/settings-ui';

export default function SettingsBackupPage() {
    return (
        <section className="space-y-4" data-testid="settings-backup-section">
            <SettingsSectionIntro
                kicker="Dati e sicurezza"
                title="Backup e ripristino"
                description="Schedulazione e restore degli archivi cifrati locali."
            />
            <div className="space-y-6">
                <BackupSchedulerUI />
                <BackupRestoreUI />
            </div>
        </section>
    );
}
