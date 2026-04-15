/* @Codex */
export const SISS_URLS = {
    MENU: 'https://operatorisiss.servizirl.it/menusiss/',
    PRESCRIZIONE: 'https://operatorisiss.servizirl.it/prescrizione/',
    PRESCRIZIONE_COMPILA: 'https://operatorisiss.servizirl.it/prescrizione/#compila-ricetta-page-1',
    FSE: 'https://operatorisiss.servizirl.it/fse/',
    ANAGRAFE: 'https://operatorisiss.servizirl.it/anagrafe/',
} as const;

/* @Codex */
export const SISS_ACTION_URLS = {
    'menu.open': SISS_URLS.MENU,
    'prescription.create': SISS_URLS.PRESCRIZIONE_COMPILA,
    'fse.lookup': SISS_URLS.FSE,
    'registry.lookup': SISS_URLS.ANAGRAFE,
} as const;
