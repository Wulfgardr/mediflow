/* @Codex */
import type { SissAction } from './siss-actions';

/* @Codex */
export const SISS_URLS = {
    MENU: 'https://operatorisiss.servizirl.it/menusiss/',
    PRESCRITTIVO_REGIONALE: 'https://operatorisiss.servizirl.it/prescrittivoRegionale/pages/dashboard',
    // Deprecated: riferimento storico alla root jsonBroker; il menu SISS resta raggiungibile via menu.open.
    PRESCRIZIONE_WEBAPP: 'https://operatorisiss.servizirl.it/prescrizione/',
    PROTESICA_RL: 'https://operatorisiss.servizirl.it/assistantrl/home/',
    FSE: 'https://operatorisiss.servizirl.it/fse/',
    ANAGRAFE: 'https://operatorisiss.servizirl.it/anagrafe/',
} as const;

/* @Codex */
export const SISS_ACTION_URLS: Record<SissAction, string> = {
    'menu.open': SISS_URLS.MENU,
    'prescription.create': SISS_URLS.PRESCRITTIVO_REGIONALE,
    'prosthetics.open': SISS_URLS.PROTESICA_RL,
    'fse.lookup': SISS_URLS.FSE,
    'registry.lookup': SISS_URLS.ANAGRAFE,
} as const;
