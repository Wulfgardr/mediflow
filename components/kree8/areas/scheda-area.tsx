import {
  CalendarClock,
  FileSignature,
  FileText,
  ListChecks,
  Paperclip,
  Plus,
  Sparkles,
  Workflow,
} from 'lucide-react';

import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import { PatientQuadro, RealPatientArea } from './real-patient-area';
import type { QuadroAction, QuadroDiagnosis, QuadroMetric, QuadroRow, QuadroTherapy } from './real-patient-area';
import styles from '../kree8-clinical-cockpit-foundation.module.css';
import patientStyles from '../kree8-clinical-cockpit-patient-inbox.module.css';

/* @Codex #98, #68 */
const REVIEW_DIAGNOSES: QuadroDiagnosis[] = [
  { code: 'I10', description: 'Ipertensione essenziale' },
  { code: 'E78.5', description: 'Dislipidemia' },
  { code: 'J44.9', description: 'BPCO lieve' },
];

const REVIEW_METRICS: QuadroMetric[] = [
  { label: 'Pressione', value: '132/84', note: 'mmHg · 08 mag' },
  { label: 'Saturazione', value: '97%', note: 'SpO₂ · 08 mag' },
  { label: 'Terapie attive', value: 3, note: '1 piano AIFA' },
  {
    label: 'Controllo cardiologico',
    value: '18/07',
    note: 'Finestra clinica vicina',
    signal: 'warning',
  },
];

const REVIEW_THERAPIES: QuadroTherapy[] = [
  { name: 'Ramipril', dose: '5 mg · 1 cpr/die' },
  { name: 'Atorvastatina', dose: '20 mg · 1 cpr/sera' },
  { name: 'Salbutamolo', dose: 'al bisogno' },
];

const REVIEW_NEXT_ROWS: QuadroRow[] = [
  { title: 'Controllo cardiologico', value: '18/07', note: 'Finestra di follow-up clinico vicina.', signal: 'warning' },
  { title: 'Rinnovo esenzione 031', value: '27 gg', note: 'Azione amministrativa MMG.' },
  { title: 'Tinetti e MMSE', value: 'da rivedere', note: 'Scale nella finestra di rivalutazione.' },
];

const REVIEW_DOCUMENT_ROWS: QuadroRow[] = [
  { title: 'Referto cardiologico ASL', value: '02/05', note: 'Holter 24h nella norma, fonte sintetica.' },
  { title: 'Codifica I10', value: 'da confermare', note: 'Revisione documentale richiesta prima di applicare.' },
  { title: 'Posologia estratta', value: 'incerta', note: 'Il dato resta sospeso e non viene applicato.' },
];

function SchedaArea({
  patient,
  workspace,
  isReview,
  onOpenArea,
}: { patient?: Kree8Patient | null; workspace?: Kree8PatientWorkspace | null; isReview: boolean; onOpenArea: (area: AreaId) => void }) {
  if (!isReview && patient) {
    return <RealPatientArea patient={patient} workspace={workspace} onOpenArea={onOpenArea} />;
  }

  if (!isReview && !patient) {
    return (
      <div className={styles.areaShell}>
        <section
          className={patientStyles.quadroFocal}
          aria-labelledby="lume-quadro-empty-title"
          data-testid="lume-quadro"
        >
          <header className={patientStyles.quadroHeader}>
            <div className={patientStyles.quadroHeading}>
              <p className={patientStyles.quadroCaption}>Quadro paziente</p>
              <h1 id="lume-quadro-empty-title" className={patientStyles.quadroName}>
                Nessun paziente selezionato
              </h1>
              <p className={patientStyles.quadroAtoms}>Il quadro è in attesa di un contesto paziente.</p>
            </div>
          </header>
          <p className={patientStyles.quadroEmpty}>
            Apri un paziente dalla lista in carico per vedere sintesi, azioni,
            documenti e follow-up del caso.
          </p>
        </section>
      </div>
    );
  }

  const quietActions: QuadroAction[] = [
    { label: 'Nuova voce diario', icon: <Plus size={12} />, onClick: () => onOpenArea('diario') },
    { label: 'Allega documento', icon: <Paperclip size={12} />, onClick: () => onOpenArea('revisione') },
    { label: 'Pianifica visita', icon: <CalendarClock size={12} />, onClick: () => onOpenArea('turno') },
    { label: 'Smart Import', icon: <Sparkles size={12} />, onClick: () => onOpenArea('revisione') },
    { label: 'Apri documenti', icon: <FileText size={12} />, onClick: () => onOpenArea('revisione') },
    { label: 'Scale cliniche', icon: <ListChecks size={12} />, onClick: () => onOpenArea('scheda') },
    { label: 'Firma e handoff', icon: <FileSignature size={12} />, onClick: () => onOpenArea('handoff') },
  ];

  return (
    <div className={styles.areaShell}>
      <PatientQuadro
        headingId="lume-quadro-review-title"
        caption="Quadro paziente · cronicità multipla"
        name="M. R."
        atoms={[{ value: 'AB-2026-014', register: true }, { value: '64 anni · M', register: true }, { value: 'Ambulatorio locale' }, { value: 'aggiornato 08/05', register: true }]}
        status="Cronicità multipla"
        diagnoses={REVIEW_DIAGNOSES}
        summary="Aderenza terapeutica buona negli ultimi 90 giorni. Vitali nell’ultima rilevazione entro la baseline del caso. Il follow-up cardiologico è vicino e la codifica dell’ultimo documento resta da confermare."
        metrics={REVIEW_METRICS}
        therapies={REVIEW_THERAPIES}
        therapiesEmpty="Nessuna terapia attiva registrata."
        nextRows={REVIEW_NEXT_ROWS}
        nextEmpty="Nessun passaggio clinico aperto."
        documentRows={REVIEW_DOCUMENT_ROWS}
        documentsEmpty="Nessun documento o codice sospeso."
        primaryAction={{ label: 'Prepara SISS', icon: <Workflow size={13} />, onClick: () => onOpenArea('handoff') }}
        quietActions={quietActions}
      />
    </div>
  );
}

export { SchedaArea };
