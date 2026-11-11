/* ADR 0189: fedeltà dello stato delle decisioni nel Quadro paziente.
 * P1: le due frasi viste al collaudo a schermo 0.9.1, con le fonti esatte, passano per la
 * capacità host reale (secondo tentativo compreso). P3: casi scritti a mano che devono passare. */
import assert from 'node:assert/strict';
import test from 'node:test';

import { localProviderRegistry, type LocalProviderResolution } from '../registry';
import { routeHostResolvedCandidateCapability } from './candidate-router';
import type { ProviderLifecycleRead } from './provider-lifecycle-service';
import { createPatientInsightHostCapability } from './patient-insight-host-capability.ts';
import { claimFidelityFinding, proposalFidelityFindings } from './patient-insight-fidelity.ts';

const requestId = 'request.patient-insight.fidelity.0001';
const generatedAt = '2026-11-11T10:00:01.000Z';
const currentness = Object.freeze({
    selectionEpoch: 7, patientRevision: 2, projectionDigest: `sha256_${'a'.repeat(64)}`,
    capturedAt: '2026-11-11T10:00:00.000Z', verifiedAt: generatedAt,
});
const lifecycleRecord: Extract<ProviderLifecycleRead, { status: 'available' }>['record'] = Object.freeze({
    schemaVersion: 'mediflow.ai.provider-lifecycle-record.v1',
    lifecycle: Object.freeze({ schemaVersion: 'mediflow.ai.provider-lifecycle.v1', provider: 'ollama', credentialClass: 'local_model', status: 'available_unqualified' }),
    actorClass: 'host_service', actorRef: `actor_${'a'.repeat(32)}`, version: 1,
    hostTimestamp: '2026-11-11T09:59:00.000Z', receiptRef: `receipt_${'b'.repeat(32)}`,
});

/* Fonti esatte del collaudo (dati sintetici): S6 è la sesta fonte, come a schermo. */
const P1_SOURCE = 'Rivalutazione dopo visita cardiologica: PA 150/94 mmHg. Lieve edema perimalleolare serale. Da decidere: aumento ramipril a 10 mg e aggiunta di amlodipina 5 mg come suggerito.';
const P2_SOURCE = 'Nota: piede e retina: Ultimo fundus oculi oltre 2 anni fa: da prenotare.';
const P1_SENTENCE = 'Aumentare ramipril a 10 mg e aggiungere amlodipina come deciso [S6].';
const P2_SENTENCE = 'Fondo oculare scaduto da oltre 2 anni richiede prenotazione urgente [S6]';

function projection(event: string) {
    return Object.freeze({
        schemaVersion: 'mediflow.patient-insight.projection.v1' as const,
        clinicalFocus: 'Follow-up sintetico',
        activeConditions: Object.freeze(['Ipertensione arteriosa essenziale', 'Diabete mellito tipo 2']),
        currentTherapies: Object.freeze(['Ramipril 5 mg', 'Metformina 1000 mg']),
        recentClinicalEvents: Object.freeze([event]),
    });
}
function reply(nextStep: string): string {
    return JSON.stringify({
        schemaVersion: 'mediflow.ai.extract.v1', task: 'patient_insight',
        summary: 'Paziente in follow-up per ipertensione e diabete. [S2, S3]',
        data: { currentState: ['In terapia con ramipril e metformina. [S4, S5]'], alerts: [], nextSteps: [nextStep], gaps: [] },
    });
}
function resolution(chat: LocalProviderResolution['adapter']['chat']): LocalProviderResolution {
    const base = localProviderRegistry.resolve({ task: 'clinical', models: { clinical: 'synthetic-local-model' }, endpoint: 'http://127.0.0.1:11434', chatTimeoutMs: 1_000 });
    return { ...base, adapter: Object.freeze({
        id: base.adapter.id, kind: base.adapter.kind, capabilities: base.adapter.capabilities,
        getBaseUrl: () => base.adapter.getBaseUrl(), getModel: () => base.adapter.getModel(), chat, listModels: async () => [],
    }) };
}
async function preview(event: string, answers: readonly string[]) {
    let chats = 0;
    const binding = resolution(async () => {
        const content = answers[Math.min(chats, answers.length - 1)]; chats += 1;
        return { content, stats: { latency: 1, tokensIn: 2, tokensOut: 3 } };
    });
    const capability = createPatientInsightHostCapability({
        killSwitch: { read: async () => ({ status: 'enabled' as const }) },
        currentness: { verify: () => true },
        lifecycle: { read: () => ({ status: 'available' as const, record: lifecycleRecord }) },
        binding: { readClinical: async () => ({ status: 'available' as const, resolution: binding }) },
        readiness: { observeClinical: async () => ({ status: 'available' as const, code: null, observation: Object.freeze({ venue: 'local_process' as const, state: 'available' as const, reason: null }) }) },
        route: routeHostResolvedCandidateCapability,
        sources: { clock: () => generatedAt, entropy: () => new Uint8Array(16).fill(7) },
    });
    const result = await capability.preview({ requestId, projection: projection(event), currentness });
    return { result, chats };
}

for (const [name, source, sentence] of [
    ['«come deciso» su una fonte «Da decidere»', P1_SOURCE, P1_SENTENCE],
    ['«urgente» su una fonte «da prenotare» senza urgenza', P2_SOURCE, P2_SENTENCE],
] as const) {
    test(`P1 ${name}: nessuna proposta, codice proposal_unfaithful dopo due tentativi`, async () => {
        const { result, chats } = await preview(source, [reply(sentence)]);
        assert.equal(result.status, 'failed');
        assert.equal(result.code, 'proposal_unfaithful');
        assert.equal(result.proposal, null);
        assert.equal(chats, 2);
    });
    test(`P1 ${name}: se il secondo tentativo è fedele, si pubblica solo quello`, async () => {
        const faithful = 'Valutare aumento ramipril a 10 mg e prenotare il fondo oculare. [S6]';
        const { result, chats } = await preview(source, [reply(sentence), reply(faithful)]);
        assert.equal(result.status, 'available');
        if (result.status !== 'available') return;
        assert.deepEqual(result.proposal.nextSteps, [faithful]);
        assert.equal(chats, 2);
    });
}

test('P1 la stessa frase su una fonte che dice già deciso e urgente è pubblicata', async () => {
    const { result, chats } = await preview('Visita cardiologica: deciso aumento ramipril a 10 mg. Fondo oculare urgente.',
        [reply('Aumentare ramipril a 10 mg come deciso, prenotazione urgente del fondo oculare [S6].')]);
    assert.equal(result.status, 'available');
    assert.equal(chats, 1);
});

test('lo scarto per citazioni resta proposal_invalid anche se il primo tentativo era infedele', async () => {
    const { result } = await preview(P1_SOURCE, [reply(P1_SENTENCE), reply('Frase senza citazione.')]);
    assert.equal(result.status, 'failed');
    assert.equal(result.code, 'proposal_invalid');
});

test('P3 fonte «deciso aumento ramipril», frase «aumentato ramipril come deciso»: passa', () => {
    assert.equal(claimFidelityFinding('Aumentato ramipril come deciso [S1].', ['Deciso aumento ramipril a 10 mg.']), null);
});

test('P3 fonte «urgente», frase «urgente»: passa', () => {
    assert.equal(claimFidelityFinding('Prenotazione urgente del fondo oculare [S1].', ['Fondo oculare: prenotazione urgente.']), null);
    assert.equal(claimFidelityFinding('Richiede valutazione con urgenza [S1].', ['Visita urgente richiesta dal cardiologo.']), null);
});

test('P3 le negazioni non creano falsi positivi', () => {
    assert.equal(claimFidelityFinding('Controllo non urgente del fondo oculare [S1].', ['Fondo oculare da prenotare.']), null);
    assert.equal(claimFidelityFinding('Nessuna urgenza clinica [S1].', ['Controllo di routine.']), null);
    assert.equal(claimFidelityFinding('Aumento del ramipril non ancora deciso [S1].', ['Da decidere: aumento ramipril.']), null);
    assert.equal(claimFidelityFinding('Amlodipina non è stata avviata [S1].', ['In attesa di visita: proposta amlodipina.']), null);
    // Una negazione nella fonte non autorizza l'urgenza nella frase.
    assert.equal(claimFidelityFinding('Controllo urgente [S1].', ['Controllo non urgente.'])?.rule, 'urgency');
    // La negazione vale solo nella sua proposizione.
    assert.equal(claimFidelityFinding('PA non controllata, terapia intensificata [S1].', ['Da decidere: aumento ramipril.'])?.rule, 'decision_state');
});

test('P3 un fatto concluso nella stessa fonte di una decisione aperta passa', () => {
    assert.equal(claimFidelityFinding('Metformina avviata [S1].', ['Avviata metformina 500 mg. Da rivalutare fra 3 mesi.']), null);
    assert.equal(claimFidelityFinding('Metformina in corso, controllo da programmare [S1].', ['Terapia corrente: metformina. Controllo da programmare.']), null);
});

test('le frasi senza fonte con marcatore aperto e le fonti non citate non contano', () => {
    const sources = ['Da decidere: aumento ramipril.', 'Ramipril aumentato a 10 mg, deciso in visita.'];
    assert.deepEqual(proposalFidelityFindings(['Aumento ramipril deciso in visita [S2].'], sources), []);
    assert.equal(proposalFidelityFindings(['Aumento ramipril come deciso [S1].'], sources).length, 1);
    assert.equal(proposalFidelityFindings(['Esami urgenti mancanti [DATI-INCOMPLETI].'], sources)[0]?.finding.rule, 'urgency');
});

test('accenti, maiuscole e apostrofi tipografici non cambiano l’esito', () => {
    assert.equal(claimFidelityFinding('È STATO DECISO l’aumento [S1].', ['DA DECIDERE: aumento.'])?.rule, 'decision_state');
    assert.equal(claimFidelityFinding('Non è urgente [S1].', ['Fondo oculare da prenotare.']), null);
});
