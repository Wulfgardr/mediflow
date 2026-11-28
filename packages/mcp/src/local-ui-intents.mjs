export const LOCAL_UI_INTENT = Object.freeze({
  search: 'search',
  identity: 'identity',
  history: 'history',
  prescribing: 'prescribing',
  patient_insight: 'patient_insight',
  document_synthesis: 'document_synthesis',
  smart_import: 'smart_import',
});

export const isLocalUiIntent = value => typeof value === 'string' && Object.hasOwn(LOCAL_UI_INTENT, value);
