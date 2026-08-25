/* @Codex */
export type ApplicationOperationDescriptor = Readonly<{
  schema: 'mediflow.headless.application-operation-descriptor.v1';
  anchorId: string; miniCommandId: string;
  status: 'denied'; availability: 'unavailable'; operationId: null;
  unresolved: readonly ['operational_id', 'input_schema', 'output_schema', 'stage', 'authority', 'revision', 'limits'];
  applyPolicy: 'none'; writesPerformed: 0;
  evidence: Readonly<{ sourceCommit: string; sourcePath: string; sourceBlob: string; sourceSha256: string; sourceSetSha256: string }>;
}>;

export type ApplicationOperationResolution = Readonly<{
  status: 'denied'; reason: 'operational_contract_unresolved' | 'unknown_mini_command';
  descriptor: ApplicationOperationDescriptor | null; applyPolicy: 'none'; writesPerformed: 0;
}>;

const EVIDENCE = Object.freeze({
  sourceCommit: '1e35733c0218eae67a1d6e158085aab7340bc26b',
  sourcePath: 'packages/mini/contracts/mini-parity.json',
  sourceBlob: 'ecde8213824a2e46e6ec3216ce63009366a1f373',
  sourceSha256: '8f84108732b7a8a9c1feb20cdedee17f4865044de98d8d997896f3a914d0e4d9',
  sourceSetSha256: '390bdc23aef4ff38e8a30eeb92820f6329de43a965cc5883769e475d98deaa94',
});
const UNRESOLVED = Object.freeze(['operational_id', 'input_schema', 'output_schema', 'stage', 'authority', 'revision', 'limits'] as const);
const descriptor = (anchorId: string, miniCommandId: string): ApplicationOperationDescriptor => Object.freeze({
  schema: 'mediflow.headless.application-operation-descriptor.v1', anchorId, miniCommandId,
  status: 'denied', availability: 'unavailable', operationId: null, unresolved: UNRESOLVED,
  applyPolicy: 'none', writesPerformed: 0, evidence: EVIDENCE,
});

/** Static source evidence only. A Mini command is never an operational identifier or grant. */
export const APPLICATION_OPERATION_DESCRIPTORS = Object.freeze([
  descriptor('anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient search'),
  descriptor('anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218', 'patient show'),
  descriptor('anchor:web:web-04-nuova-voce-clinica-avanzata-s-o-a-p-allegati-ocr-sessione-visita@1e35733c0218', 'draft preview'),
  descriptor('anchor:web:web-11-suggerimenti-follow-up-proiettati-da-documenti@1e35733c0218', 'open-loops'),
  descriptor('anchor:web:web-39-blocco-sessione-immediato-stato-sessione@1e35733c0218', 'whoami'),
  descriptor('anchor:web:web-63-get-api-v1-network-capabilities-api-v1-network-identity-api-v1-n@1e35733c0218', 'capabilities'),
] as const);

const unknown = (): ApplicationOperationResolution => Object.freeze({ status: 'denied', reason: 'unknown_mini_command', descriptor: null, applyPolicy: 'none', writesPerformed: 0 });

/** Requires both frozen identifiers; values are compared exactly and are never normalized or inferred. */
export function resolveApplicationOperation(anchorId: unknown, miniCommandId: unknown): ApplicationOperationResolution {
  if (typeof anchorId !== 'string' || typeof miniCommandId !== 'string') return unknown();
  for (const item of APPLICATION_OPERATION_DESCRIPTORS) {
    if (item.anchorId === anchorId && item.miniCommandId === miniCommandId) {
      return Object.freeze({ status: 'denied', reason: 'operational_contract_unresolved', descriptor: item, applyPolicy: 'none', writesPerformed: 0 });
    }
  }
  return unknown();
}
