import {
  HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS,
  resolveHeadlessCanonicalCapability,
  type HeadlessCanonicalCapabilityDescriptor,
} from './canonical-capability-catalog';

/* @Codex */
export type ApplicationOperationDescriptor = Readonly<{
  schema: 'mediflow.headless.application-operation-descriptor.v1';
  anchorId: string; miniCommandId: string;
  status: 'denied'; availability: 'unavailable';
  manualDisposition: 'manual_only'; grantability: 'not_grantable';
  operationId: null; applicationServiceRef: null;
  unresolved: HeadlessCanonicalCapabilityDescriptor['unresolved'];
  applyPolicy: 'none'; writesPerformed: 0;
  evidence: Readonly<{ sourceCommit: string; sourcePath: string; sourceBlob: string; sourceSha256: string; sourceSetSha256: string }>;
}>;

export type ApplicationOperationResolution = Readonly<{
  status: 'denied'; reason: 'operational_contract_unresolved' | 'unknown_mini_command';
  descriptor: ApplicationOperationDescriptor | null; applyPolicy: 'none'; writesPerformed: 0;
}>;

function record<T extends object>(value: T): Readonly<T> {
  const output = Object.create(null) as T;
  for (const key of Object.keys(value) as (keyof T)[]) output[key] = value[key];
  return Object.freeze(output);
}
function list<T>(values: readonly T[]): readonly T[] {
  const output = Array.from(values); Object.setPrototypeOf(output, null); return Object.freeze(output);
}
const EVIDENCE = record({
  sourceCommit: '1e35733c0218eae67a1d6e158085aab7340bc26b',
  sourcePath: 'packages/mini/contracts/mini-parity.json',
  sourceBlob: 'ecde8213824a2e46e6ec3216ce63009366a1f373',
  sourceSha256: '8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9',
  sourceSetSha256: '390bdc23aef4ff38e8a30eeb92820f6329de43a965cc5883769e475d98deaa94',
});

const MINI_ASSOCIATIONS = [
  [1, 'patient search'],
  [1, 'patient show'],
  [4, 'draft preview'],
  [11, 'open-loops'],
  [39, 'whoami'],
  [63, 'capabilities'],
] as const;

function canonicalForSourceRow(sourceRow: number): HeadlessCanonicalCapabilityDescriptor {
  for (let index = 0; index < HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS.length; index += 1) {
    const item = HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS[index]!;
    if (item.sourceRow === sourceRow) {
      if (resolveHeadlessCanonicalCapability(item.anchorId) !== item) throw new Error('canonical catalog anchor drift');
      return item;
    }
  }
  throw new Error('canonical catalog source row missing');
}

const descriptor = (sourceRow: number, miniCommandId: string): ApplicationOperationDescriptor => {
  const canonical = canonicalForSourceRow(sourceRow);
  return record({
    schema: 'mediflow.headless.application-operation-descriptor.v1', anchorId: canonical.anchorId, miniCommandId,
    status: 'denied', availability: 'unavailable', manualDisposition: 'manual_only', grantability: 'not_grantable',
    operationId: null, applicationServiceRef: null, unresolved: canonical.unresolved,
    applyPolicy: 'none', writesPerformed: 0, evidence: EVIDENCE,
  });
};

/** Static source evidence only. A Mini command is never an operational identifier or grant. */
const operationDescriptors: ApplicationOperationDescriptor[] = [];
for (const [sourceRow, miniCommandId] of MINI_ASSOCIATIONS) operationDescriptors.push(descriptor(sourceRow, miniCommandId));
export const APPLICATION_OPERATION_DESCRIPTORS = list(operationDescriptors);

const unknown = (): ApplicationOperationResolution => record({ status: 'denied', reason: 'unknown_mini_command', descriptor: null, applyPolicy: 'none', writesPerformed: 0 });

/** Requires both frozen identifiers; values are compared exactly and are never normalized or inferred. */
export function resolveApplicationOperation(anchorId: unknown, miniCommandId: unknown): ApplicationOperationResolution {
  if (typeof anchorId !== 'string' || typeof miniCommandId !== 'string') return unknown();
  for (let index = 0; index < APPLICATION_OPERATION_DESCRIPTORS.length; index += 1) {
    const item = APPLICATION_OPERATION_DESCRIPTORS[index]!;
    if (item.anchorId === anchorId && item.miniCommandId === miniCommandId) {
      return record({ status: 'denied', reason: 'operational_contract_unresolved', descriptor: item, applyPolicy: 'none', writesPerformed: 0 });
    }
  }
  return unknown();
}
