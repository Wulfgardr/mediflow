import { z } from 'zod';

export const TERRITORIAL_PACK_SCHEMA = 'mediflow.territorial-packs.v1' as const;
export const TERRITORIAL_PACK_SETTING_KEY = 'territorial.packs';
export const TERRITORIAL_PACK_INITIALIZATION_KEY = 'territorial.packs.initialization';
export const TERRITORIAL_PACK_OWNER = 'host-territorial-pack-manager';
export const TERRITORIAL_PACK_PRESETS = ['core', 'core+it', 'core+it+lom'] as const;
export type TerritorialPackPreset = typeof TERRITORIAL_PACK_PRESETS[number];
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
const stateSchema = z.object({ schemaVersion: z.literal(TERRITORIAL_PACK_SCHEMA), revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    preset: z.enum(TERRITORIAL_PACK_PRESETS) }).strict();
const commandSchema = z.object({ schemaVersion: z.literal(TERRITORIAL_PACK_SCHEMA), expectedRevision: revision,
    preset: z.enum(TERRITORIAL_PACK_PRESETS), confirmed: z.literal(true) }).strict();
export type TerritorialPackCommand = z.infer<typeof commandSchema>;
export type TerritorialPackCapability = { schemaVersion: typeof TERRITORIAL_PACK_SCHEMA; revision: number | null;
    preset: TerritorialPackPreset; status: 'ready' | 'configuration_error' };

export class TerritorialPackError extends Error {
    constructor(readonly code: 'input_invalid' | 'configuration_error' | 'conflict' | 'channel_denied' | 'pack_disabled') {
        super(code);
    }
}
export function parseTerritorialPackCommand(input: unknown): TerritorialPackCommand {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) throw new TerritorialPackError('input_invalid');
    return parsed.data;
}
export function projectTerritorialPacks(raw: string | undefined): TerritorialPackCapability {
    if (raw === undefined) return { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 0, preset: 'core', status: 'ready' };
    try {
        const state = stateSchema.parse(JSON.parse(raw));
        return { ...state, status: 'ready' };
    } catch { return { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: null, preset: 'core', status: 'configuration_error' }; }
}
