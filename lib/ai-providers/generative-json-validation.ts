import { fromJSONSchema } from 'zod';
import { GENERATIVE_JSON_SCHEMAS, type GenerativeResponseFormat } from './generative-json-schemas';

const validators = new Map<GenerativeResponseFormat, ReturnType<typeof fromJSONSchema>>();
export function validateGenerativeJson(responseFormat: GenerativeResponseFormat, content: string): void {
    let validator = validators.get(responseFormat);
    if (!validator) {
        validator = fromJSONSchema(GENERATIVE_JSON_SCHEMAS[responseFormat] as Parameters<typeof fromJSONSchema>[0]);
        validators.set(responseFormat, validator);
    }
    validator.parse(JSON.parse(content));
}
