import { Disclosure } from '@/components/disclosure';
import { TREATMENT_REASONING_UNAVAILABLE_LABEL, TREATMENT_REASONING_UNAVAILABLE_REASON } from '@/lib/ai-function-availability';
import design from './treatment-reasoning.module.css';

/* Treatment Reasoning resta nel catalogo come non disponibile (ADR 0180): la sezione Proposte lo dice e non offre comandi. */
export default function TreatmentReasoningPanel(_props: { [key: string]: unknown }) {
    return (
        <Disclosure title="Proposte" headingLevel={3}>
            <section className={design.panel} data-testid="treatment-reasoning-panel" aria-label="Ragionamento terapeutico">
                <div className={design.notice}>
                    <p className={design.strong}>{TREATMENT_REASONING_UNAVAILABLE_LABEL}</p>
                    <p>{TREATMENT_REASONING_UNAVAILABLE_REASON}</p>
                </div>
            </section>
        </Disclosure>
    );
}
