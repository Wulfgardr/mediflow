import { APPLICATION_OPERATION_DESCRIPTORS } from '../../../lib/headless/application-operation-registry';

/* @Codex */
export type MiniHeadlessReferentialStatus = Readonly<{
  schema: 'mediflow.mini.headless-referential-status.v1';
  miniCommandId: string;
  status: 'denied';
  availability: 'unavailable';
  manualDisposition: 'manual_only';
  grantability: 'not_grantable';
  operationId: null;
  applicationServiceRef: null;
  applyPolicy: 'none';
  writesPerformed: 0;
}>;

const EXPECTED_COMMANDS = [
  'patient search', 'patient show', 'draft preview', 'open-loops', 'whoami', 'capabilities',
] as const;

function status(miniCommandId: string): MiniHeadlessReferentialStatus {
  const output = Object.create(null) as MiniHeadlessReferentialStatus;
  Object.defineProperties(output, {
    schema: { value: 'mediflow.mini.headless-referential-status.v1', enumerable: true },
    miniCommandId: { value: miniCommandId, enumerable: true },
    status: { value: 'denied', enumerable: true },
    availability: { value: 'unavailable', enumerable: true },
    manualDisposition: { value: 'manual_only', enumerable: true },
    grantability: { value: 'not_grantable', enumerable: true },
    operationId: { value: null, enumerable: true },
    applicationServiceRef: { value: null, enumerable: true },
    applyPolicy: { value: 'none', enumerable: true },
    writesPerformed: { value: 0, enumerable: true },
  });
  return Object.freeze(output);
}

const statuses: MiniHeadlessReferentialStatus[] = [];
if (APPLICATION_OPERATION_DESCRIPTORS.length !== EXPECTED_COMMANDS.length) throw new Error('Mini referential roster drift');
for (let index = 0; index < EXPECTED_COMMANDS.length; index += 1) {
  const descriptor = APPLICATION_OPERATION_DESCRIPTORS[index]!;
  const miniCommandId = EXPECTED_COMMANDS[index]!;
  if (descriptor.miniCommandId !== miniCommandId || descriptor.status !== 'denied'
    || descriptor.availability !== 'unavailable' || descriptor.manualDisposition !== 'manual_only'
    || descriptor.grantability !== 'not_grantable' || descriptor.operationId !== null
    || descriptor.applicationServiceRef !== null || descriptor.applyPolicy !== 'none'
    || descriptor.writesPerformed !== 0) throw new Error('Mini referential descriptor drift');
  statuses[index] = status(miniCommandId);
}
Object.setPrototypeOf(statuses, null);

/** Referential status only: this does not expose or grant an executable operation. */
export const MINI_HEADLESS_REFERENTIAL_STATUSES = Object.freeze(statuses);
