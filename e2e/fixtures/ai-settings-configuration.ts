import { AI_CONFIGURATION_KEYS } from '../../lib/ai-settings-configuration';
import { isValidInsightSetting } from '../../lib/settings-value';

export function applyAiConfigurationMock(config: Record<string, unknown>, body: unknown, failSave: boolean) {
    const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
    const exact = (value: unknown): value is Record<string, unknown> => record(value)
        && Object.keys(value).length === AI_CONFIGURATION_KEYS.length && AI_CONFIGURATION_KEYS.every(key => Object.hasOwn(value, key));
    if (!record(body) || Object.keys(body).length !== 2 || !exact(body.expectedValues) || !exact(body.values)) {
        return { status: 400, json: { code: 'input_invalid' } };
    }
    const { expectedValues, values } = body;
    if (!AI_CONFIGURATION_KEYS.every(key => (expectedValues[key] === null || typeof expectedValues[key] === 'string')
        && typeof values[key] === 'string' && isValidInsightSetting(key, values[key]))) {
        return { status: 400, json: { code: 'input_invalid' } };
    }
    if (AI_CONFIGURATION_KEYS.some(key => (config[key] ?? null) !== expectedValues[key])) {
        return { status: 409, json: { code: 'AI_CONFIGURATION_CONFLICT' } };
    }
    if (failSave) return { status: 503, json: { error: 'Synthetic save not confirmed' } };
    Object.assign(config, values);
    return { status: 200, json: { success: true, values } };
}
