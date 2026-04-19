/* @Codex */
export type AiRolloutGuardLane =
    | 'patient_insight'
    | 'smart_import'
    | 'redaction'
    | 'clinical_entities'
    | 'generative_challenger';

export type AiRolloutGuardPayload = {
    lanes: Array<{
        lane: AiRolloutGuardLane;
        available: boolean;
        report: {
            status?: 'hold' | 'shadow-ready' | 'rollback-required';
            selectedModel?: string | null;
            blockers?: Array<{ id?: string; message?: string }>;
        } | null;
    }>;
    localControls?: Array<{
        lane: 'patient_insight' | 'smart_import' | 'document_synthesis';
        label: string;
        state: 'enabled' | 'disabled';
    }>;
};

export type AiRolloutGuardSelection = {
    roleId: 'clinical' | 'reasoning';
    roleLabel: string;
    model: string;
};

export type AiRolloutModelGuard = {
    model: string;
    status: 'hold' | 'rollback-required';
    roles: string[];
    lanes: string[];
    blockerMessages: string[];
};

export type AiRolloutLocalControlGuard = {
    lane: 'patient_insight' | 'smart_import' | 'document_synthesis';
    label: string;
    roles: string[];
    state: 'disabled';
};

const LANE_LABELS: Record<AiRolloutGuardLane, string> = {
    patient_insight: 'Patient Insight',
    smart_import: 'Smart Import',
    redaction: 'Redaction',
    clinical_entities: 'Clinical Entities',
    generative_challenger: 'Generative Challenger',
};

function normalizeModelName(value?: string | null) {
    const normalized = value?.trim();
    return normalized ? normalized : null;
}

const LOCAL_CONTROL_LANES_BY_ROLE: Record<AiRolloutGuardSelection['roleId'], Array<'patient_insight' | 'smart_import' | 'document_synthesis'>> = {
    clinical: ['patient_insight', 'smart_import', 'document_synthesis'],
    reasoning: [],
};

function pickHigherSeverity(
    left: AiRolloutModelGuard['status'],
    right: AiRolloutModelGuard['status'],
): AiRolloutModelGuard['status'] {
    return left === 'rollback-required' || right === 'rollback-required'
        ? 'rollback-required'
        : 'hold';
}

export function collectAiRolloutModelGuards(
    payload: AiRolloutGuardPayload | null,
    selections: AiRolloutGuardSelection[],
): AiRolloutModelGuard[] {
    if (!payload) return [];

    const selectedByModel = new Map<string, AiRolloutGuardSelection[]>();
    for (const selection of selections) {
        const model = normalizeModelName(selection.model);
        if (!model) continue;
        const bucket = selectedByModel.get(model) || [];
        bucket.push(selection);
        selectedByModel.set(model, bucket);
    }

    const guards = new Map<string, AiRolloutModelGuard>();

    for (const laneEntry of payload.lanes) {
        if (!laneEntry.available || !laneEntry.report) continue;

        const status = laneEntry.report.status;
        if (status !== 'hold' && status !== 'rollback-required') continue;

        const model = normalizeModelName(laneEntry.report.selectedModel);
        if (!model) continue;

        const selectionsForModel = selectedByModel.get(model);
        if (!selectionsForModel || selectionsForModel.length === 0) continue;

        const existing = guards.get(model);
        const blockerMessages = (laneEntry.report.blockers || [])
            .map((blocker) => blocker.message?.trim())
            .filter((message): message is string => Boolean(message));

        if (!existing) {
            guards.set(model, {
                model,
                status,
                roles: [...new Set(selectionsForModel.map((selection) => selection.roleLabel))],
                lanes: [LANE_LABELS[laneEntry.lane]],
                blockerMessages,
            });
            continue;
        }

        guards.set(model, {
            model,
            status: pickHigherSeverity(existing.status, status),
            roles: [...new Set([...existing.roles, ...selectionsForModel.map((selection) => selection.roleLabel)])],
            lanes: existing.lanes.includes(LANE_LABELS[laneEntry.lane])
                ? existing.lanes
                : [...existing.lanes, LANE_LABELS[laneEntry.lane]],
            blockerMessages: [...new Set([...existing.blockerMessages, ...blockerMessages])],
        });
    }

    return [...guards.values()].sort((left, right) => {
        if (left.status !== right.status) {
            return left.status === 'rollback-required' ? -1 : 1;
        }
        return left.model.localeCompare(right.model);
    });
}

export function collectAiRolloutLocalControlGuards(
    payload: AiRolloutGuardPayload | null,
    selections: AiRolloutGuardSelection[],
): AiRolloutLocalControlGuard[] {
    if (!payload?.localControls?.length) return [];

    const rolesByLane = new Map<'patient_insight' | 'smart_import' | 'document_synthesis', string[]>();
    for (const selection of selections) {
        for (const lane of LOCAL_CONTROL_LANES_BY_ROLE[selection.roleId]) {
            const existing = rolesByLane.get(lane) || [];
            if (!existing.includes(selection.roleLabel)) {
                existing.push(selection.roleLabel);
            }
            rolesByLane.set(lane, existing);
        }
    }

    return payload.localControls
        .filter((control): control is NonNullable<AiRolloutGuardPayload['localControls']>[number] => control.state === 'disabled')
        .filter((control) => (rolesByLane.get(control.lane)?.length || 0) > 0)
        .map((control) => ({
            lane: control.lane,
            label: control.label,
            roles: rolesByLane.get(control.lane) || [],
            state: 'disabled' as const,
        }))
        .sort((left, right) => left.label.localeCompare(right.label));
}
