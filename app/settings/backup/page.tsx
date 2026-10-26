'use client';

import { useState } from 'react';
import BackupRestoreUI from '@/components/backup-restore-ui';
import BackupSchedulerUI from '@/components/backup-scheduler-ui';
import { Disclosure } from '@/components/disclosure';
import composition from '@/components/settings/backup-composition.module.css';

export default function SettingsBackupPage() {
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [restorePending, setRestorePending] = useState(false);
    return (
        <section className={composition.page} data-testid="settings-backup-section" aria-labelledby="settings-backup-title">
            <h2 id="settings-backup-title" className={composition.sectionTitle}>Backup e ripristino</h2>
            <p className={composition.introduction}>Conserva una copia dell’archivio e verifica che sia leggibile. Backup completo di recupero ed esportazione portabile hanno contenuti e percorsi distinti.</p>
            <BackupRestoreUI recoveryPrimary={!scheduleOpen} onRestorePendingChange={setRestorePending}>
                <Disclosure title="Backup automatici" headingLevel={3} className={composition.schedule}
                    open={scheduleOpen} onOpenChange={setScheduleOpen}>
                    <BackupSchedulerUI primary={scheduleOpen && !restorePending} />
                </Disclosure>
            </BackupRestoreUI>
        </section>
    );
}
