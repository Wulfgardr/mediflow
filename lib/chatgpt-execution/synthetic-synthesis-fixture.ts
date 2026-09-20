/* @Codex */
import 'server-only';
import { createHash } from 'node:crypto';
import type { SynthesisInput } from './execution-contract';

// This fixed corpus is the only input of the initial host binding. A caller
// cannot relabel arbitrary patient text as synthetic or supply a file path.
const texts = [
    ['S1', 'Diario dimostrativo, prima rilevazione', 'Caso DEMO interamente sintetico. Prima rilevazione: pressione 128/78 mmHg, frequenza cardiaca 72 al minuto. Il diario non riporta sintomi in questa rilevazione.'],
    ['S2', 'Diario dimostrativo, seconda rilevazione', 'Caso DEMO interamente sintetico. Seconda rilevazione, due giorni dopo: pressione 132/80 mmHg, frequenza cardiaca 76 al minuto. Il diario riporta una breve passeggiata prima della misurazione.'],
    ['S3', 'Limiti delle fonti dimostrative', 'Le fonti del caso DEMO contengono soltanto due rilevazioni sintetiche. Non documentano diagnosi, terapie, esami di laboratorio o decisioni cliniche. Non è indicato un piano di controllo.'],
] as const;
export const CHATGPT_SYNTHESIS_FIXTURE: SynthesisInput = Object.freeze({
    fixtureId: 'mediflow-chatgpt-synthesis-demo-v1',
    sources: Object.freeze(texts.map(([id, title, text]) => Object.freeze({ id, title, text,
        sha256: createHash('sha256').update(text).digest('hex') }))),
});
