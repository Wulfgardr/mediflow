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
import type { AreaId, HandoffFeedback } from '../cockpit-shared';
import type { Kree8Patient } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit-handoff.module.css';


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

  const reason = patient
    ? fiscalCodeReady
      ? 'Il profilo ha il codice fiscale necessario per preparare il passaggio ufficiale.'
      : 'Il codice fiscale manca o non è valido: il Prescrittivo Regionale resta bloccato.'
    : 'Nessun paziente è selezionato nel cockpit.';

  return (
    <div className={styles.area} data-testid="lume-handoff-area">
      <header className={styles.header}>
        <p className={styles.caption}>Handoff regionale</p>
        <h1 className={styles.title}>Preparazione SISS con responsabilità esplicita</h1>
        <p className={styles.subtitle}>
          {patient
            ? `Un solo passaggio assistito per ${patient.name}, senza invio o writeback automatico.`
            : 'Seleziona un paziente prima di preparare il passaggio verso i portali regionali.'}
        </p>
      </header>

      <section
        className={styles.caseFlow}
        aria-labelledby="lume-handoff-case-title"
        data-lume-case="handoff"
        data-testid="lume-handoff-case"
      >
        <div className={styles.section}>
          <p className={styles.sectionLabel}>Evidenza</p>
          <h2 id="lume-handoff-case-title" className={styles.sectionHeading}>
            {patient?.name ?? 'Caso non selezionato'}
          </h2>
          <p className={styles.register} data-lume-register="true">
            Provenienza: profilo locale · Stato: {fiscalCodeReady ? 'CF pronto' : 'CF richiesto'}
          </p>
          <ul className={styles.evidenceList} aria-label="Prerequisiti handoff">
            <li className={styles.evidenceRow}>
              <span className={styles.evidenceKey}>Identità</span>
              <span className={styles.evidenceValue}>
                {patient ? `${patient.code} · ${patient.ageLabel}` : 'Paziente non selezionato'}
              </span>
            </li>
            <li className={styles.evidenceRow}>
              <span className={styles.evidenceKey}>Canale</span>
              <span className={styles.evidenceValue}>Portale regionale ufficiale, apertura assistita</span>
            </li>
          </ul>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Decisione</p>
          <h3 className={styles.sectionHeading}>
            {fiscalCodeReady ? 'Preparare il Prescrittivo Regionale' : 'Non aprire il portale finché manca il CF'}
          </h3>
          <p className={styles.sectionCopy}>
            MediFlow prepara il contesto e registra l&apos;apertura. Prescrizione, conferma e invio restano nel portale ufficiale.
          </p>
        </div>

        <div className={styles.section}>
          <p className={styles.sectionLabel}>Prossimo passo</p>
          <dl className={styles.decisionGrid}>
            <div>
              <dt className={styles.decisionTerm}>Proprietario</dt>
              <dd className={styles.decisionValue}>Medico in sessione</dd>
            </div>
            <div>
              <dt className={styles.decisionTerm}>Motivo</dt>
              <dd className={styles.decisionValue}>{reason}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <Link href="/settings/repertori" className={styles.quietAction}>
              <Database size={12} aria-hidden="true" />
              Gestisci repertori
            </Link>
            {patient ? (
              <>
                <button type="button" className={styles.quietAction} onClick={() => onOpenArea('scheda')}>
                  <UserSquare2 size={12} aria-hidden="true" />
                  Quadro paziente
                </button>
                <Link href={`${patient.href}/entries/new`} className={styles.quietAction}>
                  <Plus size={12} aria-hidden="true" />
                  Nota esito
                </Link>
              </>
            ) : null}
            {patient ? (
              <button
                type="button"
                className={styles.primaryAction}
                data-lume-primary="true"
                disabled={activeAction === 'prescription.create' || !fiscalCodeReady}
                onClick={() => void startHandoff('prescription.create')}
              >
                <Workflow size={13} aria-hidden="true" />
                {!fiscalCodeReady
                  ? 'CF richiesto'
                  : activeAction === 'prescription.create'
                    ? 'Apertura...'
                    : 'Apri Prescrittivo Regionale (PRREG)'}
              </button>
            ) : (
              <button
                type="button"
                className={styles.primaryAction}
                data-lume-primary="true"
                onClick={() => onOpenArea('incarico')}
              >
                <Inbox size={13} aria-hidden="true" />
                Scegli paziente
              </button>
            )}
          </div>
          {feedback ? (
            <div className={styles.feedback} role="status">
              <p className={styles.feedbackTitle}>
                {feedback.kind === 'success'
                  ? 'Portale aperto'
                  : feedback.kind === 'warning'
                    ? 'Passaggio da completare'
                    : 'Portale non avviato'}
              </p>
              <p className={styles.feedbackMessage}>
                {feedback.message}
                {feedback.correlationId ? ` · ${feedback.correlationId}` : ''}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export { LiveHandoffArea };
