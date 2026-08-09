import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import yaml from 'js-yaml';

const ROOT = process.cwd();
const SPEC_PATH = 'docs/openapi/mediflow-v1.yaml';
const POLICY_PATH = 'docs/openapi/contract-policy.json';
const TYPES_PATH = 'lib/api/v1/types.ts';
const ROUTE_ROOT = 'app/api/v1';
const SPEC_METHODS = ['get', 'post', 'put', 'patch', 'delete'];
const ROUTE_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

function git(args, options = {}) {
    try {
        return execFileSync('git', args, {
            cwd: ROOT,
            encoding: 'utf8',
            stdio: ['pipe', 'pipe', 'pipe']
        }).trim();
    } catch (error) {
        if (options.allowFailure) return null;
        throw error;
    }
}

function parseArgs(argv) {
    const options = { baseRef: process.env.MEDIFLOW_OPENAPI_BASE_REF || 'main' };
    for (let index = 0; index < argv.length; index += 1) {
        if (argv[index] === '--base-ref' && argv[index + 1]) {
            options.baseRef = argv[index + 1];
            index += 1;
        }
    }
    return options;
}

function routeFileToPath(filePath) {
    const relativePath = path.relative(ROUTE_ROOT, filePath);
    const directory = path.dirname(relativePath);
    if (directory === '.') return '/api/v1';
    return `/api/v1/${directory.split(path.sep).map((segment) => (
        segment.startsWith('[') && segment.endsWith(']')
            ? `{${segment.slice(1, -1)}}`
            : segment
    )).join('/')}`;
}

function extractMethods(source) {
    return ROUTE_METHODS.filter((method) => (
        new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\b`).test(source)
    ));
}

function buildCurrentRoutes() {
    const routes = new Map();
    const routeFiles = [];
    for (const filePath of walkRoutes(path.join(ROOT, ROUTE_ROOT))) {
        routeFiles.push(filePath);
        const source = fs.readFileSync(filePath, 'utf8');
        const hasLocalTokenGuard = source.includes('requireLocalApiToken(');
        const hasPairedClientGuard = source.includes('authenticateNetworkPairedClient(')
            || source.includes('requireNetworkCapabilityContext(')
            || source.includes('requireNetworkWriteContext(')
            || source.includes('requireNetworkDiscoveryAuth(');
        if (!hasLocalTokenGuard && !hasPairedClientGuard) {
            throw new Error(
                `${path.relative(ROOT, filePath)} is missing a recognized /api/v1 auth guard`
            );
        }
        const apiPath = routeFileToPath(path.relative(ROOT, filePath));
        for (const method of extractMethods(source)) {
            routes.set(`${method} ${apiPath}`, {
                method,
                path: apiPath,
                file: path.relative(ROOT, filePath)
            });
        }
    }
    return { routes, routeFiles };
}

function* walkRoutes(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            yield* walkRoutes(entryPath);
            continue;
        }
        if (entry.isFile() && entry.name === 'route.ts') {
            yield entryPath;
        }
    }
}

function buildRefRoutes(baseRef) {
    const filesOutput = git(['ls-tree', '-r', '--name-only', baseRef, '--', ROUTE_ROOT], { allowFailure: true });
    if (!filesOutput) return null;
    const routes = new Map();
    for (const filePath of filesOutput.split('\n').filter((value) => value.endsWith('/route.ts'))) {
        const source = git(['show', `${baseRef}:${filePath}`], { allowFailure: true });
        if (!source) continue;
        const apiPath = routeFileToPath(filePath);
        for (const method of extractMethods(source)) {
            routes.set(`${method} ${apiPath}`, { method, path: apiPath, file: filePath });
        }
    }
    return routes;
}

function loadYamlFile(filePath) {
    return yaml.load(fs.readFileSync(path.join(ROOT, filePath), 'utf8'));
}

function loadYamlFromRef(baseRef, filePath) {
    const source = git(['show', `${baseRef}:${filePath}`], { allowFailure: true });
    if (!source) return null;
    return yaml.load(source);
}

function stable(value) {
    if (Array.isArray(value)) {
        return value.map(stable);
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.keys(value).sort().map((key) => [key, stable(value[key])])
        );
    }
    return value ?? null;
}

function resolveRef(document, ref) {
    if (!ref || !ref.startsWith('#/')) return null;
    return ref.slice(2).split('/').reduce((current, segment) => current?.[segment], document);
}

function normalizeSchema(schema, document, seen = new Set()) {
    if (!schema) return null;
    if (schema.$ref) {
        if (seen.has(schema.$ref)) return { ref: schema.$ref };
        return {
            ref: schema.$ref,
            resolved: normalizeSchema(resolveRef(document, schema.$ref), document, new Set(seen).add(schema.$ref))
        };
    }

    const normalized = {};
    for (const key of ['type', 'format', 'nullable', 'additionalProperties']) {
        if (schema[key] !== undefined) normalized[key] = stable(schema[key]);
    }
    if (schema.enum) normalized.enum = [...schema.enum];
    if (schema.required) normalized.required = [...schema.required].sort();
    if (schema.items) normalized.items = normalizeSchema(schema.items, document, seen);
    if (schema.properties) {
        normalized.properties = Object.fromEntries(
            Object.keys(schema.properties).sort().map((key) => [key, normalizeSchema(schema.properties[key], document, seen)])
        );
    }
    for (const key of ['oneOf', 'anyOf', 'allOf']) {
        if (schema[key]) normalized[key] = schema[key].map((item) => normalizeSchema(item, document, seen));
    }
    return normalized;
}

function normalizeResponse(response, document) {
    const resolved = response?.$ref ? resolveRef(document, response.$ref) : response;
    const content = resolved?.content ?? {};
    return {
        content: Object.fromEntries(
            Object.keys(content).sort().map((type) => [type, normalizeSchema(content[type]?.schema, document)])
        )
    };
}

function normalizeRequestBody(requestBody, document) {
    const resolved = requestBody?.$ref ? resolveRef(document, requestBody.$ref) : requestBody;
    const content = resolved?.content ?? {};
    return {
        required: resolved?.required ?? false,
        content: Object.fromEntries(
            Object.keys(content).sort().map((type) => [type, normalizeSchema(content[type]?.schema, document)])
        )
    };
}

function normalizeSpec(document) {
    const operations = new Map();
    for (const [apiPath, pathItem] of Object.entries(document?.paths ?? {})) {
        for (const method of SPEC_METHODS) {
            if (!pathItem?.[method]) continue;
            const operation = pathItem[method];
            operations.set(`${method.toUpperCase()} ${apiPath}`, {
                security: stable(operation.security ?? document.security ?? []),
                parameters: stable((operation.parameters ?? []).map((parameter) => ({
                    in: parameter.in,
                    name: parameter.name,
                    required: parameter.required ?? false,
                    schema: normalizeSchema(parameter.schema, document)
                }))),
                requestBody: normalizeRequestBody(operation.requestBody, document),
                responses: stable(Object.fromEntries(
                    Object.keys(operation.responses ?? {}).sort().map((code) => [code, normalizeResponse(operation.responses[code], document)])
                ))
            });
        }
    }
    return operations;
}

// Un nodo `$ref` normalizzato porta la forma vera sotto `resolved`. Va srotolato
// su ENTRAMBI i lati prima del confronto: senza, inlinare un `$ref` senza cambiare
// nulla somiglia all'aggiunta simultanea di tutti i suoi `required`, e rinominare
// uno schema a contenuto identico somiglia a un cambiamento.
function unwrapRef(node) {
    if (node && typeof node === 'object' && node.ref !== undefined && node.resolved !== undefined) {
        return node.resolved;
    }
    return node;
}

// Sul wrapper del request body `required` è un **booleano**, non un elenco di
// proprietà (normalizeRequestBody, riga 181). Senza questa guardia un confronto
// per proprietà ci chiamerebbe sopra `.includes` e lancerebbe.
function requiredSet(schema) {
    return new Set(Array.isArray(schema?.required) ? schema.required : []);
}

// `oneOf`/`anyOf` con le stesse varianti in ordine diverso descrivono lo stesso
// contratto: confrontarli per posizione segnalerebbe ogni variante spostata.
function sameVariantSet(baseList, currentList) {
    const fingerprint = (list) => JSON.stringify(list.map((item) => JSON.stringify(item)).sort());
    return fingerprint(baseList) === fingerprint(currentList);
}

// Forma canonica di uno schema normalizzato: srotola ricorsivamente i `$ref` e
// ordina le varianti dei composite. Serve per il confronto di uguaglianza in testa
// a `schemaDiff`: senza, tre riscritture che non toccano il contratto sul filo —
// inlinare un `$ref`, rinominare uno schema, riordinare un `oneOf` — arriverebbero
// in fondo alla funzione e uscirebbero come `<label> changed`, cioè come breaking
// da derogare a mano. L'identità di un `$ref` e l'ordine delle varianti non sono
// visibili sul filo; quello che c'è dentro sì.
function canonicalSchema(node) {
    if (Array.isArray(node)) return node.map(canonicalSchema);
    if (!node || typeof node !== 'object') return node;
    const unwrapped = unwrapRef(node);
    if (unwrapped !== node) return canonicalSchema(unwrapped);
    const out = {};
    for (const key of Object.keys(node).sort()) {
        if ((key === 'oneOf' || key === 'anyOf' || key === 'allOf') && Array.isArray(node[key])) {
            out[key] = node[key]
                .map((item) => JSON.stringify(canonicalSchema(item)))
                .sort()
                .map((serialized) => JSON.parse(serialized));
        } else {
            out[key] = canonicalSchema(node[key]);
        }
    }
    return out;
}

// I nodi che arrivano qui sono avvolti in strutture che non espongono `properties`:
// `{content}` per le risposte, `{required, content}` per i request body,
// `{ref, resolved}` per i `$ref`. Fino a WUL-545 questa funzione non le attraversava:
// misurato sull'intera storia dello spec, 39 confronti con zero ricorsioni e zero
// proprietà viste, quindi ogni cambiamento collassava nell'unico `<label> changed`
// finale — ed è per questo che tutte le deroghe in contract-policy.json hanno la
// forma grossolana `<operazione> response <codice> changed`. Il confronto per
// proprietà, incluso il ramo `became required` già scritto per le richieste, non è
// mai stato eseguito.
function schemaDiff(rawBaseSchema, rawCurrentSchema, context, label) {
    const baseSchema = unwrapRef(rawBaseSchema);
    const currentSchema = unwrapRef(rawCurrentSchema);
    if (JSON.stringify(canonicalSchema(baseSchema)) === JSON.stringify(canonicalSchema(currentSchema))) {
        return { breaking: [], additive: [] };
    }
    if (!baseSchema || !currentSchema) return { breaking: [`${label} changed shape`], additive: [] };

    const breaking = [];
    const additive = [];

    // Il label non cambia scendendo per media type: le stringhe restano leggibili
    // e stabili, e `compareOperations` deduplica comunque.
    if (baseSchema.content || currentSchema.content) {
        const mediaTypes = new Set([
            ...Object.keys(baseSchema.content ?? {}),
            ...Object.keys(currentSchema.content ?? {})
        ]);
        for (const mediaType of [...mediaTypes].sort()) {
            const nested = schemaDiff(baseSchema.content?.[mediaType], currentSchema.content?.[mediaType], context, label);
            breaking.push(...nested.breaking);
            additive.push(...nested.additive);
        }
    }

    if (baseSchema.items && currentSchema.items) {
        const nested = schemaDiff(baseSchema.items, currentSchema.items, context, `${label}[]`);
        breaking.push(...nested.breaking);
        additive.push(...nested.additive);
    }

    for (const composite of ['oneOf', 'anyOf', 'allOf']) {
        const baseList = baseSchema[composite];
        const currentList = currentSchema[composite];
        if (!baseList || !currentList || sameVariantSet(baseList, currentList)) continue;
        if (baseList.length !== currentList.length) {
            breaking.push(`${label} changed ${composite}`);
            continue;
        }
        for (let index = 0; index < baseList.length; index += 1) {
            const nested = schemaDiff(baseList[index], currentList[index], context, `${label}.${composite}[${index}]`);
            breaking.push(...nested.breaking);
            additive.push(...nested.additive);
        }
    }

    if (baseSchema.properties || currentSchema.properties) {
        const baseProperties = baseSchema.properties ?? {};
        const currentProperties = currentSchema.properties ?? {};
        const baseRequired = requiredSet(baseSchema);
        const currentRequired = requiredSet(currentSchema);

        for (const key of Object.keys(baseProperties).filter((property) => !currentProperties[property])) {
            breaking.push(`${label}.${key} was removed`);
        }
        for (const key of Object.keys(currentProperties).filter((property) => !baseProperties[property])) {
            // Una proprietà nuova e già obbligatoria è una rottura anche su una
            // RISPOSTA, non solo su una richiesta: rompe ogni client che decodifica
            // con un tipo non opzionale. Il client Apple lo è — 47 tipi rigidi, 225
            // proprietà non opzionali, zero `decodeIfPresent` — ed è così che si è
            // rotto con WUL-542.
            if (currentRequired.has(key)) breaking.push(`${label}.${key} became required`);
            else additive.push(`${label}.${key} was added`);
        }
        for (const key of Object.keys(baseProperties).filter((property) => currentProperties[property])) {
            if (currentRequired.has(key) && !baseRequired.has(key)) {
                breaking.push(`${label}.${key} became required`);
            } else if (baseRequired.has(key) && !currentRequired.has(key)) {
                additive.push(`${label}.${key} became optional`);
            }
            const nested = schemaDiff(baseProperties[key], currentProperties[key], context, `${label}.${key}`);
            breaking.push(...nested.breaking);
            additive.push(...nested.additive);
        }
    }

    if (breaking.length || additive.length) return { breaking, additive };
    // I due nodi differiscono ma nessuna regola sa dire in che modo (enum ristretto,
    // `type` cambiato, media type aggiunto): resta il segnale grossolano di prima,
    // che è conservativo e va derogato a mano.
    return { breaking: [`${label} changed`], additive: [] };
}

function compareOperations(baseOperations, currentOperations) {
    const breaking = [];
    const additive = [];

    for (const operationKey of baseOperations.keys()) {
        if (!currentOperations.has(operationKey)) {
            breaking.push(`${operationKey} was removed`);
        }
    }
    for (const operationKey of currentOperations.keys()) {
        if (!baseOperations.has(operationKey)) {
            additive.push(`${operationKey} was added`);
        }
    }

    for (const operationKey of baseOperations.keys()) {
        if (!currentOperations.has(operationKey)) continue;
        const baseOperation = baseOperations.get(operationKey);
        const currentOperation = currentOperations.get(operationKey);
        if (JSON.stringify(baseOperation.security) !== JSON.stringify(currentOperation.security)) {
            breaking.push(`${operationKey} changed auth requirements`);
        }
        if (JSON.stringify(baseOperation.parameters) !== JSON.stringify(currentOperation.parameters)) {
            breaking.push(`${operationKey} changed parameters`);
        }
        if (JSON.stringify(baseOperation.requestBody) !== JSON.stringify(currentOperation.requestBody)) {
            const requestDiff = schemaDiff(baseOperation.requestBody, currentOperation.requestBody, 'request', `${operationKey} request`);
            breaking.push(...(requestDiff.breaking ?? []));
            additive.push(...(requestDiff.additive ?? []));
        }
        for (const responseCode of Object.keys(baseOperation.responses)) {
            if (!currentOperation.responses[responseCode]) {
                breaking.push(`${operationKey} removed response ${responseCode}`);
                continue;
            }
            if (JSON.stringify(baseOperation.responses[responseCode]) !== JSON.stringify(currentOperation.responses[responseCode])) {
                const responseDiff = schemaDiff(
                    baseOperation.responses[responseCode],
                    currentOperation.responses[responseCode],
                    'response',
                    `${operationKey} response ${responseCode}`
                );
                breaking.push(...(responseDiff.breaking ?? []));
                additive.push(...(responseDiff.additive ?? []));
            }
        }
        for (const responseCode of Object.keys(currentOperation.responses)) {
            if (!baseOperation.responses[responseCode]) {
                additive.push(`${operationKey} added response ${responseCode}`);
            }
        }
    }

    return {
        breaking: [...new Set(breaking)],
        additive: [...new Set(additive)]
    };
}

function expandPolicy(policy) {
    const undocumented = new Map();
    for (const entry of policy.undocumentedOperations ?? []) {
        for (const method of entry.methods ?? []) {
            undocumented.set(`${method} ${entry.path}`, entry);
        }
    }
    const overrides = new Set((policy.breakingOverrides ?? []).map((entry) => entry.change));
    return { undocumented, overrides };
}

function collectChangedFiles(baseRef) {
    const changed = new Set();
    const committedOutput = git(['diff', '--name-only', `${baseRef}...HEAD`], { allowFailure: true });
    for (const file of (committedOutput ?? '').split('\n').filter(Boolean)) {
        changed.add(file);
    }

    const workingTreeOutput = git(['diff', '--name-only', 'HEAD'], { allowFailure: true });
    for (const file of (workingTreeOutput ?? '').split('\n').filter(Boolean)) {
        changed.add(file);
    }

    const untrackedOutput = git(['ls-files', '--others', '--exclude-standard'], { allowFailure: true });
    for (const file of (untrackedOutput ?? '').split('\n').filter(Boolean)) {
        changed.add(file);
    }

    return changed;
}

function serializeOperations(operations) {
    return JSON.stringify([...operations.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function main() {
    const { baseRef } = parseArgs(process.argv.slice(2));
    const currentRoutes = buildCurrentRoutes();
    const currentSpec = loadYamlFile(SPEC_PATH);
    const policy = JSON.parse(fs.readFileSync(path.join(ROOT, POLICY_PATH), 'utf8'));
    const documentedOperations = normalizeSpec(currentSpec);
    const { undocumented, overrides } = expandPolicy(policy);
    const errors = [];
    const notes = [];

    for (const operationKey of currentRoutes.routes.keys()) {
        if (!documentedOperations.has(operationKey) && !undocumented.has(operationKey)) {
            errors.push(`Undocumented route operation: ${operationKey}`);
        }
    }
    for (const operationKey of documentedOperations.keys()) {
        if (!currentRoutes.routes.has(operationKey)) {
            errors.push(`Spec operation missing from code: ${operationKey}`);
        }
    }
    for (const operationKey of undocumented.keys()) {
        if (documentedOperations.has(operationKey)) {
            errors.push(`Policy entry is stale because spec now documents it: ${operationKey}`);
        } else if (!currentRoutes.routes.has(operationKey)) {
            errors.push(`Policy entry does not match current code: ${operationKey}`);
        }
    }

    const baseRoutes = buildRefRoutes(baseRef);
    const baseSpec = loadYamlFromRef(baseRef, SPEC_PATH);
    const changedFiles = collectChangedFiles(baseRef);
    const semanticSpecChanged = baseSpec
        ? serializeOperations(normalizeSpec(baseSpec)) !== serializeOperations(documentedOperations)
        : false;

    if (baseSpec && changedFiles.has(TYPES_PATH) && !semanticSpecChanged) {
        errors.push(`${TYPES_PATH} changed without a semantic OpenAPI update`);
    } else if (!baseSpec && changedFiles.has(TYPES_PATH)) {
        notes.push(`Base ref ${baseRef} predates the OpenAPI baseline; DTO/spec diff check skipped`);
    }

    if (baseRoutes) {
        const routeInventoryChanged = JSON.stringify([...baseRoutes.keys()].sort()) !== JSON.stringify([...currentRoutes.routes.keys()].sort());
        if (routeInventoryChanged && !changedFiles.has(SPEC_PATH) && !changedFiles.has(POLICY_PATH)) {
            errors.push('Route inventory changed without updating the OpenAPI spec or contract policy');
        }
    }

    if (baseSpec && semanticSpecChanged) {
        if ((baseSpec.info?.version ?? null) === (currentSpec.info?.version ?? null)) {
            errors.push(`OpenAPI contract changed but info.version stayed at ${currentSpec.info?.version}`);
        }

        const comparison = compareOperations(normalizeSpec(baseSpec), documentedOperations);
        for (const change of comparison.breaking) {
            if (!overrides.has(change)) {
                errors.push(`Breaking contract change without tracked override: ${change}`);
            }
        }
        if (comparison.breaking.length === 0 && comparison.additive.length > 0) {
            notes.push(`Additive OpenAPI changes detected: ${comparison.additive.join('; ')}`);
        }
    } else if (!baseSpec) {
        notes.push(`Base ref ${baseRef} does not contain ${SPEC_PATH}; semantic diff skipped`);
    }

    if (errors.length > 0) {
        console.error('OpenAPI contract guard failed:');
        for (const error of errors) {
            console.error(`- ${error}`);
        }
        process.exit(1);
    }

    console.log('OpenAPI contract guard passed.');
    for (const note of notes) {
        console.log(`note: ${note}`);
    }
}

// Self-test del solo diff semantico. Non tocca il filesystem né git: costruisce
// due documenti OpenAPI in memoria, li passa per lo stesso `normalizeSpec` +
// `compareOperations` usati in produzione, e asserisce su quello che ne esce.
//
// Esiste perché fino a WUL-545 questo era l'unico dei guard di Repository Guards
// senza self-test, ed è così che il confronto per proprietà è rimasto codice morto
// senza che nessuno se ne accorgesse.
function specWith(responseSchema, { requestSchema = null, extraSchemas = {} } = {}) {
    const operation = {
        responses: { '200': { content: { 'application/json': { schema: responseSchema } } } }
    };
    if (requestSchema) {
        operation.requestBody = { required: true, content: { 'application/json': { schema: requestSchema } } };
    }
    return { paths: { '/probe': { get: operation } }, components: { schemas: extraSchemas } };
}

function diffOf(baseDocument, currentDocument) {
    return compareOperations(normalizeSpec(baseDocument), normalizeSpec(currentDocument));
}

const OBJ = (properties, required) => ({ type: 'object', properties, ...(required ? { required } : {}) });
const STR = { type: 'string' };

function runSelfTest() {
    const cases = [
        {
            name: 'campo di RISPOSTA nuovo e obbligatorio → breaking (la regressione WUL-542)',
            run: () => diffOf(
                specWith(OBJ({ centralRuntime: OBJ({ state: STR }, ['state']) }, ['centralRuntime'])),
                specWith(OBJ({ centralRuntime: OBJ({ state: STR, accessMode: STR }, ['state', 'accessMode']) }, ['centralRuntime']))
            ),
            expect: (d) => d.breaking.some((c) => c.endsWith('.centralRuntime.accessMode became required'))
        },
        {
            name: 'campo di risposta nuovo e opzionale → solo additive',
            run: () => diffOf(
                specWith(OBJ({ a: STR }, ['a'])),
                specWith(OBJ({ a: STR, b: STR }, ['a']))
            ),
            expect: (d) => d.breaking.length === 0 && d.additive.some((c) => c.endsWith('.b was added'))
        },
        {
            name: 'campo di risposta rimosso → breaking',
            run: () => diffOf(specWith(OBJ({ a: STR, b: STR })), specWith(OBJ({ a: STR }))),
            expect: (d) => d.breaking.some((c) => c.endsWith('.b was removed'))
        },
        {
            name: 'campo preesistente che entra nei required → breaking',
            run: () => diffOf(specWith(OBJ({ a: STR, b: STR }, ['a'])), specWith(OBJ({ a: STR, b: STR }, ['a', 'b']))),
            expect: (d) => d.breaking.some((c) => c.endsWith('.b became required'))
        },
        {
            name: 'campo che esce dai required → additive, mai breaking',
            run: () => diffOf(specWith(OBJ({ a: STR, b: STR }, ['a', 'b'])), specWith(OBJ({ a: STR, b: STR }, ['a']))),
            expect: (d) => d.breaking.length === 0 && d.additive.some((c) => c.endsWith('.b became optional'))
        },
        {
            name: 'required nuovo dentro un array di risposta → breaking, con [] nel label',
            run: () => diffOf(
                specWith({ type: 'array', items: OBJ({ id: STR }, ['id']) }),
                specWith({ type: 'array', items: OBJ({ id: STR, version: STR }, ['id', 'version']) })
            ),
            expect: (d) => d.breaking.some((c) => c.includes('[].version became required'))
        },
        {
            name: '$ref inlinato senza cambiare nulla → nessun segnale',
            run: () => {
                const shape = OBJ({ a: STR, b: STR }, ['a', 'b']);
                return diffOf(
                    specWith({ $ref: '#/components/schemas/Shape' }, { extraSchemas: { Shape: shape } }),
                    specWith(shape, { extraSchemas: { Shape: shape } })
                );
            },
            expect: (d) => d.breaking.length === 0 && d.additive.length === 0
        },
        {
            name: 'schema rinominato a contenuto identico → nessun segnale',
            run: () => {
                const shape = OBJ({ a: STR }, ['a']);
                return diffOf(
                    specWith({ $ref: '#/components/schemas/Vecchio' }, { extraSchemas: { Vecchio: shape } }),
                    specWith({ $ref: '#/components/schemas/Nuovo' }, { extraSchemas: { Nuovo: shape } })
                );
            },
            expect: (d) => d.breaking.length === 0 && d.additive.length === 0
        },
        {
            name: 'varianti oneOf riordinate → nessun segnale',
            run: () => {
                const a = OBJ({ a: STR }, ['a']);
                const b = { type: 'array', items: STR };
                return diffOf(specWith({ oneOf: [a, b] }), specWith({ oneOf: [b, a] }));
            },
            expect: (d) => d.breaking.length === 0 && d.additive.length === 0
        },
        {
            name: 'request body con `required` booleano → nessuna eccezione, e il campo obbligatorio è breaking',
            run: () => diffOf(
                specWith(OBJ({ a: STR }), { requestSchema: OBJ({ x: STR }, ['x']) }),
                specWith(OBJ({ a: STR }), { requestSchema: OBJ({ x: STR, y: STR }, ['x', 'y']) })
            ),
            expect: (d) => d.breaking.some((c) => c.endsWith('.y became required'))
        },
        {
            name: 'nessuna differenza → nessun segnale',
            run: () => diffOf(specWith(OBJ({ a: STR }, ['a'])), specWith(OBJ({ a: STR }, ['a']))),
            expect: (d) => d.breaking.length === 0 && d.additive.length === 0
        }
    ];

    let falliti = 0;
    for (const testCase of cases) {
        let diff;
        let thrown = null;
        try {
            diff = testCase.run();
        } catch (error) {
            thrown = error;
        }
        const passed = !thrown && testCase.expect(diff);
        if (passed) {
            console.log(`ok   ${testCase.name}`);
        } else {
            falliti += 1;
            console.error(`FAIL ${testCase.name}`);
            if (thrown) console.error(`     eccezione: ${thrown.message}`);
            else console.error(`     ottenuto: ${JSON.stringify(diff)}`);
        }
    }

    if (falliti > 0) {
        console.error(`\nself-test: ${falliti} caso/i fallito/i su ${cases.length}`);
        process.exit(1);
    }
    console.log(`\nself-test: ${cases.length}/${cases.length} casi passano`);
}

if (process.argv.includes('--self-test')) {
    runSelfTest();
} else {
    main();
}
