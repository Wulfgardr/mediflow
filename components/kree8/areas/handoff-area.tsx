import { useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  ChevronRight,
  FileSignature,
  ShieldCheck,
} from 'lucide-react';

import {
  PillBadge,
  STAGES,
  STAGE_ORDER,
  classNames,
} from '../cockpit-shared';
import type { StageId } from '../cockpit-shared';
import type { PillVariant } from '@/lib/patient-workspace';
import styles from '../kree8-clinical-cockpit.module.css';


/* ───────────────────────── Trasmissioni SISS ───────────────────────── */

const LAUNCHERS: {
  id: string;
  label: string;
  caption: string;
  variant: PillVariant;
}[] = [
  {
    id: 'prescrittivo',
    label: 'Prescrittivo Regionale (PRREG)',
    caption:
      'Apri il portale ufficiale del Prescrittivo Regionale (PRREG) con il CF pronto da incollare.',
    variant: 'blue',
  },
  {
    id: 'protesica',
    label: 'Protesica-RL',
    caption: 'Apri Assistente RL / Protesica-RL con il CF del paziente.',
    variant: 'violet',
  },
  {
    id: 'fse',
    label: 'FSE · OpeFseIE',
    caption: 'Apri OpeFseIE per consultazione FSE governata da consenso.',
    variant: 'green',
  },
  {
    id: 'anagrafe',
    label: 'Anagrafe · Gaia',
    caption: 'Apri Gaia con il CF pronto da incollare.',
    variant: 'muted',
  },
  {
    id: 'menu',
    label: 'Menu SISS',
    caption: 'Apri la home della sessione SISS regionale.',
    variant: 'muted',
  },
];

const BLOCKED_CAPS: { id: string; label: string; reason: string }[] = [
  {
    id: 'prescr-native',
    label: 'Prescrizione diretta',
    reason: 'La prescrizione si completa sul Prescrittivo Regionale (PRREG) ufficiale.',
  },
  {
    id: 'fse-embedded',
    label: 'Consultazione FSE dentro MediFlow',
    reason: 'Il fascicolo va consultato nel portale FSE regionale ufficiale.',
  },
  {
    id: 'sgdt',
    label: 'SGDT / PAI',
    reason: 'SGDT e PAI restano nel portale regionale centralizzato.',
  },
  {
    id: 'certificati',
    label: 'Certificati di malattia',
    reason: 'I certificati si emettono nel portale INPS/SISS ufficiale.',
  },
];

function HandoffArea() {
  const [stage, setStage] = useState<StageId>('handoff');
  const currentIndex = STAGE_ORDER.indexOf(stage);

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Portali regionali (SISS)</p>
          <h1 className={styles.areaTitle}>
            Apri il portale con il paziente pronto <em>· atto ufficiale sul portale</em>
          </h1>
          <p className={styles.areaSubtitle}>
            MediFlow prepara identità, consenso e codice fiscale, poi apre il
            portale regionale corretto. L&apos;atto certificato si completa sul
            portale ufficiale e l&apos;esito viene annotato qui.
          </p>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Portali disponibili</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="muted">5 portali ufficiali</PillBadge>
            <PillBadge variant="green">CF pronto · solo copia-incolla</PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          Scegli il portale da aprire: il codice fiscale è preparato per il
          copia-incolla nella sessione regionale.
        </p>
        <div className={styles.launcherGrid}>
          {LAUNCHERS.map((l) => (
            <button
              key={l.id}
              type="button"
              className={styles.launcherTile}
              onClick={() => setStage('handoff')}
            >
              <div className={styles.launcherTileHeader}>
                <ArrowUpRight size={14} color="var(--ink-muted)" />
                <span className={styles.evidenceTitle}>{l.label}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant={l.variant}>apre portale ufficiale</PillBadge>
                </span>
              </div>
              <p className={styles.launcherTileBody}>{l.caption}</p>
              <div className={styles.launcherTileFoot}>
                <PillBadge variant="muted">CF pronto</PillBadge>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  Apri portale <ArrowUpRight size={11} />
                </span>
              </div>
            </button>
          ))}
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Passaggi SISS</h2>
          <PillBadge variant="muted">{currentIndex + 1} di {STAGES.length}</PillBadge>
        </header>
        <p className={styles.panelSubtitle}>
          Identità, consenso, portale ufficiale e nota di esito restano in una sequenza unica.
        </p>

        <div className={styles.stageRow}>
          <span key={stage} className={styles.stageRowSweep} aria-hidden />
          {STAGES.map((s, i) => {
            const isActive = s.id === stage;
            const isDone = i < currentIndex;
            return (
              <button
                key={s.id}
                type="button"
                aria-current={isActive ? 'step' : undefined}
                aria-label={`${s.label}: ${s.title} · ${
                  isActive ? 'in corso' : isDone ? 'completato' : 'da completare'
                }`}
                onClick={() => setStage(s.id)}
                className={classNames(
                  styles.stageBtn,
                  isActive && styles.stageBtnActive,
                  isDone && styles.stageBtnDone,
                )}
              >
                <span className={styles.stageBtnLabel}>{s.label}</span>
                <span className={styles.stageBtnTitle}>{s.title}</span>
                {isDone && (
                  <span>
                    <PillBadge variant="green">
                      <Check size={11} /> completato
                    </PillBadge>
                  </span>
                )}
                {isActive && !isDone && (
                  <span>
                    <PillBadge variant="ink">in corso</PillBadge>
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop: 16 }}>
          <HandoffStageBody
            stage={stage}
            onStageChange={setStage}
            onAdvance={() => {
              const next = STAGE_ORDER[Math.min(STAGE_ORDER.length - 1, currentIndex + 1)];
              setStage(next);
            }}
          />
        </div>
      </section>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Azioni da completare sul portale ufficiale</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="coral">
              <AlertTriangle size={11} /> da ricordare
            </PillBadge>
          </span>
        </header>
        <p className={styles.panelSubtitle}>
          MediFlow prepara il passaggio e tiene traccia dell&apos;esito; le azioni
          certificate restano nei portali regionali o INPS.
        </p>
        <div className={styles.launcherGrid}>
          {BLOCKED_CAPS.map((c) => (
            <div key={c.id} className={classNames(styles.launcherTile, styles.launcherTileBlocked)}>
              <div className={styles.launcherTileHeader}>
                <AlertTriangle size={14} color="var(--lume-ink-muted)" />
                <span className={styles.evidenceTitle}>{c.label}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant="coral">solo portale ufficiale</PillBadge>
                </span>
              </div>
              <p className={styles.launcherTileBody}>{c.reason}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function HandoffStageBody({
  stage,
  onAdvance,
  onStageChange,
}: {
  stage: StageId;
  onAdvance: () => void;
  onStageChange: (stage: StageId) => void;
}) {
  if (stage === 'identity') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ShieldCheck size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Identità &amp; ruolo MMG</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="muted">TS-CNS · cookie ufficiale</PillBadge>
          </span>
        </header>
        <dl className={styles.stagePanelKv}>
          <dt>Operatore</dt>
          <dd>Operatore locale · medico di medicina generale</dd>
          <dt>Scope ruolo</dt>
          <dd>Ruolo MMG configurato · sessione regionale attiva</dd>
          <dt>Token</dt>
          <dd>verificato localmente · scadenza 47 min</dd>
        </dl>
        <div>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Verifica ruolo &amp; prosegui
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'consent') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <FileSignature size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Consenso assistito</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="green">consenso registrato</PillBadge>
          </span>
        </header>
        <dl className={styles.stagePanelKv}>
          <dt>Assistito</dt>
          <dd>Paziente selezionato dalla scheda · consenso richiesto prima dell&apos;apertura</dd>
          <dt>Scope consenso</dt>
          <dd>FSE consultazione · 90 giorni</dd>
          <dt>Audit locale</dt>
          <dd>evento <code>consent.granted</code> · timestamp 09:12</dd>
        </dl>
        <div style={{ display: 'inline-flex', gap: 8 }}>
          <button type="button" className={styles.ghostBtn} onClick={() => onStageChange('identity')}>
            Registra revoca e torna a identità
          </button>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Procedi al portale
            <ChevronRight size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (stage === 'handoff') {
    return (
      <div className={styles.stagePanel}>
        <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ArrowUpRight size={16} color="var(--ink-muted)" />
          <h3 className={styles.panelTitle}>Passaggio al portale ufficiale</h3>
          <span style={{ marginLeft: 'auto' }}>
            <PillBadge variant="blue">via portale SISS</PillBadge>
          </span>
        </header>
        <p className={styles.rowSub} style={{ margin: 0, lineHeight: 1.6 }}>
          MediFlow apre il portale ufficiale con il contesto del paziente già
          preparato. Dopo l&apos;azione sul portale, registra qui l&apos;esito e
          l&apos;eventuale riferimento riportato dall&apos;operatore.
        </p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className={styles.primaryBtn} onClick={onAdvance}>
            Apri FSE Viewer ufficiale
            <ArrowUpRight size={13} />
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onAdvance}>
            Apri Prescrittivo Regionale (PRREG)
            <ArrowUpRight size={13} />
          </button>
          <button type="button" className={styles.ghostBtn} onClick={onAdvance}>
            Registra esito al ritorno
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.stagePanel}>
      <header style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <Check size={16} color="var(--ink-muted)" />
        <h3 className={styles.panelTitle}>Esito registrato manualmente</h3>
        <span style={{ marginLeft: 'auto' }}>
          <PillBadge variant="yellow">esito registrato a mano</PillBadge>
        </span>
      </header>
      <div className={styles.outcomeCapsule}>
        <AlertTriangle size={14} color="var(--rail-yellow)" />
        <span className={styles.outcomeText}>
          <b>Il portale non rimanda una conferma automatica a MediFlow.</b>{' '}
          Numero di ricetta, NRE o altro riferimento vanno riportati qui a mano.
        </span>
      </div>
      <dl className={styles.stagePanelKv}>
        <dt>Riferimento interno</dt>
        <dd><code>hndoff-2026-05-15-7a3c</code></dd>
        <dt>Esito riportato</dt>
        <dd>Prescrizione emessa · NRE incollato manualmente</dd>
        <dt>Registro locale</dt>
        <dd>esito registrato sulla postazione</dd>
      </dl>
      <div style={{ display: 'inline-flex', gap: 8 }}>
        <Link href="/diary" className={styles.primaryBtn}>
          Annota esito sul diario
          <ChevronRight size={14} />
        </Link>
        <Link href="/settings/diagnostica" className={styles.ghostBtn}>
          Esporta registro
        </Link>
      </div>
    </div>
  );
}

export { HandoffArea };
