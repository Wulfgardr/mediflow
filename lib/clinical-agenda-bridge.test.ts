/* @Codex */
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadClinicalAgendaCandidates } from './clinical-agenda-bridge.ts';

async function makeAssistantFixture(lines: string[]) {
    const root = await mkdtemp(path.join(tmpdir(), 'mediflow-clinical-agenda-'));
    await mkdir(path.join(root, 'data'), { recursive: true });
    await writeFile(
        path.join(root, 'data', 'icloud_calendar_events.jsonl'),
        lines.join('\n'),
        'utf8',
    );
    return root;
}

test('clinical agenda bridge keeps only clinical or FBF candidates from local event caches', async () => {
    const root = await makeAssistantFixture([
        JSON.stringify({
            id: 'event-1',
            title: 'Ambulatorio FBF - follow-up cardiometabolico',
            start_iso: '2026-05-18T08:30:00+02:00',
            end_iso: '2026-05-18T09:00:00+02:00',
            location: 'Ambulatorio locale',
            calendar_title: 'Clinica',
        }),
        JSON.stringify({
            id: 'event-2',
            title: 'Cena famiglia',
            start_iso: '2026-05-18T20:30:00+02:00',
            calendar_title: 'Personale',
        }),
        JSON.stringify({
            id: 'event-3',
            title: 'Riunione equipe distretto PAI',
            start_iso: '2026-05-19T11:30:00+02:00',
            calendar_title: 'Lavoro sanitario',
        }),
    ]);

    const result = await loadClinicalAgendaCandidates({
        assistantDir: root,
        now: new Date('2026-05-16T10:00:00+02:00'),
        futureDays: 7,
    });

    assert.equal(result.enabled, true);
    assert.equal(result.stats.parsed, 3);
    assert.equal(result.candidates.length, 2);
    assert.deepEqual(
        result.candidates.map((candidate) => candidate.title),
        [
            'Ambulatorio FBF - follow-up cardiometabolico',
            'Riunione equipe distretto PAI',
        ],
    );
    assert.ok(result.candidates[0].reasons.includes('FBF/Fatebenefratelli'));
    assert.equal(result.candidates[0].reviewState, 'candidate');
});

test('clinical agenda bridge returns disabled state when assistant cache is missing', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'mediflow-clinical-agenda-missing-'));

    const result = await loadClinicalAgendaCandidates({
        assistantDir: root,
        now: new Date('2026-05-16T10:00:00+02:00'),
    });

    assert.equal(result.enabled, false);
    assert.equal(result.candidates.length, 0);
    assert.equal(result.sourceStatuses.every((source) => source.status === 'missing'), true);
});
