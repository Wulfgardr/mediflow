#!/usr/bin/env node
/* @Codex: Independent HTTPS rereads for actual UI checkpoints; no clinical
   writer, DB access, simulator control, proxy control or production imports. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loginWithWebAuthControl } from './web-auth-control-test-client.mjs';
import { readDescriptor, pinnedFetch, unwrapLoginKey, openField, nativeSessionCookie } from './mobile-home-base-interop.mjs';

export const modules = {
    patient: { route: 'patients', fields: ['firstName', 'lastName', 'taxCode', 'address', 'phone', 'caregiver', 'notes', 'deletionReason', 'archiveReason', 'archiveNote'],
        encryptedFields: ['address', 'phone', 'caregiver', 'notes', 'deletionReason', 'archiveReason', 'archiveNote'] },
    // Only the canonical lib/db.ts ENCRYPTED_FIELDS within each compared field
    // set require a sealed value; drug names, codes, units and statuses stay plain.
    therapy: { route: 'therapies', nested: true, fields: ['drugName', 'dosage', 'motivation', 'activePrinciple', 'aic', 'atc', 'status'],
        encryptedFields: ['motivation'] },
    checkup: { route: 'checkups', nested: true, fields: ['title', 'notes', 'status'], encryptedFields: ['notes'] },
    observation: { route: 'observations', nested: true, fields: ['display', 'code', 'value', 'unitCode', 'notes'], encryptedFields: ['notes'] },
    service: { route: 'service-prescriptions', fields: ['serviceName', 'clinicalQuestion', 'provider', 'status'],
        encryptedFields: ['serviceName', 'clinicalQuestion', 'provider'] },
    'service-item': { route: 'service-prescription-items', fields: ['prescriptionId', 'serviceName', 'serviceCode', 'status'],
        encryptedFields: ['serviceName'] },
    prosthetic: { route: 'prosthetic-prescriptions', fields: ['description', 'clinicalReason', 'measures', 'supplier', 'status', 'collaudoOutcome'],
        encryptedFields: ['description', 'clinicalReason', 'measures', 'supplier', 'collaudoOutcome'] },
    entry: { route: 'entries', nested: true, fields: ['title', 'content', 'type'], encryptedFields: ['title', 'content'] },
};

// @Codex: Only a newly UI-created auxiliary record may enter the lifecycle run.
// History is advanced after the independent read succeeds, never on assertion alone.
const patientStages = ['created', 'profile-updated', 'archived', 'reactivated', 'trashed', 'restored', 'restored-reread'];

export function validateStep(step, descriptor, runID, clientPlatform, history = new Map()) {
    assert.equal(step.schemaVersion, 1);
    assert.equal(step.synthetic, true);
    assert.equal(step.fixtureId, descriptor.fixtureId);
    assert.equal(step.runID, runID);
    assert.equal(step.clientPlatform, clientPlatform);
    assert.match(step.stepID, /^step-\d{3}$/u);
    assert.match(step.recordId, /^[A-Za-z0-9._-]{1,150}$/u);
    assert.ok(Object.hasOwn(modules, step.module), 'Unknown module');
    if (step.module === 'patient') {
        assert.equal(step.patientId, step.recordId);
        assert.notEqual(step.recordId, descriptor.patient.id, 'The shared descriptor patient is never a lifecycle target');
        const previous = history.get('patient');
        const stageIndex = previous ? patientStages.indexOf(previous.lifecycleStage) + 1 : 0;
        assert.ok(stageIndex < patientStages.length, 'The lifecycle already has its final reread');
        assert.equal(step.lifecycleStage, patientStages[stageIndex], 'Lifecycle stages must follow verified UI writes');
        assert.equal(step.version, Math.min(stageIndex + 1, 6));
        if (previous) assert.equal(step.recordId, previous.recordId, 'The UI-created patient binding must not change');
        else assert.equal(step.stepID, 'step-001');
        assert.equal(step.deleted, step.lifecycleStage === 'trashed');
        assert.equal(step.expected?.firstName, 'Sintetico');
        assert.equal(step.expected?.lastName, `Interop ${runID} ${clientPlatform}`);
        assert.equal(step.expected?.taxCode, `SYN-${runID}-${clientPlatform}`);
        assert.deepEqual(step.expectedFlags, { isArchived: step.lifecycleStage === 'archived', isAdi: false });
        const archived = step.lifecycleStage === 'archived';
        assert.deepEqual(step.expectedNulls, step.deleted ? ['birthDate'] : archived ? ['birthDate', 'deletionReason']
            : ['birthDate', 'deletionReason', 'archiveReason', 'archiveNote']);
        // The actual UI deliberately selects Other and enters this exact note.
        // Both fields are canonical encrypted patient columns, including reason.
        if (archived) {
            assert.equal(step.expected.archiveReason, 'other');
            assert.equal(step.expected.archiveNote, `Archiviazione sintetica ${runID}`);
        } else {
            assert.equal(step.expected.archiveReason, undefined);
            assert.equal(step.expected.archiveNote, undefined);
        }
        if (step.deleted) {
            assert.deepEqual(Object.keys(step.expected).sort(), ['deletionReason', 'firstName', 'lastName', 'taxCode']);
            assert.equal(step.expected.deletionReason, `Eliminazione sintetica ${runID}`);
        } else {
            for (const field of ['address', 'phone', 'caregiver']) assert.ok(step.expected[field]?.length > 0);
        }
    } else {
        assert.equal(step.patientId, descriptor.patient.id);
        assert.equal(step.lifecycleStage, undefined);
        assert.equal(step.expectedFlags, undefined);
        assert.equal(step.expectedNulls, undefined);
    }
    assert.ok(Number.isSafeInteger(step.version) && step.version > 0, 'Missing exact expected version');
    assert.equal(typeof step.deleted, 'boolean');
    assert.ok(step.expected && Object.keys(step.expected).length > 0, 'Positive field expectations are required');
    for (const [field, value] of Object.entries(step.expected)) {
        assert.ok(modules[step.module].fields.includes(field), 'Unexpected module field');
        assert.equal(typeof value, 'string', 'Expected clinical field must be an explicit synthetic string');
    }
    return step;
}

export function acceptVerifiedStep(step, history) {
    if (step.module === 'patient') history.set('patient', { lifecycleStage: step.lifecycleStage, recordId: step.recordId });
}

export function readRoutesForStep(step) {
    const definition = modules[step.module];
    if (step.module === 'patient') {
        return { web: `/api/patients/${encodeURIComponent(step.recordId)}`,
            paired: step.deleted ? '/api/v1/network/patients?includeDeleted=true'
                : `/api/v1/network/patients/${encodeURIComponent(step.recordId)}`,
            webStatus: step.deleted ? 404 : 200 };
    }
    const query = `?patientId=${encodeURIComponent(step.patientId)}&includeDeleted=true&limit=100`;
    return { web: `/api/${definition.route}${query}`, paired: definition.nested
        ? `/api/v1/network/patients/${encodeURIComponent(step.patientId)}/${definition.route}?limit=100`
        : `/api/v1/network/${definition.route}${query}`, webStatus: 200 };
}

export async function compareRecords(step, webRows, pairedRows, webKey, pairedKey) {
    assert.ok(Array.isArray(webRows) && Array.isArray(pairedRows), 'Both ordinary reads must return lists');
    const web = webRows.filter(row => row.id === step.recordId);
    const paired = pairedRows.filter(row => row.id === step.recordId);
    assert.equal(paired.length, 1, 'Expected one exact paired record, including its historical state');
    const peer = paired[0];
    const patientIdentityField = step.module === 'patient' ? 'id' : 'patientId';
    assert.equal(peer[patientIdentityField], step.patientId, 'Wrong patient');
    assert.equal(peer.version, step.version, 'Unexpected paired CAS version');
    assert.equal(peer.deletedAt != null, step.deleted, 'Unexpected paired deletion state');
    // The web therapies list omits tombstones; the web patient detail returns
    // 404 for them. Paired summaries retain the explicit lifecycle evidence.
    const webActiveListOnly = ['therapy', 'patient'].includes(step.module) && step.deleted;
    assert.equal(web.length, webActiveListOnly ? 0 : 1, 'Unexpected authoritative web record count');
    if (!webActiveListOnly) {
        assert.equal(web[0][patientIdentityField], step.patientId);
        assert.equal(web[0].version, step.version, 'Unexpected web CAS version');
        assert.equal(web[0].deletedAt != null, step.deleted, 'Unexpected web deletion state');
    }
    for (const [field, expected] of Object.entries(step.expected)) {
        const encrypted = modules[step.module].encryptedFields.includes(field);
        if (encrypted) {
            assert.ok(typeof peer[field] === 'string' && peer[field].startsWith('ENC:'), `Missing sealed field: ${field}`);
        }
        assert.ok((encrypted ? await openField(peer[field], pairedKey) : peer[field]) === expected, `Paired field mismatch: ${field}`);
        if (!webActiveListOnly) {
            if (encrypted) assert.ok(typeof web[0][field] === 'string' && web[0][field].startsWith('ENC:'), `Missing web sealed field: ${field}`);
            assert.ok((encrypted ? await openField(web[0][field], webKey) : web[0][field]) === expected, `Web field mismatch: ${field}`);
            assert.ok(web[0][field] === peer[field], `Wire field mismatch: ${field}`);
        }
    }
    for (const [field, expected] of Object.entries(step.expectedFlags ?? {})) {
        assert.equal(peer[field], expected, `Paired boolean mismatch: ${field}`);
        if (!webActiveListOnly) assert.equal(web[0][field], expected, `Web boolean mismatch: ${field}`);
    }
    for (const field of step.expectedNulls ?? []) {
        assert.equal(peer[field], null, `Paired absent field mismatch: ${field}`);
        if (!webActiveListOnly) assert.equal(web[0][field], null, `Web absent field mismatch: ${field}`);
    }
    return { version: step.version, deleted: step.deleted, comparedFields: Object.keys(step.expected),
        comparedFlags: Object.keys(step.expectedFlags ?? {}), comparedNulls: step.expectedNulls ?? [],
        webObservation: step.module === 'patient' && step.deleted ? 'exact-patient-detail-404'
            : webActiveListOnly ? 'absent-from-active-list' : 'exact-record-fields-and-version',
        pairedObservation: 'exact-record-fields-and-version', nativePeerApp: 'not-proven-by-this-API-receipt' };
}

export async function verifyStep(descriptor, clientPlatform, step) {
    const fetchHost = pinnedFetch(descriptor);
    const web = await loginWithWebAuthControl(descriptor.host.httpsURL,
        { username: descriptor.operator.username, password: descriptor.operator.pin }, fetchHost);
    assert.equal(web.response.status, 200, 'Web login failed');
    const cookie = `${web.cookieHeader}; ambulatory_id=${encodeURIComponent(descriptor.operator.ambulatoryId)}`;
    const webHeaders = { Cookie: cookie, 'Cache-Control': 'no-store' };
    const peerPlatform = clientPlatform === 'ios' ? 'ipados' : 'ios';
    const peer = descriptor.clients[peerPlatform];
    const pairing = { 'x-mediflow-paired-client-id': peer.id, 'x-mediflow-paired-client-token': peer.token };
    let nativeHeaders;
    const checks = [{ operation: 'Independent web login', httpStatus: web.response.status }];
    try {
        const revisionResponse = await fetchHost('/api/v1/network/revision', { headers: pairing });
        assert.equal(revisionResponse.status, 200, 'Revision read failed');
        assert.equal((await revisionResponse.json()).revision, descriptor.host.sourceCommit, 'Host revision changed');
        const native = await fetchHost('/api/auth/native/login', { method: 'POST',
            headers: { ...pairing, 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: descriptor.operator.username, password: descriptor.operator.pin }) });
        assert.equal(native.status, 200, 'Independent peer API login failed');
        checks.push({ operation: 'Independent peer API login', httpStatus: native.status });
        nativeHeaders = { ...pairing, Cookie: `${nativeSessionCookie(native)}; ambulatory_id=${encodeURIComponent(descriptor.operator.ambulatoryId)}` };
        const webKey = await unwrapLoginKey(web.json, descriptor.operator.pin);
        const peerKey = await unwrapLoginKey(await native.json(), descriptor.operator.pin);
        const routes = readRoutesForStep(step);
        const webRead = await fetchHost(routes.web, { headers: webHeaders });
        const pairedRead = await fetchHost(routes.paired, { headers: nativeHeaders });
        checks.push({ operation: 'Independent web module reread', httpStatus: webRead.status },
            { operation: 'Independent peer API module reread', httpStatus: pairedRead.status });
        assert.equal(webRead.status, routes.webStatus, 'Web module reread failed');
        assert.equal(pairedRead.status, 200, 'Paired module reread failed');
        const webRows = step.module === 'patient'
            ? (step.deleted ? [] : [await webRead.json()]) : await webRead.json();
        const pairedRows = step.module === 'patient' && !step.deleted
            ? [await pairedRead.json()] : await pairedRead.json();
        const comparison = await compareRecords(step, webRows, pairedRows, webKey, peerKey);
        return { schemaVersion: 1, status: 'pass', runID: step.runID, fixtureId: step.fixtureId, stepID: step.stepID,
            module: step.module, recordId: step.recordId, lifecycleStage: step.lifecycleStage, hostSourceCommit: descriptor.host.sourceCommit,
            writerClientPlatform: clientPlatform, readerAPIPlatform: peerPlatform, comparison, checks };
    } catch (error) {
        error.interopChecks = checks;
        throw error;
    } finally {
        let cleanupFailed = false;
        if (nativeHeaders) {
            try {
                const result = await fetchHost('/api/auth/native/logout', { method: 'POST', headers: nativeHeaders });
                checks.push({ operation: 'Own peer API session logout', httpStatus: result.status });
                cleanupFailed ||= result.status !== 204;
            } catch { checks.push({ operation: 'Own peer API session logout', transport: 'failed' }); cleanupFailed = true; }
        }
        try {
            const result = await fetchHost('/api/auth/logout', { method: 'POST', headers: {
                ...webHeaders, 'If-Match': web.controlEtag, 'Idempotency-Key': randomUUID() } });
            checks.push({ operation: 'Own web session logout', httpStatus: result.status });
            cleanupFailed ||= result.status !== 204;
        } catch { checks.push({ operation: 'Own web session logout', transport: 'failed' }); cleanupFailed = true; }
        if (cleanupFailed) {
            const error = new Error('One or more verifier-owned sessions could not be retired');
            error.interopChecks = checks;
            throw error;
        }
    }
}

function readPrivateJSON(file) {
    const info = fs.lstatSync(file);
    assert.ok(info.isFile() && (info.mode & 0o777) === 0o600, 'A private regular checkpoint is required');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
    const { values } = parseArgs({ options: { descriptor: { type: 'string' }, client: { type: 'string' },
        directory: { type: 'string' }, 'run-id': { type: 'string' } } });
    assert.ok(values.descriptor && values.directory && values['run-id']);
    assert.ok(['ios', 'ipados'].includes(values.client));
    assert.match(values['run-id'], /^[A-Za-z0-9._-]{1,100}$/u);
    const descriptor = readDescriptor(values.descriptor);
    const info = fs.lstatSync(values.directory);
    assert.ok(info.isDirectory() && !info.isSymbolicLink() && (info.mode & 0o777) === 0o700);
    // Unique ownership: no duplicate verifier can acknowledge the same run.
    fs.closeSync(fs.openSync(path.join(values.directory, '.verifier-owned'), 'wx', 0o600));
    let index = 1;
    const history = new Map();
    const deadline = Date.now() + 30 * 60_000;
    while (Date.now() < deadline) {
        const stepID = `step-${String(index).padStart(3, '0')}`;
        const source = path.join(values.directory, `${stepID}.json`);
        if (fs.existsSync(source)) {
            let receipt;
            try {
                const step = validateStep(readPrivateJSON(source), descriptor, values['run-id'], values.client, history);
                assert.equal(step.stepID, stepID);
                receipt = await verifyStep(descriptor, values.client, step);
                acceptVerifiedStep(step, history);
            } catch (error) {
                // Keep credentials, cookie values, plaintext records and assertion
                // operands out of logs/receipts even for an unexpected response.
                receipt = { schemaVersion: 1, status: 'failed', runID: values['run-id'], fixtureId: descriptor.fixtureId,
                    stepID, checks: error.interopChecks ?? [],
                    reason: 'Independent HTTPS module verification failed; inspect source/status-only owner evidence.' };
            }
            const temporary = path.join(values.directory, `.${stepID}-${randomUUID()}.json`);
            fs.writeFileSync(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
            fs.renameSync(temporary, path.join(values.directory, `${stepID}-receipt.json`));
            console.log(`${stepID}: ${receipt.status}`);
            if (receipt.status !== 'pass') { process.exitCode = 1; return; }
            index++;
        } else if (fs.existsSync(path.join(values.directory, 'ui-complete.json'))) {
            const completed = readPrivateJSON(path.join(values.directory, 'ui-complete.json'));
            assert.equal(completed.runID, values['run-id']);
            assert.equal(completed.fixtureId, descriptor.fixtureId);
            assert.equal(completed.stepCount, index - 1);
            assert.ok(index > 1, 'An empty checkpoint run is not validation');
            console.log(`UI checkpoints verified: ${index - 1}; peer native-app reread remains separate.`);
            return;
        } else if (fs.existsSync(path.join(values.directory, 'ui-finished.json'))) {
            throw new Error('UI ended before its complete receipt');
        } else { await delay(100); }
    }
    throw new Error('Bounded verifier window elapsed');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(() => { console.error('Module verifier stopped without a complete run receipt.'); process.exitCode = 1; });
}
