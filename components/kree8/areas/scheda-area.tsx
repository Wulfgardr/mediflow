import { useState } from 'react';
import {
  CalendarClock,
  ChevronRight,
  FileSignature,
  FileText,
  ListChecks,
  Paperclip,
  Pill as PillIcon,
  Plus,
  ShieldCheck,
  Sparkles,
  Workflow,
} from 'lucide-react';

import {
  DiagnosisPill,
  PillBadge,
  classNames,
} from '../cockpit-shared';
import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import { RealPatientArea } from './real-patient-area';
import styles from '../kree8-clinical-cockpit.module.css';


const PATIENT_AI_SUMMARY = (
  <>
    Paziente <b>M. R.</b>, 64 anni, profilo a cronicità multipla
    (<b>ipertensione</b>, <b>dislipidemia</b>, <b>BPCO lieve</b>). Aderenza
    terapeutica buona negli ultimi 90 giorni; vitali nella norma all&apos;ultima
    rilevazione. <b>Possibile rinforzo</b> sul follow-up cardiologico previsto
    a 6 mesi. <b>Manca codifica ICD</b> su ultimo documento allegato; codice
    suggerito <b>I10</b>.
  </>
);

const PATIENT_SOURCES = [
  { date: '08 mag 2026', text: 'Diario · controllo pressorio domiciliare 130/82 mmHg, paziente asintomatico.' },
  { date: '02 mag 2026', text: 'Documento · referto cardiologico Cardiologia ASL · esame Holter nella norma.' },
  { date: '21 apr 2026', text: 'Terapia · rinnovo Ramipril 5 mg · piano 90 giorni.' },
  { date: '04 apr 2026', text: 'Visita · obiettività cardiopolmonare nei limiti. Programmato follow-up.' },
];

function SchedaArea({
  patient,
  workspace,
  isReview,
  onOpenArea,
}: {
  patient?: Kree8Patient | null;
  workspace?: Kree8PatientWorkspace | null;
  isReview: boolean;
  onOpenArea: (area: AreaId) => void;
}) {
  const [view, setView] = useState<'ai' | 'source'>('ai');

  if (!isReview && patient) {
    return <RealPatientArea patient={patient} workspace={workspace} onOpenArea={onOpenArea} />;
  }

  if (!isReview && !patient) {
    return (
      <div className={styles.areaShell}>
        <header className={styles.areaHeader}>
          <div>
            <p className={styles.areaCaption}>Quadro paziente</p>
            <h1 className={styles.areaTitle}>
              Nessun paziente selezionato <em>· quadro in attesa</em>
            </h1>
            <p className={styles.areaSubtitle}>
              Apri un paziente dalla lista in carico per vedere sintesi,
              azioni, documenti e follow-up del caso.
            </p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className={styles.areaShell}>
      <header className={styles.areaHeader}>
        <div>
          <p className={styles.areaCaption}>Quadro paziente · cronicità multipla</p>
          <h1 className={styles.areaTitle}>
            M. R. <em>· 64 · M · caso dimostrativo AB-2026-014</em>
          </h1>
          <p className={styles.areaSubtitle}>
            Profilo aggiornato il 08 mag · ultimo documento 02 mag · ultima
            sincronizzazione Mac principale 5 min fa.
          </p>
        </div>
        <div className={styles.headerActions}>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('diario')}>
            <Plus size={12} /> Nuova voce diario
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('revisione')}>
            <Paperclip size={12} /> Allega documento
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('turno')}>
            <CalendarClock size={12} /> Pianifica visita
          </button>
          <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('revisione')}>
            <Sparkles size={12} /> Smart Import
          </button>
          <button type="button" className={styles.primaryBtn} onClick={() => onOpenArea('handoff')}>
            <Workflow size={13} /> Prepara SISS
          </button>
        </div>
      </header>

      <section className={styles.panel}>
        <div className={styles.identityDock}>
          {/* @Codex */}
          <ul className={styles.identityChips} aria-label="Diagnosi e stato del paziente">
            <li className={styles.patientDiagnosisPill}><DiagnosisPill diagnosis="Ipertensione" /></li>
            <li className={styles.patientDiagnosisPill}><DiagnosisPill diagnosis="Dislipidemia" /></li>
            <li className={styles.patientDiagnosisPill}><DiagnosisPill diagnosis="BPCO lieve" /></li>
            <li><PillBadge variant="neutral">PA 132/84</PillBadge></li>
            <li><PillBadge variant="neutral">HR 76</PillBadge></li>
            <li><PillBadge variant="neutral">SpO₂ 97%</PillBadge></li>
          </ul>
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6 }}>
            <PillBadge variant="success">
              <Sparkles size={11} />
              MediFlow Insight
            </PillBadge>
            <PillBadge variant="plum">
              <ShieldCheck size={11} />
              Contesto SISS pronto
            </PillBadge>
            <PillBadge variant="plum">Protesica-RL · monitorato</PillBadge>
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14 }}>
          <h2 className={styles.panelTitle}>Sintesi clinica</h2>
          <span style={{ marginLeft: 'auto' }}>
            <div className={styles.segmented} role="tablist" aria-label="Vista sintesi paziente">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'ai'}
                className={classNames(styles.segItem, view === 'ai' && styles.segSelected)}
                onClick={() => setView('ai')}
              >
                Riepilogo clinico (AI)
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'source'}
                className={classNames(styles.segItem, view === 'source' && styles.segSelected)}
                onClick={() => setView('source')}
              >
                Documenti originali
              </button>
            </div>
          </span>
        </div>

        <div className={styles.insightBody}>
          {view === 'ai' ? (
            <p style={{ margin: 0 }}>{PATIENT_AI_SUMMARY}</p>
          ) : (
            <div>
              {PATIENT_SOURCES.map((s) => (
                <div key={s.date + s.text} className={styles.sourceItem}>
                  <span className={styles.sourceDate}>{s.date}</span>
                  <span>{s.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Timeline del caso</h2>
            <PillBadge variant="neutral">12 voci</PillBadge>
            <span className={styles.panelActions}>
              <button type="button" className={styles.ghostBtnSm} onClick={() => onOpenArea('diario')}>
                <Plus size={12} /> Nuova voce
              </button>
            </span>
          </header>
          <div>
            {[
              { time: '08 mag', text: 'Controllo pressorio domiciliare 130/82', tag: 'Diario', variant: 'plum' as const },
              { time: '02 mag', text: 'Referto Holter (24h) nella norma', tag: 'Documento', variant: 'plum' as const },
              { time: '21 apr', text: 'Rinnovo Ramipril 5 mg · 90 giorni', tag: 'Terapia', variant: 'plum' as const },
              { time: '04 apr', text: 'Visita ambulatoriale · obiettività nella norma', tag: 'Visita', variant: 'plum' as const },
            ].map((row) => (
              <div key={row.time + row.text} className={styles.row}>
                <span className={styles.rowTime}>{row.time}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowTitle}>{row.text}</span>
                </span>
                <span className={styles.rowEnd}>
                  <PillBadge variant={row.variant}>{row.tag}</PillBadge>
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.panelInset}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Terapia attiva</h2>
            <PillBadge variant="neutral">3 prescrizioni</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>
            1 piano terapeutico AIFA · prossimo rinnovo tra 27 giorni.
          </p>
          {[
            { drug: 'Ramipril', dose: '5 mg · 1 cpr/die', tag: 'Cronicità', variant: 'neutral' as const },
            { drug: 'Atorvastatina', dose: '20 mg · 1 cpr/sera', tag: 'PT AIFA', variant: 'plum' as const },
            { drug: 'Salbutamolo', dose: 'al bisogno', tag: 'Al bisogno', variant: 'neutral' as const },
          ].map((row) => (
            <div key={row.drug} className={styles.compositeCard} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <PillIcon size={14} color="var(--ink-muted)" />
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                  {row.drug}
                </span>
                <span className={styles.rowSub}>{row.dose}</span>
                <span style={{ marginLeft: 'auto' }}>
                  <PillBadge variant={row.variant}>{row.tag}</PillBadge>
                </span>
              </div>
            </div>
          ))}
        </section>
      </div>

      <div className={styles.threeCol}>
        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Evidenze recenti</h2>
            <PillBadge variant="neutral">5 fonti</PillBadge>
          </header>
          <p className={styles.panelSubtitle}>Referti, note ed evidenze recenti citabili.</p>
          {[
            {
              date: '02 mag',
              title: 'Referto cardiologico ASL',
              snippet: '«Holter 24h nella norma. Si conferma terapia per 90 giorni.»',
              tag: 'Documento',
              variant: 'plum' as const,
            },
            {
              date: '21 apr',
              title: 'Nota diario · pressione domiciliare',
              snippet: 'Serie 7 giorni: media 128/80 · variabilità contenuta.',
              tag: 'Diario',
              variant: 'plum' as const,
            },
            {
              date: '04 apr',
              title: 'Visita ambulatoriale',
              snippet: 'Obiettività cardiopolmonare nei limiti · suggerito follow-up 6 mesi.',
              tag: 'Visita',
              variant: 'plum' as const,
            },
          ].map((e) => (
            <div key={e.title} className={styles.evidenceItem}>
              <span className={styles.evidenceDate}>{e.date}</span>
              <span>
                <span className={styles.evidenceTitle}>{e.title}</span>
                <span className={styles.evidenceSnippet}>{e.snippet}</span>
              </span>
              <PillBadge variant={e.variant}>{e.tag}</PillBadge>
            </div>
          ))}
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Smart Import</h2>
            <PillBadge variant="plum">
              <Sparkles size={11} /> qwen3.5
            </PillBadge>
          </header>
          <p className={styles.panelSubtitle}>
            Documento in coda · estratti rivedibili prima di portarli nella scheda.
          </p>
          <div className={styles.compositeCard}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <FileText size={14} color="var(--ink-muted)" />
              <span className={styles.evidenceTitle}>Referto cardiologico · DOC-2026-241</span>
            </header>
            <span className={styles.rowSub}>3 campi aggiornabili · 2 note da riconciliare · 1 bloccato</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <PillBadge variant="success">farmaco riconosciuto AIFA</PillBadge>
              <PillBadge variant="success">diagnosi codificata ICD</PillBadge>
              <PillBadge variant="neutral">posologia incerta</PillBadge>
              <PillBadge variant="critical">SISS bloccato</PillBadge>
            </div>
            <button type="button" className={styles.ghostBtnSm} style={{ alignSelf: 'flex-start' }} onClick={() => onOpenArea('revisione')}>
              Apri documenti
              <ChevronRight size={13} />
            </button>
          </div>
        </section>

        <section className={styles.panel}>
          <header className={styles.panelHeader}>
            <h2 className={styles.panelTitle}>Prossimi passaggi</h2>
            <PillBadge variant="neutral">3 attività</PillBadge>
          </header>
          {[
            {
              icon: <CalendarClock size={14} />,
              title: 'Controllo cardiologico',
              sub: 'pianificato per 18 lug · 6 mesi dall’ultima visita',
              tag: 'Follow-up',
              variant: 'neutral' as const,
            },
            {
              icon: <FileSignature size={14} />,
              title: 'Rinnovo esenzione 031',
              sub: 'scadenza tra 27 giorni · azione MMG',
              tag: 'Attenzione',
              variant: 'warning' as const,
            },
            {
              icon: <ListChecks size={14} />,
              title: 'Scale e misure',
              sub: 'Tinetti · MMSE in finestra di rivalutazione',
              tag: 'Scales',
              variant: 'neutral' as const,
            },
          ].map((row) => (
            <div key={row.title} className={styles.plannedItem}>
              <span className={styles.plannedIcon}>{row.icon}</span>
              <span>
                <span className={styles.plannedTitle}>{row.title}</span>
                <br />
                <span className={styles.plannedSub}>{row.sub}</span>
              </span>
              <PillBadge variant={row.variant}>{row.tag}</PillBadge>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}

export { SchedaArea };
