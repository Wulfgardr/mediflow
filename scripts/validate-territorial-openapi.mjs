import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

export const loadTerritorialPackSpec = file => yaml.load(readFileSync(file, 'utf8'));

export function validateTerritorialPackExamples(document, examples) {
    const validate = new Ajv({ allErrors: true }).compile(document.components.schemas.TerritorialPackCapability);
    for (const example of examples) {
        if (!validate(example)) throw new Error(`TerritorialPackCapability rejects ${example.status}: ${JSON.stringify(validate.errors)}`);
    }
}
