import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import lexicon from '../../../native/contracts/clinical-context-lexicon.json' with { type: 'json' };
import { clinicalFactContext, contextReview } from './clinical-context-lexicon.ts';
import { dossierFactBlockers, extractDossierCandidates, splitDossierUnits } from './dossier-import.ts';
import { preparedDossierFacts, preparedFactEligible, type PreparedFactInput } from './dossier-prepared.ts';
import { qualifiersOf } from './dossier-sections.ts';

const date = '2026-10-20';
const now = new Date('2026-11-01T12:00:00Z');
const fileName = 'visita-sintetica.txt';
const exemptionCodes = new Set(['013']);
const candidates: Array<{ heading: string; proposal: PreparedFactInput & { quote: string } }> = [
    { heading: 'Terapia', proposal: { kind: 'therapy', quote: 'Ramipril 5 mg al mattino', values: { drugName: 'Ramipril', dosage: '5 mg', status: 'active' } } },
    { heading: 'Diagnosi', proposal: { kind: 'diagnosis', quote: 'ICD-10 I10 ipertensione arteriosa', values: { code: 'I10', description: 'ipertensione arteriosa' } } },
    { heading: 'Esami', proposal: { kind: 'observation', quote: 'Creatinina 0,9 mg/dL', values: { display: 'Creatinina', value: '0,9', unit: 'mg/dL' } } },
    { heading: 'Esenzione', proposal: { kind: 'exemption', quote: '013 per patologia cronica', values: { code: '013' } } },
];
const positions = ['before', 'inside', 'after', 'heading'] as const;
type Position = typeof positions[number];

function bodyOf(heading: string, proposal: typeof candidates[number]['proposal'], position: Position, cue: string) {
    const { kind, quote } = proposal;
    if (kind === 'observation') {
        const row = quote + ' 0,7-1,2';
        switch (position) {
            case 'before': return `${cue} ${row}`;
            case 'inside': return row.replace(' 0,9', ` ${cue} 0,9`);
            case 'after': return `${row} ALT ${cue} 30 U/L 0-33`;
            case 'heading': return `${heading} ${cue}:\n${row}`;
        }
    }
    if (position === 'heading') return `${heading} ${cue}:\n${quote}`;
    const line = position === 'after' ? `${quote}, ${cue}` : position === 'inside' ? `si riporta, ${cue}, ${quote}` : `${cue} ${quote}`;
    return `${heading}: ${line}`;
}

function documentInput(body: string) {
    const text = 'Nivora Sintelva\nData visita: 20/10/2026\n' + body;
    return { text, fileName, documentDate: date, units: splitDossierUnits(text, null).units, exemptionCodes };
}

function prepared(body: string, proposal: typeof candidates[number]['proposal']) {
    const input = documentInput(body);
    const source = {
        sha256: createHash('sha256').update(input.text).digest('hex'), fileName, documentDate: date,
        patient: null, documentType: 'visita', summary: null, facts: [proposal],
        coverage: { pages: 1, unreadablePages: [], complete: true, note: '' },
    };
    const [fact] = preparedDossierFacts({ ...input, source, parserFacts: [], now }).facts;
    assert.ok(fact?.evidence);
    assert.equal(fact.evidence.excerpt, proposal.quote.replace(/\s+/gu, ' '));
    return fact;
}

function parserFacts(body: string, proposal: typeof candidates[number]['proposal']) {
    const facts = extractDossierCandidates(documentInput(body)).facts;
    return facts.filter(fact => fact.kind === proposal.kind
        && (proposal.kind === 'observation' ? fact.values.display.includes(proposal.values.display)
            : proposal.kind === 'diagnosis' || proposal.kind === 'exemption' ? fact.values.code === proposal.values.code
                : fact.values.drugName.includes(proposal.values.drugName)));
}

function parserEligible(fact: ReturnType<typeof parserFacts>[number]) {
    const values = { ...fact.values };
    if (fact.kind === 'therapy') values.startDate ||= date;
    if (fact.kind === 'observation') {
        values.code ||= '2160-0';
        values.unitCode ||= 'mg/dL';
    }
    return dossierFactBlockers({ ...fact, values }, { exemptionCodes }).length === 0;
}

test('le radici del JSON proteggono terapia, diagnosi, esame ed esenzione nei tre percorsi', () => {
    let seed = 0x8582026;
    const random = () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed;
    };
    const categories = ['negation', 'suspension', 'family'] as const;
    let attempted = 0;
    let parserChecked = 0;
    for (const category of categories) {
        for (const entry of lexicon[category]) {
            const forms = entry.includes('*') ? ['o', 'emmo', 'olastro'].map(ending => entry.replaceAll('*', ending)) : [entry, entry.replaceAll(' ', '  ')];
            for (const form of forms) {
                const cue = random() % 2 ? form : form.toUpperCase();
                for (const position of positions) {
                    for (const { heading, proposal } of candidates) {
                        const body = bodyOf(heading, proposal, position, cue);
                        const label = `${category}/${entry}/${position}/${proposal.kind}: ${body}`;
                        const quote = position === 'inside' && proposal.kind === 'observation'
                            ? proposal.quote.replace(' 0,9', ` ${cue} 0,9`) : proposal.quote;
                        const candidate = { ...proposal, quote };
                        const start = body.indexOf(quote);
                        const context = clinicalFactContext(proposal.kind, proposal.values, body, start, start + quote.length);
                        assert.ok(contextReview(context).split(',').includes(category), label);
                        if (proposal.kind === 'therapy' || proposal.kind === 'diagnosis') {
                            const q = qualifiersOf(quote, proposal.kind === 'therapy' ? 'medication' : 'diagnosis', heading, context);
                            assert.ok(q.contextReview.split(',').includes(category), label);
                        }
                        assert.equal(preparedFactEligible(prepared(body, candidate), exemptionCodes), false, label);
                        const parsed = parserFacts(body, proposal);
                        if (!parsed.length) {
                            const sourceFacts = extractDossierCandidates(documentInput(body)).facts;
                            assert.ok(proposal.kind === 'diagnosis' && category === 'family'
                                && sourceFacts.some(fact => fact.kind === 'anamnesis' && fact.origin === 'parser:icd'), label);
                        }
                        for (const fact of parsed) {
                            assert.equal(parserEligible(fact), false, label);
                            assert.ok(fact.values.contextReview?.split(',').includes(category), label);
                            parserChecked += 1;
                        }
                        if (proposal.kind === 'therapy' && category === 'suspension') {
                            for (const status of ['suspended', 'completed']) {
                                const fact = prepared(body, { ...proposal, values: { ...proposal.values, status } });
                                assert.equal(fact.values.status, status, label);
                                assert.equal(preparedFactEligible(fact, exemptionCodes), true, label);
                                assert.equal(parserEligible({ ...fact, values: { ...fact.values, status: 'active' } }), false, label);
                            }
                        }
                        attempted += 1;
                    }
                }
            }
        }
    }
    assert.ok(attempted >= 3000);
    assert.ok(parserChecked >= 3000);
    for (const { heading, proposal } of candidates) {
        const row = proposal.kind === 'observation' ? proposal.quote + ' 0,7-1,2' : proposal.quote;
        for (const previous of ['', 'Non riferisce sintomi.\n']) {
            const body = `${previous}${heading}:\n${row}`;
            assert.equal(preparedFactEligible(prepared(body, proposal), exemptionCodes), true, body);
            assert.ok(parserFacts(body, proposal).some(parserEligible), body);
        }
    }
    const therapy = candidates[0].proposal;
    for (const heading of lexicon.suspensionHeadings) {
        const body = `${heading}:\n${therapy.quote}`;
        const [fact] = parserFacts(body, therapy);
        assert.equal(fact?.values.status, 'suspended', body);
        assert.equal(parserEligible(fact), true, body);
        assert.equal(parserEligible({ ...fact, values: { ...fact.values, status: 'active' } }), false, body);
    }
});

test('il lessico conserva tutti i prefissi di sospensione e parentela di main', () => {
    const mainPrefixes = {
        suspension: ['sospes', 'sospend', 'interrott', 'interromp', 'sospensione', 'stop'],
        family: ['padre', 'madre', 'fratell', 'sorell', 'figli', 'nonn', 'familiar', 'genitor', 'mamma', 'coniug', 'nipot', 'cugin', 'suocer', 'cognat'],
    } as const;
    for (const category of ['suspension', 'family'] as const) {
        const stems = lexicon[category].filter(entry => entry.endsWith('*')).map(entry => entry.slice(0, -1));
        const missing = mainPrefixes[category].filter(prefix => !stems.some(stem => prefix.startsWith(stem)));
        assert.deepEqual(missing, [], category);
    }
});
