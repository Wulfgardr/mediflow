import { useState } from 'react';
import {
  AlertTriangle,
  Check,
  Edit3,
  FileSignature,
  Sparkles,
  X,
} from 'lucide-react';

import {
  PillBadge,
  classNames,
} from '../cockpit-shared';
import type { DocDecision, FieldKind } from '../cockpit-shared';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import documentStyles from '../kree8-clinical-cockpit-document-review.module.css';


const DOC_FIELDS: {
  id: string;
  label: string;
  value: string;
  kind: FieldKind;
  evidence: string;
  sourceHint: string;
  blockedReason?: string;
}[] = [
  {
    id: 'diagnosis',
    label: 'Diagnosi clinica',
    value: 'Ipertensione essenziale non specificata',
    kind: 'structured',
    evidence:
      '«Paziente con anamnesi positiva per ipertensione essenziale in trattamento con Ramipril 5 mg.» · pag. 1, paragrafo 2',
    sourceHint: 'confidence 0.91 · qwen3.5 locale',
  },
  {
    id: 'icd',
    label: 'Codifica ICD-10',
    value: 'I10',
    kind: 'structured',
    evidence: 'Mappata da diagnosi clinica · catalogo ICD-10 IT v2026.01 (locale).',
    sourceHint: 'mapping deterministico · nessun fetch remoto',
  },
  {
    id: 'drug',
    label: 'Farmaco prescritto',
    value: 'Ramipril 5 mg',
    kind: 'structured',
    evidence:
      '«…in trattamento con Ramipril 5 mg 1 cpr/die.» · pag. 1, paragrafo 2',
    sourceHint: 'risolto via AIFA · AIC 029402017',
  },
  {
    id: 'posology',
    label: 'Posologia',
    value: '1 cpr · 1 volta/die · per 90 giorni',
    kind: 'note',
    evidence:
      '«Si conferma prosecuzione terapia per 90 giorni.» · pag. 2, paragrafo 1',
    sourceHint: 'pattern verbale non strutturato · annotabile come nota',
  },
  {
    id: 'exemption',
    label: 'Esenzione applicabile',
    value: '031 · Ipertensione arteriosa',
    kind: 'note',
    evidence:
      '«Esenzione applicabile 031: previa verifica del medico curante.» · pag. 2, paragrafo 2',
    sourceHint: 'inferita · richiede conferma operatore',
  },
  {
    id: 'siss',
    label: 'Passaggio SISS',
    value: 'Da completare nel portale ufficiale',
    kind: 'blocked',
    evidence: '–',
    sourceHint: '',
    blockedReason:
      'Apri il portale ufficiale e registra qui l’esito riportato dal portale.',
  },
];

/* ───────────────────────── Revisione documenti ───────────────────────── */

/* @Codex */
function RevisioneArea() {
  const [decisions, setDecisions] = useState<Record<string, DocDecision>>(() =>
    Object.fromEntries(DOC_FIELDS.map((f) => [f.id, 'pending'])),
  );

  const reviewable = DOC_FIELDS.filter((f) => f.kind !== 'blocked');
  const elaborated = reviewable.filter((f) => decisions[f.id] !== 'pending').length;
  const total = reviewable.length;
  const canApply = elaborated === total;

  const structuredWrites = reviewable.filter(
    (f) => f.kind === 'structured' && decisions[f.id] === 'apply',
  ).length;
  const noteWrites = reviewable.filter(
    (f) =>
      (f.kind === 'note' && decisions[f.id] === 'note') ||
      (f.kind === 'structured' && decisions[f.id] === 'note'),
  ).length;
  const ignored = reviewable.filter((f) => decisions[f.id] === 'ignore').length;
  const blocked = DOC_FIELDS.filter((f) => f.kind === 'blocked').length;

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Revisione documento</p>
          <h1 className={styles.areaTitle}>
            Referto cardiologico <em>· document #DOC-2026-241</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Conferma cosa applicare alla scheda. Nessun aggiornamento automatico:
            ogni decisione resta nell&apos;audit locale.
          </p>
        </div>
        <div className={styles.headerActions}>
          <PillBadge variant={canApply ? 'success' : 'warning'}>
            {elaborated} / {total} rivisti
          </PillBadge>
          <button type="button" className={styles.ghostBtn}>
            <FileSignature size={13} />
            Salva come bozza
          </button>
          <button type="button" className={styles.primaryBtn} disabled={!canApply}>
            <Check size={14} />
            Porta nella scheda
          </button>
        </div>
      </header>

      <section className={styles.panel}>
        <header className={styles.panelHeader}>
          <h2 className={styles.panelTitle}>Estratti del documento</h2>
          <span className={styles.panelActions}>
            <PillBadge variant="plum">
              <Sparkles size={11} /> qwen3.5 · locale
            </PillBadge>
          </span>
        </header>
        <div className={documentStyles.docCounters}>
          <span className={documentStyles.docCounter}>
            <Check size={11} color="var(--lume-ink-muted)" />
            <b>{structuredWrites}</b> campi aggiornabili
          </span>
          <span className={documentStyles.docCounter}>
            <Edit3 size={11} color="var(--lume-ink-muted)" />
            <b>{noteWrites}</b> note da riconciliare
          </span>
          <span className={documentStyles.docCounter}>
            <X size={11} color="var(--ink-subtle)" />
            <b>{ignored}</b> ignorati
          </span>
          <span className={documentStyles.docCounter}>
            <AlertTriangle size={11} color="var(--lume-ink-muted)" />
            <b>{blocked}</b> solo portale ufficiale
          </span>
        </div>
      </section>

      <div className={documentStyles.docGrid}>
        <section className={documentStyles.docPreview}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <PillBadge variant="plum">Anteprima documentale</PillBadge>
            <span className={styles.rowSub}>2 pagine · 87% leggibile</span>
            <span style={{ marginLeft: 'auto' }}>
              <PillBadge variant="plum">PDF · 318 KB</PillBadge>
            </span>
          </header>
          <article className={documentStyles.docPaper}>
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <b>Referto cardiologico · sintetico</b>
              <span className={styles.evidenceDate}>esempio · nessun PHI</span>
            </header>
            <p style={{ margin: 0 }}>
              Paziente con anamnesi positiva per{' '}
              <span className={documentStyles.docHighlight}>ipertensione essenziale</span>{' '}
              in trattamento con{' '}
              <span className={documentStyles.docHighlight}>Ramipril 5 mg</span> 1 cpr/die.
              Holter delle 24h nella norma. Si conferma prosecuzione terapia per{' '}
              <span className={documentStyles.docHighlight}>90 giorni</span> e si raccomanda
              controllo a 6 mesi.
            </p>
            <p style={{ margin: 0 }}>
              Codifica suggerita <b>I10</b>. Esenzione applicabile <b>031</b>:
              previa verifica del medico curante.
            </p>
            <footer style={{ marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <PillBadge variant="neutral">pag 1 di 2</PillBadge>
              <PillBadge variant="critical">firma digitale assente</PillBadge>
            </footer>
          </article>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Campi suggeriti</h2>
            <span className={styles.panelActions}>
              <PillBadge variant="critical">5 estratti · 1 bloccato</PillBadge>
            </span>
          </header>
          <div>
            {DOC_FIELDS.map((f) => {
              const decision = decisions[f.id];
              const isBlocked = f.kind === 'blocked';
              const kindLabel =
                f.kind === 'structured'
                  ? 'campo aggiornabile'
                  : f.kind === 'note'
                    ? 'solo nota'
                    : 'solo portale ufficiale';
              return (
                <div key={f.id} className={documentStyles.fieldRow}>
                  <div className={documentStyles.fieldHead}>
                    <span>{f.label}</span>
                    <span className={documentStyles.fieldKind}>· {kindLabel}</span>
                    <span style={{ marginLeft: 'auto' }}>
                      {decision === 'apply' && (
                        <PillBadge variant="success" commitKey={`${f.id}-apply`}>
                          applicato
                        </PillBadge>
                      )}
                      {decision === 'note' && (
                        <PillBadge variant="neutral" commitKey={`${f.id}-note`}>
                          come nota
                        </PillBadge>
                      )}
                      {decision === 'ignore' && (
                        <PillBadge variant="neutral" commitKey={`${f.id}-ignore`}>
                          ignorato
                        </PillBadge>
                      )}
                      {decision === 'pending' && !isBlocked && (
                        <PillBadge variant="warning">da rivedere</PillBadge>
                      )}
                      {isBlocked && (
                        <PillBadge variant="critical">
                          <AlertTriangle size={11} /> bloccato
                        </PillBadge>
                      )}
                    </span>
                  </div>
                  {!isBlocked && <div className={documentStyles.fieldValue}>{f.value}</div>}
                  {!isBlocked && (
                    <div className={documentStyles.fieldEvidence}>{f.evidence}</div>
                  )}
                  {!isBlocked && <div className={styles.rowSub}>{f.sourceHint}</div>}
                  {isBlocked && (
                    <div className={documentStyles.fieldBlocked}>
                      <AlertTriangle size={12} />
                      {f.blockedReason}
                    </div>
                  )}
                  {!isBlocked && (
                    <div className={documentStyles.fieldActions}>
                      <button
                        type="button"
                        aria-pressed={decision === 'apply'}
                        className={classNames(
                          documentStyles.fieldBtn,
                          decision === 'apply' && documentStyles.fieldBtnActiveAccept,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'apply' }))}
                      >
                        <Check size={12} />
                        Applica
                      </button>
                      <button
                        type="button"
                        aria-pressed={decision === 'note'}
                        className={classNames(
                          documentStyles.fieldBtn,
                          decision === 'note' && documentStyles.fieldBtnActiveCorrect,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'note' }))}
                      >
                        <Edit3 size={12} />
                        Come nota
                      </button>
                      <button
                        type="button"
                        aria-pressed={decision === 'ignore'}
                        className={classNames(
                          documentStyles.fieldBtn,
                          decision === 'ignore' && documentStyles.fieldBtnActiveIgnore,
                        )}
                        onClick={() => setDecisions((p) => ({ ...p, [f.id]: 'ignore' }))}
                      >
                        <X size={12} />
                        Ignora
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

export { RevisioneArea };
