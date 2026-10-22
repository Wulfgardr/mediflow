export const TERRITORIAL_PACK_SCHEMA = 'mediflow.territorial-packs.v1' as const;
export const TERRITORIAL_PACK_PRESETS = ['core', 'core+it', 'core+it+lom'] as const;
export type TerritorialPackPreset = typeof TERRITORIAL_PACK_PRESETS[number];
export type TerritorialPackCapability = { schemaVersion: typeof TERRITORIAL_PACK_SCHEMA; revision: number | null;
    preset: TerritorialPackPreset; status: 'ready' | 'configuration_error' };

export function createDefaultTerritorialPackCapability(): TerritorialPackCapability {
    return { schemaVersion: TERRITORIAL_PACK_SCHEMA, revision: 0, preset: 'core', status: 'ready' };
}
