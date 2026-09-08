/* @Codex UI06: deliberately non-clinical instrument; never part of SCALES. */
import { withValidatedScoring } from '../../lib/scale-validation';

export const syntheticScale = withValidatedScoring({
    id: 'ui06-synthetic',
    title: 'Questionario sintetico UI06',
    description: 'Fixture di interazione, non uno strumento clinico.',
    questions: [
        { id: 'choice', text: 'Scelta sintetica', type: 'choice', options: [
            { label: 'Opzione zero', value: 0 }, { label: 'Opzione uno', value: 1 },
        ] },
        { id: 'boolean', text: 'Conferma sintetica', type: 'boolean' },
        { id: 'number', text: 'Numero sintetico', type: 'number', minScore: 0, maxScore: 5 },
        { id: 'note', text: 'Nota sintetica facoltativa', type: 'text', optional: true },
    ],
    scoringLogic: answers => Number(answers.choice) + Number(answers.boolean) + Number(answers.number),
    interpretation: score => `Esito sintetico: ${score}`,
});
