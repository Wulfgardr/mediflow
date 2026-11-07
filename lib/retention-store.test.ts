import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { initializeSqliteSchema } from './sqlite-schema';
import { commitTerritorialPackTransition, initializeTerritorialPacks } from './territorial-pack-store';
import { TERRITORIAL_PACK_SCHEMA } from './territorial-packs';
import { addCalendarYears, RETENTION_PROFILES, RetentionError } from './retention-policy';
import {
    assertAttachmentNotHeld, assertNoRetentionHold, commitRetentionWindows, discardExpiredFascicolo, placeRetentionHold, releaseRetentionHold,
    retentionOverview, reviewRetention, type RetentionAuditEvent,
} from './retention-store';

const CLOSED_AT = Date.UTC(2012, 2, 1) / 1000;
const NOW = Date.UTC(2026, 10, 3) / 1000;
const ADMIN = 'synthetic-admin';

function fixture(preset: 'core' | 'core+it' | 'core+it+lom' = 'core+it+lom') {
    const sqlite = new Database(':memory:');
    initializeSqliteSchema(sqlite);
    sqlite.transaction(() => initializeTerritorialPacks(sqlite, 'existing')).immediate();
    if (preset !== 'core+it+lom') {
        commitTerritorialPackTransition(sqlite, { schemaVersion: TERRITORIAL_PACK_SCHEMA, expectedRevision: 1, preset, confirmed: true },
            { actorType: 'system', actorRef: 'local-supervisor', sourceSurface: 'job' }, () => {});
    }
    const events: RetentionAuditEvent[] = [];
    return { sqlite, db: drizzle(sqlite), events, audit: (event: RetentionAuditEvent) => { events.push(event); } };
}
function addPatient(sqlite: Database.Database, id: string, options: { archived?: boolean; at?: number; entryType?: string } = {}) {
    const at = options.at ?? CLOSED_AT;
    sqlite.prepare(`INSERT INTO patients (id, first_name, last_name, tax_code, is_archived, version, created_at, updated_at)
        VALUES (?, 'ENC:synthetic', 'ENC:synthetic', 'ENC:synthetic', ?, 1, ?, ?)`).run(id, options.archived === false ? 0 : 1, at - 1000, at);
    sqlite.prepare(`INSERT INTO entries (id, patient_id, type, date, content, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'ENC:synthetic', ?, ?)`).run(`${id}-entry`, id, options.entryType ?? 'visit', at - 2000, at - 2000, at - 2000);
    sqlite.prepare(`INSERT INTO observations (id, patient_id, code_system, code, display, unit_system, unit_code, value, observed_at, created_at, updated_at)
        VALUES (?, ?, 'loinc', '2345-7', 'Glucosio', 'ucum', 'mg/dL', '90', ?, ?, ?)`).run(`${id}-obs`, id, at - 3000, at - 3000, at - 3000);
}
const isRetentionError = (code: string) => (error: unknown) => error instanceof RetentionError && error.code === code;

test('Lombardia: il fascicolo chiuso da oltre dieci anni entra nella revisione e lo scarto confermato lo rimuove con audit', () => {
    const { sqlite, db, events, audit } = fixture();
    try {
        addPatient(sqlite, 'p-expired');
        addPatient(sqlite, 'p-recent', { at: Date.UTC(2020, 0, 1) / 1000 });
        addPatient(sqlite, 'p-open', { archived: false });
        addPatient(sqlite, 'p-ricovero', { entryType: 'hospitalization' });
        const review = db.transaction(tx => reviewRetention(tx, NOW));
        const status = Object.fromEntries(review.items.map(item => [item.patientId, item.status]));
        assert.deepEqual(status, { 'p-expired': 'expired', 'p-recent': 'in_retention', 'p-ricovero': 'unlimited' });
        const expired = review.items.find(item => item.patientId === 'p-expired')!;
        assert.equal(expired.expiresAt, addCalendarYears(CLOSED_AT, 10));

        // Senza conferma esplicita, con scadenza diversa o su un fascicolo non scaduto non si cancella nulla.
        const command = { patientId: 'p-expired', expectedVersion: 1, expectedExpiresAt: expired.expiresAt, confirmed: true };
        assert.throws(() => db.transaction(tx => discardExpiredFascicolo(tx, { ...command, confirmed: false }, NOW, audit)), isRetentionError('input_invalid'));
        assert.throws(() => db.transaction(tx => discardExpiredFascicolo(tx, { ...command, expectedExpiresAt: 1 }, NOW, audit)), isRetentionError('expiry_changed'));
        assert.throws(() => db.transaction(tx => discardExpiredFascicolo(tx, { ...command, patientId: 'p-ricovero',
            expectedExpiresAt: expired.expiresAt }, NOW, audit)), isRetentionError('not_expired'));
        assert.equal(sqlite.prepare('SELECT count(*) FROM patients').pluck().get(), 4);

        const receipt = db.transaction(tx => discardExpiredFascicolo(tx, command, NOW, audit));
        assert.equal(receipt.category, 'ambulatory_record');
        assert.equal(receipt.term, 'P10Y');
        assert.equal(receipt.sourceId, 'lom-rev04');
        assert.equal(sqlite.prepare("SELECT count(*) FROM patients WHERE id = 'p-expired'").pluck().get(), 0);
        assert.equal(sqlite.prepare("SELECT count(*) FROM entries WHERE patient_id = 'p-expired'").pluck().get(), 0);
        assert.equal(sqlite.prepare("SELECT count(*) FROM patient_retired_ids WHERE id = 'p-expired'").pluck().get(), 1);
        const discarded = events.find(event => event.eventType === 'retention.fascicolo.discarded')!;
        for (const flag of ['category:ambulatory_record', 'term:P10Y:record_closure', 'source:lom-rev04', 'profile:it-lom-rev04']) {
            assert.ok(discarded.flags.includes(flag), flag);
        }
        assert.equal(sqlite.prepare("SELECT count(*) FROM patients WHERE id = 'p-recent'").pluck().get(), 1);
    } finally { sqlite.close(); }
});

test('un blocco su paziente o documento sospende lo scarto e la cancellazione amministrata finché non viene revocato', () => {
    const { sqlite, db, audit } = fixture();
    try {
        addPatient(sqlite, 'p-held');
        sqlite.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, created_at, document_source_ref, document_revision, document_freshness_epoch)
            VALUES ('doc-1', 'p-held', 'ENC:synthetic', 'application/dicom', 1, 'synthetic', ?, ?, 1, 1)`).run(CLOSED_AT - 10, 'a'.repeat(64));
        const holds = db.transaction(tx => placeRetentionHold(tx, { patientId: 'p-held', attachmentId: 'doc-1', reason: 'litigation',
            expectedRevision: 0, confirmed: true }, ADMIN, NOW, audit));
        const [item] = db.transaction(tx => reviewRetention(tx, NOW)).items;
        assert.equal(item.status, 'held');
        assert.throws(() => db.transaction(tx => discardExpiredFascicolo(tx, { patientId: 'p-held', expectedVersion: 1,
            expectedExpiresAt: item.expiresAt, confirmed: true }, NOW, audit)), isRetentionError('legal_hold'));
        assert.throws(() => db.transaction(tx => assertNoRetentionHold(tx, 'p-held')), isRetentionError('legal_hold'));

        db.transaction(tx => releaseRetentionHold(tx, { holdId: holds.holds[0].id, expectedRevision: 1, confirmed: true }, audit));
        assert.doesNotThrow(() => db.transaction(tx => assertNoRetentionHold(tx, 'p-held')));
        assert.equal(db.transaction(tx => reviewRetention(tx, NOW)).items[0].status, 'expired');
    } finally { sqlite.close(); }
});

test('un blocco ferma la cancellazione del documento bloccato e, se è sul fascicolo, di tutti i suoi documenti', () => {
    const { sqlite, db, audit } = fixture();
    try {
        addPatient(sqlite, 'p-docs', { archived: false, at: NOW - 100 });
        const attach = sqlite.prepare(`INSERT INTO attachments (id, patient_id, name, type, size, path, created_at, document_source_ref, document_revision, document_freshness_epoch)
            VALUES (?, 'p-docs', 'ENC:synthetic', 'application/pdf', 1, 'synthetic', ?, ?, 1, 1)`);
        attach.run('doc-held', NOW - 50, 'b'.repeat(64));
        attach.run('doc-free', NOW - 50, 'c'.repeat(64));
        assert.doesNotThrow(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-held')));

        const documentHold = db.transaction(tx => placeRetentionHold(tx, { patientId: 'p-docs', attachmentId: 'doc-held', reason: 'access_request',
            expectedRevision: 0, confirmed: true }, ADMIN, NOW, audit));
        assert.throws(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-held')), isRetentionError('legal_hold'));
        assert.doesNotThrow(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-free')));
        assert.doesNotThrow(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-other', 'doc-held')));

        const both = db.transaction(tx => placeRetentionHold(tx, { patientId: 'p-docs', reason: 'litigation',
            expectedRevision: documentHold.revision, confirmed: true }, ADMIN, NOW, audit));
        assert.throws(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-free')), isRetentionError('legal_hold'));

        let revision = both.revision;
        for (const hold of both.holds) {
            revision = db.transaction(tx => releaseRetentionHold(tx, { holdId: hold.id, expectedRevision: revision, confirmed: true }, audit)).revision;
        }
        assert.doesNotThrow(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-held')));
        assert.doesNotThrow(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-free')));

        sqlite.prepare("UPDATE settings SET value = '{not json' WHERE key = 'retention.holds'").run();
        assert.throws(() => db.transaction(tx => assertAttachmentNotHeld(tx, 'p-docs', 'doc-free')), isRetentionError('legal_hold'));
    } finally { sqlite.close(); }
});

test('senza profilo il titolare fissa le finestre; con profilo non può scendere sotto il minimo', () => {
    const none = fixture('core');
    try {
        addPatient(none.sqlite, 'p-none');
        assert.equal(none.db.transaction(tx => reviewRetention(tx, NOW)).items[0].status, 'unset');
        none.db.transaction(tx => commitRetentionWindows(tx, { expectedRevision: 0, confirmed: true,
            windows: { ambulatory_record: { kind: 'years', years: 3 }, lab_report: { kind: 'years', years: 3 } } }, none.audit));
        assert.equal(none.db.transaction(tx => reviewRetention(tx, NOW)).items[0].status, 'expired');
    } finally { none.sqlite.close(); }

    const lom = fixture();
    try {
        assert.throws(() => lom.db.transaction(tx => commitRetentionWindows(tx, { expectedRevision: 0, confirmed: true,
            windows: { ambulatory_record: { kind: 'years', years: 3 } } }, lom.audit)), isRetentionError('below_minimum'));
        lom.db.transaction(tx => commitRetentionWindows(tx, { expectedRevision: 0, confirmed: true,
            windows: { ambulatory_record: { kind: 'years', years: 20 } } }, lom.audit));
        addPatient(lom.sqlite, 'p-lom');
        assert.equal(lom.db.transaction(tx => reviewRetention(tx, NOW)).items[0].status, 'in_retention');
        assert.throws(() => lom.db.transaction(tx => commitRetentionWindows(tx, { expectedRevision: 0, confirmed: true, windows: {} }, lom.audit)),
            isRetentionError('conflict'));
    } finally { lom.sqlite.close(); }
});

test('uno stato di conservazione illeggibile non produce scaduti e blocca la cancellazione amministrata', () => {
    const { sqlite, db, audit } = fixture();
    try {
        addPatient(sqlite, 'p-corrupt');
        sqlite.prepare("INSERT INTO settings(key, value) VALUES ('retention.holds', '{not json')").run();
        const review = db.transaction(tx => reviewRetention(tx, NOW));
        assert.equal(review.configuration.status, 'configuration_error');
        assert.equal(review.items.length, 0);
        assert.throws(() => db.transaction(tx => discardExpiredFascicolo(tx, { patientId: 'p-corrupt', expectedVersion: 1,
            expectedExpiresAt: addCalendarYears(CLOSED_AT, 10), confirmed: true }, NOW, audit)), isRetentionError('configuration_error'));
        assert.throws(() => db.transaction(tx => assertNoRetentionHold(tx, 'p-corrupt')), isRetentionError('legal_hold'));
    } finally { sqlite.close(); }
});

test('la panoramica porta minimi e fonti del profilo attivo, così i client nativi non ricalcolano la politica', () => {
    const lombardy = fixture('core+it+lom');
    const overview = lombardy.db.transaction(tx => retentionOverview(tx, NOW));
    assert.equal(overview.status, 'ready');
    if (overview.status !== 'ready') return;
    assert.equal(overview.profile.id, overview.profileId);
    assert.deepEqual(Object.keys(overview.profile.terms).sort(), Object.keys(RETENTION_PROFILES[overview.profileId].terms).sort());
    const cited = new Set(Object.values(overview.profile.terms).flatMap(term => term.sourceId ? [term.sourceId] : []));
    assert.deepEqual(overview.sources.map(source => source.id).sort(), [...cited].sort());
    assert.ok(overview.sources.every(source => source.href.startsWith('https://')));

    const core = fixture('core');
    const plain = core.db.transaction(tx => retentionOverview(tx, NOW));
    assert.equal(plain.status === 'ready' && plain.profile.id, 'none');
    assert.deepEqual(plain.status === 'ready' && plain.profile, RETENTION_PROFILES.none);
});
