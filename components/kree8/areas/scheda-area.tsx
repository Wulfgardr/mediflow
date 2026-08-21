import {
  CalendarClock,
  Paperclip,
  Plus,
  Sparkles,
  UserSquare2,
} from 'lucide-react';

import type { AreaId } from '../cockpit-shared';
import type { Kree8Patient, Kree8PatientWorkspace } from '@/lib/patient-workspace';
import { PatientQuadro, RealPatientArea } from './real-patient-area';
import type { QuadroAction, QuadroDiagnosis, QuadroMetric, QuadroRow } from './real-patient-area';
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

const REVIEW_NEXT_ROWS: QuadroRow[] = [
  { title: 'Controllo cardiologico', value: '18/07', note: 'Finestra di follow-up clinico vicina.', signal: 'warning' },
  { title: 'Rinnovo esenzione 031', value: '27 gg', note: 'Azione amministrativa MMG.' },
  { title: 'Tinetti e MMSE', value: 'da rivedere', note: 'Scale nella finestra di rivalutazione.' },
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
            Apri un paziente dalla lista in carico per vedere stato e prossima azione.
          </p>
        </section>
      </div>
    );
  }

  const quietActions: QuadroAction[] = [
    { label: 'Nuova voce diario', icon: <Plus size={12} />, onClick: () => onOpenArea('diario') },
    { label: 'Allega documento', icon: <Paperclip size={12} />, onClick: () => onOpenArea('revisione') },
    { label: 'Pianifica visita', icon: <CalendarClock size={12} />, onClick: () => onOpenArea('turno') },
  ];

  return (
    <div className={styles.areaShell}>
      <PatientQuadro
        headingId="lume-quadro-review-title"
        caption="Quadro paziente · cronicità multipla"
        name="M. R."
        atoms={['AB-2026-014', '64 anni · M', 'Ambulatorio locale', 'aggiornato 08/05']}
        status="Cronicità multipla"
        diagnoses={REVIEW_DIAGNOSES}
        summary="Aderenza terapeutica buona negli ultimi 90 giorni. Vitali nell’ultima rilevazione entro la baseline del caso. Il follow-up cardiologico è vicino e la codifica dell’ultimo documento resta da confermare."
        metrics={REVIEW_METRICS}
        nextRows={REVIEW_NEXT_ROWS}
        nextEmpty="Nessun passaggio clinico aperto."
        primaryAction={{ label: 'Apri Scheda completa', icon: <UserSquare2 size={13} />, href: '/mockups/scheda' }}
        quietActions={quietActions}
      />
    </div>
  );
}

export { SchedaArea };
