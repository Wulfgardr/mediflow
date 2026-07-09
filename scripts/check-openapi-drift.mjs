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

function schemaDiff(baseSchema, currentSchema, context, label) {
    if (JSON.stringify(baseSchema) === JSON.stringify(currentSchema)) return { breaking: [], additive: [] };
    if (!baseSchema || !currentSchema) return { breaking: [`${label} changed shape`] };
    const baseProperties = baseSchema.properties ?? {};
    const currentProperties = currentSchema.properties ?? {};
    const removedProperties = Object.keys(baseProperties).filter((key) => !currentProperties[key]);
    const addedProperties = Object.keys(currentProperties).filter((key) => !baseProperties[key]);
    const breaking = removedProperties.map((key) => `${label}.${key} was removed`);
    const additive = addedProperties
        .filter((key) => !(context === 'request' && (currentSchema.required ?? []).includes(key)))
        .map((key) => `${label}.${key} was added`);
    if (context === 'request') {
        for (const key of addedProperties) {
            if ((currentSchema.required ?? []).includes(key)) {
                breaking.push(`${label}.${key} became required`);
            }
        }
    }
    for (const key of Object.keys(baseProperties).filter((property) => currentProperties[property])) {
        const nested = schemaDiff(baseProperties[key], currentProperties[key], context, `${label}.${key}`);
        breaking.push(...(nested.breaking ?? []));
        additive.push(...(nested.additive ?? []));
    }
    if (breaking.length || additive.length) return { breaking, additive };
    return { breaking: [`${label} changed`] };
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

main();
