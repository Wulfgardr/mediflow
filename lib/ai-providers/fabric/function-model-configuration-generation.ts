export const FUNCTION_MODEL_CONFIGURATION_GENERATION_KEY = 'ai.fabric.configurationGeneration';
export function readFunctionModelConfigurationGeneration(value: string | undefined): string {
    if (value === undefined) return '0';
    if (!/^(0|[1-9][0-9]{0,127})$/u.test(value)) throw new Error('Invalid function configuration generation');
    return value;
}
export function nextFunctionModelConfigurationGeneration(value: string | undefined): string {
    return readFunctionModelConfigurationGeneration((BigInt(readFunctionModelConfigurationGeneration(value)) + BigInt(1)).toString());
}
