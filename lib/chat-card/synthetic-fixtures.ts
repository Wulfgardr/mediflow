import corpus from '../../scripts/fixtures/chat-card-corpus.json' with { type: 'json' };
import { CARD_PROFILE_VERSION, type Card, type CardSelection } from './card-profile';

function freeze<T>(value: T): T {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
    return value;
}
const fixtures = freeze(JSON.parse(JSON.stringify(corpus)) as typeof corpus);
export const SYNTHETIC_CARD_CORPUS_JSON = JSON.stringify(fixtures, null, 2) + '\n';
export const SYNTHETIC_CARD_PATIENTS: readonly string[] = Object.freeze(fixtures.map(value => value.id));
export function syntheticCardFixture(patient: string) {
    const fixture = fixtures.find(value => value.id === patient);
    if (!fixture) throw new Error('synthetic_card_denied');
    return fixture;
}
export function projectSyntheticCard(patient: string, selection: CardSelection, pseudonym: string, sourceRef: string): Card {
    const fixture = syntheticCardFixture(patient);
    return {
        profile: CARD_PROFILE_VERSION, pseudonym,
        history: selection.historyLimit ? [{ condition: fixture.clinical.conditions[0], note: fixture.inputText, relativeTime: 'ultimi_6_mesi', sourceRef }] : [],
        therapies: fixture.clinical.medicines.slice(0, selection.therapyLimit).map(value => ({ medicine: value.name, dose: value.dose, frequency: value.frequency, sourceRef })),
        measures: fixture.clinical.measures.slice(0, selection.measureLimit).map(value => ({ ...value, relativeTime: 'attuale', sourceRef })),
    };
}
