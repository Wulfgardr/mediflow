/* @Codex */
import { z } from 'zod';

export const WORK_PROFILE_SETTING_KEY = 'onboarding.workProfile';
export const WORK_PROFILES = ['interactive', 'agent', 'both'] as const;
export type WorkProfile = typeof WORK_PROFILES[number];
export const WORK_PROFILE_LABELS: Record<WorkProfile, string> = {
    interactive: 'Interactive', agent: 'Agent', both: 'Entrambi',
};

const answersSchema = z.object({
    activity: z.enum(['records', 'organization', 'repetitive']).nullable(),
    interaction: z.enum(['screens', 'delegate', 'mixed', 'unsure']).nullable(),
    platform: z.enum(['macos', 'windows', 'linux', 'other']).nullable(),
}).strict();
export type WorkProfileAnswers = z.infer<typeof answersSchema>;
export const EMPTY_WORK_PROFILE_ANSWERS: WorkProfileAnswers = {
    activity: null, interaction: null, platform: null,
};
const selectionSchema = z.object({
    profile: z.enum(WORK_PROFILES),
    source: z.enum(['guided', 'manual']),
    answers: answersSchema,
}).strict();
export type WorkProfileSelection = z.infer<typeof selectionSchema>;
const draftSchema = selectionSchema.extend({ step: z.number().int().min(0).max(3) }).strict();
export type WorkProfileDraft = z.infer<typeof draftSchema>;
const commandSchema = z.object({
    id: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
    action: z.enum(['save-draft', 'confirm', 'discard-draft', 'rollback']),
    draft: draftSchema.optional(),
}).strict().refine((value) => (value.action === 'save-draft') === (value.draft !== undefined));
export type WorkProfileCommand = z.infer<typeof commandSchema>;
const stateSchema = z.object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    active: selectionSchema.nullable(),
    previous: selectionSchema.nullable(),
    canRollback: z.boolean(),
    draft: draftSchema.nullable(),
    lastCommand: commandSchema.nullable(),
}).strict();
export type WorkProfileState = z.infer<typeof stateSchema>;

export class WorkProfileError extends Error {
    constructor(public readonly code: 'input_invalid' | 'state_invalid' | 'conflict' | 'preview_required' | 'rollback_unavailable') {
        super(code);
    }
}

export function emptyWorkProfileState(): WorkProfileState {
    return { schemaVersion: 1, revision: 0, active: null, previous: null,
        canRollback: false, draft: null, lastCommand: null };
}

export function parseWorkProfileState(value: unknown): WorkProfileState {
    const result = stateSchema.safeParse(value);
    if (!result.success) throw new WorkProfileError('state_invalid');
    return result.data;
}

export function parseWorkProfileCommand(value: unknown): WorkProfileCommand {
    const result = commandSchema.safeParse(value);
    if (!result.success) throw new WorkProfileError('input_invalid');
    return result.data;
}

export function recommendWorkProfile(answers: WorkProfileAnswers): { profile: WorkProfile; reason: string } {
    if (answers.interaction === 'delegate') return { profile: 'agent',
        reason: 'Preferisci preparare attività con un agente e rivederne il risultato. Il collegamento a un host resta un passaggio separato.' };
    if (answers.interaction === 'mixed') return { profile: 'both',
        reason: 'Vuoi alternare schermate e supporto di un agente, mantenendo la revisione nella cartella.' };
    if (answers.interaction === 'unsure' && answers.activity === 'repetitive') return { profile: 'both',
        reason: 'Per organizzare attività ripetitive puoi iniziare dalle schermate e valutare in seguito il supporto di un agente.' };
    return { profile: 'interactive',
        reason: answers.interaction === 'screens'
            ? 'Preferisci usare direttamente le schermate e confermare ogni operazione nella cartella.'
            : 'Puoi iniziare dalle schermate già disponibili e cambiare profilo quando avrai definito il tuo modo di lavorare.' };
}

export function workProfileStartArea(selection: WorkProfileSelection | null): 'turno' | 'incarico' | 'governance' {
    if (selection?.profile === 'agent') return 'governance';
    if (selection?.profile === 'interactive' && selection.answers.activity === 'records') return 'incarico';
    return 'turno';
}

export function workProfilePreview(selection: WorkProfileSelection) {
    const area = workProfileStartArea(selection);
    return {
        area,
        areaLabel: area === 'incarico' ? 'Lista pazienti' : area === 'governance' ? 'Sistema e impostazioni' : 'Turno',
        agentNote: 'La guida non collega né verifica un agente. La preferenza salvata non attesta un’integrazione disponibile.',
        platformNote: selection.answers.platform === 'macos'
            ? 'Su Mac sono presenti percorsi Web e applicazioni native separate. Le funzioni locali facoltative e il collegamento a un agente richiedono verifiche proprie.'
            : selection.answers.platform === 'windows' || selection.answers.platform === 'linux'
                ? 'Su questo sistema puoi proseguire nella cartella Web. L’installazione locale e il collegamento a un agente richiedono una verifica dedicata; un’app desktop completa non è attestata dalla guida.'
                : 'La disponibilità nel browser non prova installazione, adapter locali o collegamento a un host sul tuo sistema.',
    };
}

export function applyWorkProfileCommand(current: WorkProfileState, input: unknown): WorkProfileState {
    const command = parseWorkProfileCommand(input);
    if (current.lastCommand?.id === command.id) {
        if (JSON.stringify(current.lastCommand) !== JSON.stringify(command)) throw new WorkProfileError('conflict');
        return current;
    }
    if (current.revision !== command.expectedRevision) throw new WorkProfileError('conflict');
    const next = { ...current, revision: current.revision + 1, lastCommand: command };
    if (command.action === 'save-draft') next.draft = command.draft!;
    if (command.action === 'discard-draft') next.draft = null;
    if (command.action === 'confirm') {
        const draft = current.draft;
        if (!draft || draft.step !== 3 || (draft.source === 'guided' && Object.values(draft.answers).some((v) => v === null))) {
            throw new WorkProfileError('preview_required');
        }
        const selection = selectionSchema.parse({ profile: draft.profile, source: draft.source, answers: draft.answers });
        if (JSON.stringify(current.active) !== JSON.stringify(selection)) {
            next.previous = current.active;
            next.canRollback = true;
        }
        next.active = selection;
        next.draft = null;
    }
    if (command.action === 'rollback') {
        if (!current.canRollback) throw new WorkProfileError('rollback_unavailable');
        next.active = current.previous;
        next.previous = null;
        next.canRollback = false;
        next.draft = null;
    }
    return next;
}
