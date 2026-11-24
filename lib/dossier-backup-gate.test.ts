import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { dossierCreationSource } from './dossier-backup-gate';

const open = { groupKey: 'Scheda-2', sourceKey: 'Scheda-2/referto.pdf' };

test('a creation form already open stays closed while the backup choice is pending', () => {
    assert.equal(dossierCreationSource(open, 'Scheda-2', true), null);
});

test('once the backup choice is made the same creation form is offered again', () => {
    assert.equal(dossierCreationSource(open, 'Scheda-2', false), 'Scheda-2/referto.pdf');
});

test('a creation form belongs to its own group only', () => {
    assert.equal(dossierCreationSource(open, 'Scheda-3', false), null);
    assert.equal(dossierCreationSource(null, 'Scheda-2', false), null);
});

test('the Dossier import panel opens the creation form only through the backup gate', () => {
    const panel = fs.readFileSync(new URL('../components/dossier-import-panel.tsx', import.meta.url), 'utf8');
    assert.match(panel, /creating=\{dossierCreationSource\(creating, group\.key, backupProposed\)\}/);
    assert.doesNotMatch(panel, /creating=\{creating\?\.groupKey/);
});
