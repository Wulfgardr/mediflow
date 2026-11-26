import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENT_DOSAGE_NOT_STATED, agentReviewDisplayValue, agentReviewDocumentLabel, agentReviewShownFields } from './agent-visit-review-labels';
import { reviewAgentFact } from './agent-visit-facts';

const hash = 'a'.repeat(64) + '.pdf';

test('a proposal reads in the words of the chart: dates as day/month/year, a file hash as the document date, no internal fields', () => {
    assert.equal(agentReviewDisplayValue('startDate', '2026-11-23'), '23/11/2026');
    assert.equal(agentReviewDisplayValue('observedAt', '2026-11-23T08:00:00.000Z'), '23/11/2026');
    assert.equal(agentReviewDisplayValue('status', 'active'), 'In corso');
    assert.equal(agentReviewDisplayValue('dosage', AGENT_DOSAGE_NOT_STATED), 'Non indicata nel documento');
    assert.equal(agentReviewDocumentLabel(hash, '2026-11-23'), 'Documento del 23/11/2026');
    assert.equal(agentReviewDocumentLabel(hash, null), 'Documento della visita');
    assert.equal(agentReviewDocumentLabel('nota-visita.pdf', null), 'Nota della visita');
    assert.equal(agentReviewDocumentLabel('referto-sintetico.pdf', '2026-11-23'), 'referto-sintetico.pdf');
    assert.deepEqual(agentReviewShownFields('therapy', { drugName: 'Farmaco', dosage: 'x', status: '', subject: 'paziente', temporality: 'oggi', contextReview: '1' }),
        [['drugName', 'Farmaco'], ['dosage', 'x']]);
});

test('a blocked visit proposal tells the physician what to do and never names an internal field', () => {
    const quote = 'Esame Emoglobina valore non riportato';
    const reviewed = reviewAgentFact('observation', { display: 'Emoglobina', unit: 'g/dL', value: '' }, 'Paziente\n' + quote, quote);
    assert.ok(reviewed);
    const messages = reviewed.blockers.join(' | ');
    assert.match(messages, /Manca «Valore»: correggi la voce o scartala\./u);
    assert.doesNotMatch(messages, /\b(?:value|unitCode|observedAt|status|Campo obbligatorio)\b/u);
    const service = reviewAgentFact('service_prescription', { serviceName: 'visita pneumologica', prescribedAt: '2026-13-40' }, 'Prescritta visita pneumologica di controllo.', 'Prescritta visita pneumologica di controllo.');
    assert.ok(service);
    assert.match(service.blockers.join(' | '), /Data «Prescritta il» non valida: scarta la voce e inseriscila dalla scheda\./u);
});
