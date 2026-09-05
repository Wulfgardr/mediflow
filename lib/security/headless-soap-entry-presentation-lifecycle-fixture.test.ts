/* @Codex */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { createClinicianSoapEntryFieldSet } from '../headless/clinician-soap-entry-field-set.ts';
import {
    CLINICIAN_SOAP_DRAFT_SCHEMA,
    CLINICIAN_SOAP_OPERATION_ID,
    validateClinicianSoapWriteDraft,
} from '../headless/clinician-soap-write-contract.ts';

type GoldenH4Fixture = Readonly<{
    inputs: Readonly<{
        epochMilliseconds: number;
        subjective: string;
        objective: string;
        assessment: string;
        plan: string;
    }>;
    seal: Readonly<Record<string, unknown>>;
}>;
type SealBindingOwner = Readonly<{
    sealBindingController: Readonly<{
        bindGestureSeal(correlationToken: unknown, sealBundle: unknown): Promise<boolean>;
    }>;
}>;

export const HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4 = JSON.parse(readFileSync(
    new URL('../../native/contracts/headless-soap-entry-h4-golden.v1.json', import.meta.url),
    'utf8',
)) as GoldenH4Fixture;

export function createHeadlessSoapEntryPresentationGoldenFieldSet() {
    const accepted = validateClinicianSoapWriteDraft(Object.assign(Object.create(null), {
        schema: CLINICIAN_SOAP_DRAFT_SCHEMA,
        operationId: CLINICIAN_SOAP_OPERATION_ID,
        subjective: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.inputs.subjective,
        objective: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.inputs.objective,
        assessment: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.inputs.assessment,
        plan: HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.inputs.plan,
    }));
    assert.equal(accepted.status, 'accepted');
    if (accepted.status !== 'accepted') throw new Error('golden H1 fixture denied');
    const fieldSet = createClinicianSoapEntryFieldSet(
        accepted,
        HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.inputs.epochMilliseconds,
    );
    assert.ok(fieldSet);
    return fieldSet;
}

export async function bindHeadlessSoapEntryPresentationGoldenSeal(
    owner: SealBindingOwner,
    correlationToken: string,
): Promise<void> {
    assert.equal(await owner.sealBindingController.bindGestureSeal(
        correlationToken,
        HEADLESS_SOAP_ENTRY_PRESENTATION_GOLDEN_H4.seal,
    ), true);
}
