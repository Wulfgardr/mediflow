// The fixed configuration saved by Modelli and Funzioni IA. This is not a generic settings writer.
export const AI_CONFIGURATION_KEYS = [
    'hardwareProfile', 'aiProvider', 'aiModel_clinical', 'aiModel_reasoning', 'aiModel', 'aiUrl', 'ollamaUrl',
    'documentRouterControlFlow', 'aiPatientInsightKillSwitch', 'aiDocumentSynthesisKillSwitch',
    'aiSmartImportKillSwitch', 'aiInsightMode', 'aiInsightManualConfig',
] as const;
export type AiConfigurationKey = typeof AI_CONFIGURATION_KEYS[number];
export type AiConfigurationSnapshot = Record<AiConfigurationKey, string | null>;
