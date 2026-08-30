/* @Codex */
export type HeadlessCanonicalCapabilityDescriptor = Readonly<{
  schema: 'mediflow.headless.canonical-capability-descriptor.v1';
  anchorId: string;
  sourceRow: number;
  manualDisposition: 'manual_only';
  grantability: 'not_grantable';
  stage: 'unresolved';
  unresolved: readonly string[];
  operationId: null;
  applicationServiceRef: null;
  applyPolicy: 'none';
  writesPerformed: 0;
  evidence: Readonly<{
    crosswalkRef: string;
    crosswalkBlob: string;
    rosterSha256: string;
    webCapabilitySha256: string;
  }>;
}>;

function record<T extends object>(value: T): Readonly<T> {
  return Object.freeze(Object.assign(Object.create(null) as T, value));
}

function list<T>(values: readonly T[]): readonly T[] {
  const output = Array.from(values);
  Object.setPrototypeOf(output, null);
  return Object.freeze(output);
}

const EVIDENCE = record({
  crosswalkRef: 'b25ace437fda8d89b402c63cba2adb38295f188c:docs/capability-mapping/nodes/web-mini-crosswalk.v1.json',
  crosswalkBlob: '79e8078c1b7ed244653a32d6fce2dd1ef83ff281',
  rosterSha256: 'a185efd62172faf9ce5df1154c00cb41d9ae61d22b43c3bb42367dece9263976',
  webCapabilitySha256: '4c0281982b197da52e73911ebd4874d0d60894607c8421fd9f89f81b98408d95',
});

const UNRESOLVED = list([
  'operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema', 'maximumStage',
  'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy', 'limitPolicy', 'receiptPolicy',
  'fabricDependency',
] as const);

const ANCHORS = [
  [1, 'anchor:web:web-01-anagrafica-paziente-lista-ricerca-view-create-update@1e35733c0218'],
  [2, 'anchor:web:web-02-archivia-soft-delete-ripristina-paziente-stato-scheda@1e35733c0218'],
  [3, 'anchor:web:web-03-diario-clinico-view-list-create-update-soft-delete-restore-filtr@1e35733c0218'],
  [4, 'anchor:web:web-04-nuova-voce-clinica-avanzata-s-o-a-p-allegati-ocr-sessione-visita@1e35733c0218'],
  [5, 'anchor:web:web-05-editor-rich-text-clinico-formattazione-s-o-a-p@1e35733c0218'],
  [6, 'anchor:web:web-06-somministrazione-scale-cliniche-runner-salvataggio-come-voce-dia@1e35733c0218'],
  [7, 'anchor:web:web-07-libreria-catalogo-scale-standalone-con-storico-e-scorciatoie@1e35733c0218'],
  [8, 'anchor:web:web-08-gestione-terapie-farmacologiche-crud-stato-collegamento-diagnosi@1e35733c0218'],
  [9, 'anchor:web:web-09-ragionamento-terapeutico-ai-treatment-reasoning-review-only@1e35733c0218'],
  [10, 'anchor:web:web-10-controlli-checkup-follow-up-crud-stato@1e35733c0218'],
  [11, 'anchor:web:web-11-suggerimenti-follow-up-proiettati-da-documenti@1e35733c0218'],
  [12, 'anchor:web:web-12-osservazioni-parametri-clinici-crud-loinc-ucum-trend-sparkline@1e35733c0218'],
  [13, 'anchor:web:web-13-prestazioni-prescritte-service-prescriptions-crud-ricco-stato@1e35733c0218'],
  [14, 'anchor:web:web-14-diario-ausili-e-prescrizioni-protesiche-crud-collaudo@1e35733c0218'],
  [15, 'anchor:web:web-15-upload-documenti-ocr-sintesi-clinica-archivio-documenti@1e35733c0218'],
  [16, 'anchor:web:web-16-archivio-intelligente-document-insights-view-estrazioni-delete@1e35733c0218'],
  [17, 'anchor:web:web-17-smart-import-candidati-diagnosi-terapie-da-documenti-applica-in-@1e35733c0218'],
  [18, 'anchor:web:web-18-referti-recenti-evidence-stack-tile-view-sintesi@1e35733c0218'],
  [19, 'anchor:web:web-19-ai-patient-insight-sintesi-follow-up-alert-generati@1e35733c0218'],
  [20, 'anchor:web:web-20-foglio-sinottico-identity-lens-review-queue-viste-sintetiche-coc@1e35733c0218'],
  [21, 'anchor:web:web-21-export-fhir-paziente-con-pre-check-validazione-fse@1e35733c0218'],
  [22, 'anchor:web:web-22-report-pdf-paziente@1e35733c0218'],
  [23, 'anchor:web:web-23-esenzioni-paziente-selezione-gestione-codici-cifrati@1e35733c0218'],
  [24, 'anchor:web:web-24-catalogo-farmaci-aifa-ricerca-validazione-prontuario@1e35733c0218'],
  [25, 'anchor:web:web-25-ricerca-icd-in-app-per-codifica-diagnosi@1e35733c0218'],
  [26, 'anchor:web:web-26-ricerca-terminologica-generale-icd-systems-oltre-in-app@1e35733c0218'],
  [27, 'anchor:web:web-27-selezione-scope-ambulatorio-attivo@1e35733c0218'],
  [28, 'anchor:web:web-28-gestione-anagrafica-ambulatori-create-update-predefinita-svuota-@1e35733c0218'],
  [29, 'anchor:web:web-29-cruscotto-analytics-locale-popolazione-eta-diagnosi-adi@1e35733c0218'],
  [30, 'anchor:web:web-30-pannello-audit-operativo-locale@1e35733c0218'],
  [31, 'anchor:web:web-31-apertura-portali-regionali-siss-fse-context-panel-handoff-diary@1e35733c0218'],
  [32, 'anchor:web:web-32-cockpit-shell-rail-navigazione-globale-toolbar-deep-link@1e35733c0218'],
  [33, 'anchor:web:web-33-agenda-di-oggi-turno-bridge-candidati-agenda-clinica@1e35733c0218'],
  [34, 'anchor:web:web-34-diario-clinico-globale-cross-paziente-ultime-50-voci@1e35733c0218'],
  [35, 'anchor:web:web-35-cruscotto-repertori-clinici-aifa-esenzioni-icd-freschezza@1e35733c0218'],
  [36, 'anchor:web:web-36-wizard-nuova-scheda-da-documento-pdfimporter-review-form@1e35733c0218'],
  [37, 'anchor:web:web-37-pairing-login-operatore-pin-deriva-master-key@1e35733c0218'],
  [38, 'anchor:web:web-38-cambio-pin-gestione-ciclo-di-vita-chiave-rewrap-reset@1e35733c0218'],
  [39, 'anchor:web:web-39-blocco-sessione-immediato-stato-sessione@1e35733c0218'],
  [40, 'anchor:web:web-40-profilo-medico-ambulatorio-nome-mostrato-su-documenti@1e35733c0218'],
  [41, 'anchor:web:web-41-preferenze-ui-tema-light-dark-system-riduci-movimento@1e35733c0218'],
  [42, 'anchor:web:web-42-modalita-privacy-redazione-dati@1e35733c0218'],
  [43, 'anchor:web:web-43-conversazioni-ai-e-messaggi@1e35733c0218'],
  [44, 'anchor:web:web-44-configurazione-invocazione-runtime-ai-ollama-modelli-kill-switch@1e35733c0218'],
  [45, 'anchor:web:web-45-cache-pazienti-cifrata-offline-consultazione-degradata@1e35733c0218'],
  [46, 'anchor:web:web-46-backup-schedulazione-automatica-ripristino-manuale@1e35733c0218'],
  [47, 'anchor:web:web-47-diagnostica-architettura-servizi-diagnostic-hub-service-health@1e35733c0218'],
  [48, 'anchor:web:web-48-update-awareness-aggiornamenti-software@1e35733c0218'],
  [49, 'anchor:web:web-49-repertori-import-csv-aifa-gestione-db-esenzioni@1e35733c0218'],
  [50, 'anchor:web:web-50-modelli-ai-pull-modello-ollama-profilo-hardware@1e35733c0218'],
  [51, 'anchor:web:web-51-kill-switch-funzioni-ai-stato-read-only-rilevante-al-client@1e35733c0218'],
  [52, 'anchor:web:web-52-network-operating-mode-gestione-modalita-boundary@1e35733c0218'],
  [53, 'anchor:web:web-53-zona-pericolo-reset-onboarding-sviluppo-seeder-apri-app-nativa-d@1e35733c0218'],
  [54, 'anchor:web:web-54-hub-impostazioni-governance-dashboard-navigazione-settings@1e35733c0218'],
  [55, 'anchor:web:web-55-post-get-api-context-imposta-legge-ambulatory-id-come-cookie-di-@1e35733c0218'],
  [56, 'anchor:web:web-56-validazione-documento-fse-singolo-profilo-payload-via-v1@1e35733c0218'],
  [57, 'anchor:web:web-57-get-api-service-catalog-catalogo-prestazioni-famiglie-distinte-a@1e35733c0218'],
  [58, 'anchor:web:web-58-post-api-proxy-ollama-chat-e-post-api-proxy-ollama-generate-prox@1e35733c0218'],
  [59, 'anchor:web:web-59-get-api-system-mlx-stato-gestione-generico-runtime-mlx-via-pm2-a@1e35733c0218'],
  [60, 'anchor:web:web-60-get-api-system-redaction-stato-health-provider-openmed-per-redaz@1e35733c0218'],
  [61, 'anchor:web:web-61-get-api-system-revision-fingerprint-branch-revisione-build-corre@1e35733c0218'],
  [62, 'anchor:web:web-62-post-get-api-system-fix-orphans-conteggio-riparazione-righe-clin@1e35733c0218'],
  [63, 'anchor:web:web-63-get-api-v1-network-capabilities-api-v1-network-identity-api-v1-n@1e35733c0218'],
  [64, 'anchor:web:web-64-settings-ai-hub-redirect-al-registro-fabric-vista-reale-in-sola-@1e35733c0218'],
  [65, 'anchor:web:web-65-registro-intelligence-fabric-16-capability-4-venue-osservate-e-p@1e35733c0218'],
  [66, 'anchor:web:web-66-governance-ai-parliament-dei-modelli-e-prontezza-al-rollout@1e35733c0218'],
] as const;

const catalog: HeadlessCanonicalCapabilityDescriptor[] = [];
const byAnchor = new Map<string, HeadlessCanonicalCapabilityDescriptor>();
for (const [sourceRow, anchorId] of ANCHORS) {
  const item = record({
    schema: 'mediflow.headless.canonical-capability-descriptor.v1' as const,
    anchorId, sourceRow, manualDisposition: 'manual_only' as const,
    grantability: 'not_grantable' as const, stage: 'unresolved' as const,
    unresolved: UNRESOLVED, operationId: null, applicationServiceRef: null,
    applyPolicy: 'none' as const, writesPerformed: 0 as const, evidence: EVIDENCE,
  });
  catalog.push(item);
  byAnchor.set(anchorId, item);
}

export const HEADLESS_CANONICAL_CAPABILITY_DESCRIPTORS = list(catalog);

/** Resolves only an exact canonical anchor. It never normalizes, infers, or grants. */
export function resolveHeadlessCanonicalCapability(anchorId: unknown): HeadlessCanonicalCapabilityDescriptor | null {
  return typeof anchorId === 'string' ? byAnchor.get(anchorId) ?? null : null;
}
