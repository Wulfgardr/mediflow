import { TREATMENT_REASONING_UNAVAILABLE_LABEL, TREATMENT_REASONING_UNAVAILABLE_REASON } from '@/lib/ai-function-availability';

export default function TreatmentReasoningPanel(_props: { [key: string]: unknown }) {
    return <section aria-label="Revisione del trattamento" data-testid="treatment-reasoning-panel">
        <h2>Revisione del trattamento</h2>
        <p role="status">{TREATMENT_REASONING_UNAVAILABLE_LABEL}</p>
        <p>{TREATMENT_REASONING_UNAVAILABLE_REASON}</p>
    </section>;
}
