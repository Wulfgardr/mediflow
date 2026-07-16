import { useState } from 'react';
import Link from 'next/link';
import {
  Database,
  Inbox,
  Plus,
  UserSquare2,
  Workflow,
} from 'lucide-react';

import { db } from '@/lib/db';
import { completeSissPortalHandoff, prepareSissPortalWindow } from '@/lib/siss';
import type {
  SissPatientContextAction,
  SissPatientContextHandoffResult,
} from '@/lib/siss-patient-context-shared';
import { PillBadge } from '../cockpit-shared';
import type { AreaId, HandoffFeedback } from '../cockpit-shared';
import type { Kree8Patient } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';


/* @Codex */
function isSissPatientContextHandoffResult(
  payload: unknown,
): payload is SissPatientContextHandoffResult {
  if (!payload || typeof payload !== 'object') return false;
  const candidate = payload as Partial<SissPatientContextHandoffResult>;
  return candidate.status === 'handoff'
    && typeof candidate.action === 'string'
    && typeof candidate.title === 'string'
    && typeof candidate.handoffUrl === 'string'
    && typeof candidate.correlationId === 'string'
    && typeof candidate.message === 'string';
}

/* @Codex */
function LiveHandoffArea({
  patient,
  onOpenArea,
}: {
  patient?: Kree8Patient | null;
  onOpenArea: (area: AreaId) => void;
}) {
  const [activeAction, setActiveAction] = useState<SissPatientContextAction | null>(null);
  const [feedback, setFeedback] = useState<HandoffFeedback | null>(null);
  const fiscalCodeReady = patient ? patient.code !== 'CF non disponibile' : false;

  const startHandoff = async (action: SissPatientContextAction) => {
    if (!patient) {
      setFeedback({
        kind: 'error',
        message: 'Seleziona un paziente prima di aprire un portale regionale.',
      });
      return;
    }
    if (!fiscalCodeReady && action !== 'menu.open') {
      setFeedback({
        kind: 'warning',
        message: 'Il Prescrittivo Regionale (PRREG) richiede un codice fiscale valido nel profilo paziente.',
      });
      return;
    }

    setActiveAction(action);
    setFeedback(null);
    const popupWindow = prepareSissPortalWindow();
    if (!popupWindow) {
      setFeedback({
        kind: 'error',
        message: 'Popup SISS bloccato dal browser. Consenti i popup e riprova.',
      });
      setActiveAction(null);
      return;
    }

    try {
      const response = await fetch('/api/siss/context', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ patientId: patient.id, action }),
      });
      const payload = await response.json().catch(() => null) as unknown;

      if (!response.ok) {
        popupWindow.close();
        const errorPayload = payload && typeof payload === 'object'
          ? payload as { error?: unknown; correlationId?: unknown }
          : null;
        setFeedback({
          kind: 'error',
          message: typeof errorPayload?.error === 'string'
            ? errorPayload.error
            : 'Flusso SISS non disponibile.',
          correlationId: typeof errorPayload?.correlationId === 'string'
            ? errorPayload.correlationId
            : null,
        });
        return;
      }

      if (!isSissPatientContextHandoffResult(payload)) {
        popupWindow.close();
        throw new Error('Risposta SISS non valida');
      }

      const handoffResult = await completeSissPortalHandoff({
        handoffUrl: payload.handoffUrl,
        clipboardText: payload.clipboardText ?? undefined,
        successMessage: payload.message,
        popupWindow,
      });

      if (!handoffResult.opened) {
        popupWindow.close();
      }

      setFeedback({
        kind: handoffResult.success ? 'success' : handoffResult.opened ? 'warning' : 'error',
        message: `${payload.title}: ${handoffResult.message}`,
        correlationId: payload.correlationId,
      });

      if (handoffResult.opened) {
        const now = new Date();
        void db.sissHandoffs.add({
          id: crypto.randomUUID(),
          patientId: patient.id,
          action,
          moduleLabel: payload.title,
          reason: 'Portale regionale aperto dalla scheda MediFlow.',
          startedAt: now,
          outcome: 'started',
          correlationId: payload.correlationId,
          createdAt: now,
          updatedAt: now,
        }).catch((error) => {
          console.warn('[MediFlow] Kree8 SISS handoff diary write failed:', error);
        });
      }
    } catch (error) {
      popupWindow.close();
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Errore inatteso nel flusso SISS.',
      });
    } finally {
      setActiveAction(null);
    }
  };

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Portali regionali (SISS)</p>
          <h1 className={styles.areaTitle}>
            Preparazione SISS <em>· contesto paziente e diario</em>
          </h1>
          <p className={styles.areaSubtitle}>
            {patient
              ? `Contesto aperto su ${patient.name}.`
              : 'Seleziona un paziente prima di preparare un passaggio verso i portali regionali.'}
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
            <Inbox size={12} />
            Scegli paziente
          </button>
          {patient ? (
            <button
              type="button"
              className={styles.primaryBtn}
              disabled={activeAction === 'prescription.create' || !fiscalCodeReady}
              onClick={() => void startHandoff('prescription.create')}
            >
              <Workflow size={13} />
              {!fiscalCodeReady
                ? 'CF richiesto'
                : activeAction === 'prescription.create'
                  ? 'Apertura…'
                  : 'Apri Prescrittivo Regionale (PRREG)'}
            </button>
          ) : null}
        </div>
      </header>

      <div className={styles.threeCol}>
        {[
          { title: 'Identità e consenso', sub: patient ? `${patient.code} · ${patient.ageLabel}` : 'paziente non selezionato', pill: fiscalCodeReady ? 'pronto' : 'attesa', variant: fiscalCodeReady ? 'success' as const : 'neutral' as const },
          { title: 'Azione regionale', sub: 'prepara portale ufficiale e contesto paziente', pill: 'assistita', variant: 'plum' as const },
          { title: 'Esito', sub: 'registra risultato e prossima azione in diario', pill: 'diario', variant: 'plum' as const },
        ].map((item) => (
          <section key={item.title} className={styles.panel}>
            <header className={styles.panelHeader}>
              <h2 className={styles.panelTitle}>{item.title}</h2>
              <PillBadge variant={item.variant}>{item.pill}</PillBadge>
            </header>
            <p className={styles.panelSubtitle}>{item.sub}</p>
          </section>
        ))}
      </div>

      <section className={styles.panelInset}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Azioni rapide</h2>
          <PillBadge variant="neutral">in MediFlow</PillBadge>
        </header>
        <div className={patientStyles.caseLensActions} style={{ marginTop: 12 }}>
          <Link href="/settings/repertori" className={styles.ghostBtnSm}>
            <Database size={12} />
            Gestisci repertori
          </Link>
          {patient ? (
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('scheda')}>
              <UserSquare2 size={12} />
              Quadro paziente
            </button>
          ) : (
            <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('incarico')}>
              <UserSquare2 size={12} />
              Scegli paziente
            </button>
          )}
          {patient ? (
            <Link href={`${patient.href}/entries/new`} className={styles.ghostBtnSm}>
              <Plus size={12} />
              Nota esito
            </Link>
          ) : null}
        </div>
        {feedback ? (
          <div className={styles.compositeCard} style={{ marginTop: 12 }}>
            <header className={styles.panelHeader}>
              <span className={styles.evidenceTitle}>
                {feedback.kind === 'success'
                  ? 'Portale aperto'
                  : feedback.kind === 'warning'
                    ? 'Passaggio da completare'
                    : 'Portale non avviato'}
              </span>
              <PillBadge
                variant={
                  feedback.kind === 'success'
                    ? 'success'
                    : feedback.kind === 'warning'
                      ? 'warning'
                      : 'critical'
                }
              >
                esito SISS
              </PillBadge>
            </header>
            <p className={styles.rowSub} style={{ margin: 0 }}>
              {feedback.message}
              {feedback.correlationId ? ` · ${feedback.correlationId}` : ''}
            </p>
          </div>
        ) : null}
      </section>
    </div>
  );
}

export { LiveHandoffArea };
