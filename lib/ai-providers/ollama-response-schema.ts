export type OllamaSchemaEndpoint = 'tags' | 'show' | 'ps';

type FieldSchema =
    | 'open'
    | 'scalar'
    | Readonly<{ fields: Readonly<Record<string, FieldSchema>> }>
    | Readonly<{ items: FieldSchema }>
    | Readonly<{ oneOf: readonly string[] }>;

const object = (fields: Record<string, FieldSchema>): FieldSchema => Object.freeze({ fields: Object.freeze(fields) });
const list = (items: FieldSchema): FieldSchema => Object.freeze({ items });
const scalars = (...names: string[]) => Object.fromEntries(names.map((name) => [name, 'scalar' as const]));

const MODEL_DETAILS = object({
    ...scalars('parent_model', 'format', 'family', 'parameter_size', 'quantization_level', 'context_length', 'embedding_length', 'runner'),
    families: list('scalar'),
});
const TOOL_CALL = object({
    id: 'scalar',
    function: object({ ...scalars('index', 'name'), arguments: 'open' }),
});
const CAPABILITIES = list(Object.freeze({ oneOf: Object.freeze([
    'completion', 'tools', 'insert', 'vision', 'embedding', 'thinking', 'image', 'audio', 'decision', 'speech',
]) }));

export const OLLAMA_0_40_RESPONSE_SCHEMAS: Readonly<Record<OllamaSchemaEndpoint, FieldSchema>> = Object.freeze({
    tags: object({
        models: list(object({
            ...scalars('name', 'model', 'remote_model', 'remote_host', 'modified_at', 'size', 'digest'),
            details: MODEL_DETAILS,
            capabilities: CAPABILITIES,
        })),
    }),
    show: object({
        ...scalars(
            'license', 'modelfile', 'parameters', 'template', 'system', 'renderer', 'parser', 'template_source',
            'remote_model', 'remote_host', 'modified_at', 'requires',
        ),
        model_info: 'open',
        projector_info: 'open',
        voices: list('scalar'),
        thinking: object({ values: list('scalar'), default: 'scalar' }),
        details: MODEL_DETAILS,
        messages: list(object({
            ...scalars('role', 'content', 'thinking', 'tool_name', 'tool_call_id'),
            images: list('scalar'),
            tool_calls: list(TOOL_CALL),
        })),
        tensors: list(object({ ...scalars('name', 'type'), shape: list('scalar') })),
        capabilities: CAPABILITIES,
        manifests: list(object(scalars('digest', 'runner', 'format', 'selected'))),
    }),
    ps: object({
        models: list(object({
            ...scalars('name', 'model', 'size', 'digest', 'expires_at', 'size_vram', 'context_length', 'runner'),
            ...scalars('remote_model', 'remote_host'),
            details: MODEL_DETAILS,
        })),
    }),
});

const FIELD_LABEL_MAX = 120;
const printable = (value: string) => value.replace(/[^\w.-]/g, '?').slice(0, 48);

function firstUnknownField(value: unknown, schema: FieldSchema, path: string): string | null {
    if (schema === 'open' || value === null) return null;
    if (schema === 'scalar') return typeof value === 'object' ? `${path}:non_scalar` : null;
    if ('oneOf' in schema) {
        if (typeof value !== 'string') return `${path}:non_string`;
        return schema.oneOf.includes(value) ? null : `${path}=${printable(value)}`;
    }
    if ('items' in schema) {
        if (!Array.isArray(value)) return `${path}:non_array`;
        for (const item of value) {
            const unknown = firstUnknownField(item, schema.items, `${path}[]`);
            if (unknown) return unknown;
        }
        return null;
    }
    if (typeof value !== 'object' || Array.isArray(value)) return `${path || '.'}:non_object`;
    for (const [key, child] of Object.entries(value)) {
        const label = printable(key) || '""';
        const childPath = path ? `${path}.${label}` : label;
        if (!Object.hasOwn(schema.fields, key)) return childPath;
        const unknown = firstUnknownField(child, schema.fields[key], childPath);
        if (unknown) return unknown;
    }
    return null;
}

export function findUnknownOllamaField(endpoint: OllamaSchemaEndpoint, response: unknown): string | null {
    const field = firstUnknownField(response, OLLAMA_0_40_RESPONSE_SCHEMAS[endpoint], '');
    return field === null ? null : field.slice(0, FIELD_LABEL_MAX);
}
