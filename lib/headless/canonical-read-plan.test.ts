/* @Codex */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  HEADLESS_CANONICAL_READ_PLAN,
  HEADLESS_NETWORK_READ_EVIDENCE_CANDIDATES,
  resolveHeadlessCanonicalReadPlan,
} from './canonical-read-plan';

type Crosswalk = Readonly<{ records: readonly Readonly<{
  id: string;
  sourceIdentity: Readonly<{ sourceRow: number }>;
  sourceRecord: Readonly<{ webCapability: string }>;
}>[] }>;
type ParityMatrix = Readonly<{ rows: readonly Readonly<{ feature: string }>[] }>;
type OpenApi = Readonly<{ paths: Readonly<Record<string, Readonly<{
  get?: Readonly<{ operationId?: string }>;
}>>> }>;

const root = new URL('../../', import.meta.url);
const loadYaml = (createRequire(import.meta.url)('js-yaml') as Readonly<{
  load: (source: string) => unknown;
}>).load;
const crosswalk = JSON.parse(readFileSync(
  new URL('docs/capability-mapping/nodes/web-mini-crosswalk.v1.json', root), 'utf8',
)) as Crosswalk;
const parity = JSON.parse(readFileSync(new URL('docs/apple-parity-matrix.json', root), 'utf8')) as ParityMatrix;
const plan = () => Array.from(HEADLESS_CANONICAL_READ_PLAN);
const candidates = () => Array.from(HEADLESS_NETWORK_READ_EVIDENCE_CANDIDATES);
const EXPECTED_MAPPINGS = [
  ['getNetworkNode', 'assigned', [63]],
  ['getNetworkSession', 'unassigned', []],
  ['listNetworkCapabilities', 'assigned', [63]],
  ['getNetworkIdentity', 'assigned', [63]],
  ['getNetworkRevision', 'assigned', [61]],
  ['getNetworkAiRuntime', 'ambiguous', [44, 51]],
  ['listNetworkPairingIntents', 'assigned', [37]],
  ['listNetworkAmbulatories', 'assigned', [27]],
  ['listNetworkDrugs', 'assigned', [24]],
  ['listNetworkExemptions', 'assigned', [23]],
  ['searchNetworkTerminology', 'assigned', [26]],
  ['resolveNetworkTerminology', 'assigned', [26]],
  ['listNetworkTerminologySystems', 'assigned', [26]],
  ['listNetworkServicePrescriptions', 'assigned', [13]],
  ['listNetworkServicePrescriptionItems', 'assigned', [13]],
  ['listNetworkServiceCatalog', 'assigned', [57]],
  ['listNetworkProstheticPrescriptions', 'assigned', [14]],
  ['listNetworkPatients', 'assigned', [1]],
  ['listNetworkScopedCheckups', 'assigned', [33]],
  ['listNetworkScopedEntries', 'assigned', [34]],
  ['getNetworkPatient', 'assigned', [1]],
  ['listNetworkPatientEntries', 'assigned', [3]],
  ['getNetworkPatientEntry', 'assigned', [3]],
  ['listNetworkPatientTherapies', 'assigned', [8]],
  ['getNetworkPatientTherapy', 'assigned', [8]],
  ['listNetworkPatientCheckups', 'assigned', [10]],
  ['getNetworkPatientCheckup', 'assigned', [10]],
  ['listNetworkPatientObservations', 'assigned', [12]],
  ['getNetworkPatientObservation', 'assigned', [12]],
  ['listNetworkPatientAttachments', 'assigned', [15]],
  ['getNetworkPatientAttachment', 'assigned', [15]],
  ['validateNetworkFsePatientExport', 'assigned', [21]],
] as const;

function openApiNetworkGets(): readonly (readonly [string, string])[] {
  const document = loadYaml(readFileSync(new URL('docs/openapi/mediflow-v1.yaml', root), 'utf8')) as OpenApi;
  return Object.entries(document.paths)
    .filter(([route, pathItem]) => route.startsWith('/api/v1/network/') && pathItem.get)
    .map(([route, pathItem]) => [route, pathItem.get?.operationId ?? ''] as const);
}

function hasExportedGetHandler(source: string, fileName: string): boolean {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const exported = (node: ts.Node): boolean => ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword) ?? false);
  return sourceFile.statements.some((statement) => (
    (ts.isFunctionDeclaration(statement) && statement.name?.text === 'GET' && exported(statement))
    || (ts.isVariableStatement(statement) && exported(statement) && statement.declarationList.declarations.some((declaration) => (
      ts.isIdentifier(declaration.name) && declaration.name.text === 'GET'
    )))
  ));
}

function runtimeNetworkGets(): readonly (readonly [string, string])[] {
  const repositoryRoot = fileURLToPath(root);
  const apiRoot = join(repositoryRoot, 'app/api/v1/network');
  const output: [string, string][] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      if (!entry.isFile() || entry.name !== 'route.ts') continue;
      if (!hasExportedGetHandler(readFileSync(path, 'utf8'), path)) continue;
      const runtimeRef = relative(repositoryRoot, path).split(sep).join('/');
      const route = `/${runtimeRef.slice('app/'.length, -'/route.ts'.length)}`
        .replace(/\[([^\]]+)\]/gu, '{$1}');
      output.push([route, runtimeRef]);
    }
  };
  visit(apiRoot);
  return output.sort(([left], [right]) => left.localeCompare(right));
}

const DYNAMIC_ROUTE_SEGMENT = '\u0000dynamic\u0000';

function normalizeCandidateRoute(route: string): string {
  return route.replace(/\{[^}]+\}/gu, DYNAMIC_ROUTE_SEGMENT);
}

function positiveGetRoutes(source: string, fileName: string): readonly string[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const initializers = new Map<string, ts.Expression[]>();
  const visitInitializers = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const values = initializers.get(node.name.text) ?? [];
      values.push(node.initializer);
      initializers.set(node.name.text, values);
    }
    ts.forEachChild(node, visitInitializers);
  };
  visitInitializers(sourceFile);

  const unwrap = (expression: ts.Expression): ts.Expression => {
    if (ts.isAwaitExpression(expression) || ts.isParenthesizedExpression(expression)
      || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression)
      || ts.isNonNullExpression(expression)) return unwrap(expression.expression);
    return expression;
  };
  const evaluate = (rawExpression: ts.Expression, resolving = new Set<string>()): string => {
    const expression = unwrap(rawExpression);
    if (ts.isStringLiteralLike(expression)) return expression.text;
    if (ts.isTemplateExpression(expression)) {
      return expression.templateSpans.reduce((value, span) => (
        value + evaluate(span.expression, resolving) + span.literal.text
      ), expression.head.text);
    }
    if (ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      return evaluate(expression.left, resolving) + evaluate(expression.right, resolving);
    }
    if (ts.isIdentifier(expression) && !resolving.has(expression.text)) {
      const values = initializers.get(expression.text);
      if (values?.length === 1) {
        const next = new Set(resolving);
        next.add(expression.text);
        return evaluate(values[0]!, next);
      }
    }
    return DYNAMIC_ROUTE_SEGMENT;
  };
  const enclosingBlock = (node: ts.Node): ts.Block | ts.SourceFile => {
    let current: ts.Node | undefined = node.parent;
    while (current && !ts.isBlock(current) && !ts.isSourceFile(current)) current = current.parent;
    return (current as ts.Block | ts.SourceFile | undefined) ?? sourceFile;
  };
  const statusAssertions = new Map<ts.Block | ts.SourceFile, Set<string>>();
  const requests: { readonly block: ts.Block | ts.SourceFile; readonly responseVariable: string; readonly route: string }[] = [];
  const visitEvidence = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const expression = unwrap(node.initializer);
      if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)
        && expression.expression.text === 'request' && expression.arguments.length >= 2
        && ts.isStringLiteralLike(expression.arguments[0]!) && expression.arguments[0]!.text === 'GET') {
        requests.push({
          block: enclosingBlock(node),
          responseVariable: node.name.text,
          route: evaluate(expression.arguments[1]!).split('?', 1)[0]!,
        });
      }
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'assert'
      && (node.expression.name.text === 'equal' || node.expression.name.text === 'strictEqual')
      && node.arguments.length >= 2 && ts.isNumericLiteral(node.arguments[1]!) && node.arguments[1]!.text === '200') {
      const status = unwrap(node.arguments[0]!);
      if (ts.isPropertyAccessExpression(status) && status.name.text === 'status'
        && ts.isPropertyAccessExpression(status.expression) && status.expression.name.text === 'response'
        && ts.isIdentifier(status.expression.expression)) {
        const block = enclosingBlock(node);
        const variables = statusAssertions.get(block) ?? new Set<string>();
        variables.add(status.expression.expression.text);
        statusAssertions.set(block, variables);
      }
    }
    ts.forEachChild(node, visitEvidence);
  };
  visitEvidence(sourceFile);
  return requests
    .filter(({ block, responseVariable }) => statusAssertions.get(block)?.has(responseVariable))
    .map(({ route }) => route);
}

test('materializes exactly 66 ordered terminal rows without executable authority', () => {
  assert.equal(plan().length, 66);
  assert.deepEqual(
    plan().map(({ anchorId, sourceRow }) => [anchorId, sourceRow]),
    crosswalk.records.map(({ id, sourceIdentity }) => [id, sourceIdentity.sourceRow]),
  );
  assert.deepEqual(plan().map(({ sourceRow }) => sourceRow), Array.from({ length: 66 }, (_, index) => index + 1));
  assert.equal(new Set(plan().map(({ anchorId }) => anchorId)).size, 66);

  for (const entry of plan()) {
    assert.equal(entry.schema, 'mediflow.headless.canonical-read-plan-entry.v1');
    assert.equal(entry.terminalDisposition, 'manual_only');
    assert.equal(entry.integrationDisposition, 'candidate_not_integrated');
    assert.equal(entry.operationId, null);
    assert.equal(entry.applicationServiceRef, null);
    assert.equal(entry.applyPolicy, 'none');
    assert.equal(entry.writesPerformed, 0);
    assert.equal(Object.isFrozen(entry), true);
    assert.equal(Object.getPrototypeOf(entry), null);
    assert.equal(Object.isFrozen(entry.readCandidates), true);
    assert.equal(Object.getPrototypeOf(entry.readCandidates), null);
  }
  assert.equal(Object.isFrozen(HEADLESS_CANONICAL_READ_PLAN), true);
  assert.equal(Object.getPrototypeOf(HEADLESS_CANONICAL_READ_PLAN), null);
});

test('publishes an exact deeply immutable non-authorizing graph', () => {
  const entryKeys = [
    'schema', 'anchorId', 'sourceRow', 'terminalDisposition', 'integrationDisposition', 'readCandidates',
    'unresolved', 'operationId', 'applicationServiceRef', 'applyPolicy', 'writesPerformed',
  ];
  const candidateKeys = [
    'schema', 'sourceRows', 'mappingEvidenceRows', 'mappingDisposition', 'mappingReason',
    'mappingEvidenceNeedle', 'method', 'route', 'openApiOperationId', 'runtimeRef', 'positiveTestRef',
    'mappingEvidenceRefs', 'integrationDisposition', 'headlessOperationId', 'applicationServiceRef',
    'applyPolicy', 'writesPerformed',
  ];
  const unresolved = [
    'operationId', 'capabilityId', 'applicationServiceRef', 'inputSchema', 'outputSchema', 'maximumStage',
    'authorityPolicy', 'sessionPolicy', 'casPolicy', 'idempotencyPolicy', 'limitPolicy', 'receiptPolicy',
    'fabricDependency',
  ];
  for (const entry of plan()) {
    assert.deepEqual(Reflect.ownKeys(entry), entryKeys);
    assert.deepEqual(Array.from(entry.unresolved), unresolved);
  }
  for (const candidate of candidates()) assert.deepEqual(Reflect.ownKeys(candidate), candidateKeys);

  const pending: object[] = [HEADLESS_CANONICAL_READ_PLAN, HEADLESS_NETWORK_READ_EVIDENCE_CANDIDATES];
  const visited = new Set<object>();
  while (pending.length > 0) {
    const value = pending.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    assert.equal(Object.isFrozen(value), true);
    assert.equal(Object.getPrototypeOf(value), null);
    for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
      assert.equal('value' in descriptor, true);
      assert.equal(descriptor.configurable, false);
      assert.equal(descriptor.writable, false);
      if ('value' in descriptor && descriptor.value && typeof descriptor.value === 'object') {
        pending.push(descriptor.value as object);
      }
    }
  }
  assert.equal(visited.size > 250, true);
});

test('accounts for all 32 OpenAPI GETs as non-integrated evidence and preserves ambiguity', () => {
  const observed = openApiNetworkGets();
  assert.equal(observed.length, 32);
  assert.deepEqual(candidates().map(({ route, openApiOperationId }) => [route, openApiOperationId]), observed);
  assert.deepEqual(
    candidates().map(({ route, runtimeRef }) => [route, runtimeRef]).sort(([left], [right]) => left.localeCompare(right)),
    runtimeNetworkGets(),
  );
  assert.equal(new Set(candidates().map(({ route }) => route)).size, 32);
  assert.equal(new Set(candidates().map(({ openApiOperationId }) => openApiOperationId)).size, 32);
  assert.equal(new Set(candidates().map(({ runtimeRef }) => runtimeRef)).size, 32);
  assert.deepEqual(
    candidates().map(({ openApiOperationId, mappingDisposition, sourceRows }) => (
      [openApiOperationId, mappingDisposition, Array.from(sourceRows)]
    )),
    EXPECTED_MAPPINGS,
  );
  assert.deepEqual(
    Object.fromEntries(['assigned', 'ambiguous', 'unassigned'].map((disposition) => [
      disposition,
      candidates().filter(({ mappingDisposition }) => mappingDisposition === disposition).length,
    ])),
    { assigned: 30, ambiguous: 1, unassigned: 1 },
  );

  const session = candidates().find(({ openApiOperationId }) => openApiOperationId === 'getNetworkSession')!;
  assert.equal(session.mappingDisposition, 'unassigned');
  assert.deepEqual(Array.from(session.sourceRows), []);
  assert.deepEqual(Array.from(session.mappingEvidenceRows), [63]);
  const aiRuntime = candidates().find(({ openApiOperationId }) => openApiOperationId === 'getNetworkAiRuntime')!;
  assert.equal(aiRuntime.mappingDisposition, 'ambiguous');
  assert.deepEqual(Array.from(aiRuntime.sourceRows), [44, 51]);

  for (const candidate of candidates()) {
    assert.equal(candidate.schema, 'mediflow.headless.network-read-evidence-candidate.v1');
    assert.equal(candidate.method, 'GET');
    assert.equal(candidate.integrationDisposition, 'candidate_not_integrated');
    assert.equal(candidate.headlessOperationId, null);
    assert.equal(candidate.applicationServiceRef, null);
    assert.equal(candidate.applyPolicy, 'none');
    assert.equal(candidate.writesPerformed, 0);
    assert.equal(candidate.mappingReason.length > 0, true);
    assert.equal(candidate.mappingEvidenceNeedle.length > 0, true);
    if (candidate.mappingDisposition === 'assigned') assert.equal(candidate.sourceRows.length, 1);
    if (candidate.mappingDisposition === 'ambiguous') assert.equal(candidate.sourceRows.length >= 2, true);
    if (candidate.mappingDisposition === 'unassigned') assert.equal(candidate.sourceRows.length, 0);
    assert.equal(Object.isFrozen(candidate), true);
    assert.equal(Object.getPrototypeOf(candidate), null);
    for (const nested of [candidate.sourceRows, candidate.mappingEvidenceRows, candidate.mappingEvidenceRefs]) {
      assert.equal(Object.isFrozen(nested), true);
      assert.equal(Object.getPrototypeOf(nested), null);
    }
  }
});

test('binds only evidence-aligned source rows and observed runtime and test files', () => {
  for (const candidate of candidates()) {
    assert.equal(candidate.mappingEvidenceRefs.length, candidate.mappingEvidenceRows.length * 2);
    for (const sourceRow of Array.from(candidate.mappingEvidenceRows)) {
      assert.equal(crosswalk.records[sourceRow - 1]?.sourceIdentity.sourceRow, sourceRow);
      assert.equal(parity.rows[sourceRow - 1]?.feature, crosswalk.records[sourceRow - 1]?.sourceRecord.webCapability);
      assert.equal(JSON.stringify(parity.rows[sourceRow - 1]).includes(candidate.mappingEvidenceNeedle), true);
    }
    if (candidate.mappingDisposition === 'assigned') {
      assert.equal(candidate.mappingReason, `parity boundary evidence directly links ${candidate.route} to source row ${candidate.sourceRows[0]}`);
    }
    const runtime = readFileSync(new URL(candidate.runtimeRef, root), 'utf8');
    const positiveTest = readFileSync(new URL(candidate.positiveTestRef, root), 'utf8');
    assert.equal(hasExportedGetHandler(runtime, candidate.runtimeRef), true);
    assert.equal(
      positiveGetRoutes(positiveTest, candidate.positiveTestRef).includes(normalizeCandidateRoute(candidate.route)),
      true,
      `${candidate.openApiOperationId} must bind one GET response to the exact normalized route and its own 200 assertion`,
    );
  }

  const assigned = candidates().filter(({ mappingDisposition }) => mappingDisposition === 'assigned');
  assert.equal(plan().flatMap(({ readCandidates }) => Array.from(readCandidates)).length, assigned.length);
  assert.deepEqual(
    plan().flatMap(({ readCandidates }) => Array.from(readCandidates, ({ openApiOperationId }) => openApiOperationId)).sort(),
    assigned.map(({ openApiOperationId }) => openApiOperationId).sort(),
  );
});

test('candidate-specific positive binding rejects a GET-to-POST mutation', () => {
  const fileName = 'scripts/network-home-base-readonly.test.mjs';
  const source = readFileSync(new URL(fileName, root), 'utf8');
  const mutated = source.replace(
    "const patientDetail = await request('GET'",
    "const patientDetail = await request('POST'",
  );
  assert.notEqual(mutated, source);
  assert.equal(
    positiveGetRoutes(mutated, fileName).includes(normalizeCandidateRoute('/api/v1/network/patients/{id}')),
    false,
  );
});

test('runtime inventory recognizes function, async function, and const GET exports', () => {
  assert.equal(hasExportedGetHandler('export function GET() { return new Response(); }', 'sync-route.ts'), true);
  assert.equal(hasExportedGetHandler('export async function GET() { return new Response(); }', 'async-route.ts'), true);
  assert.equal(hasExportedGetHandler('export const GET = async () => new Response();', 'const-route.ts'), true);
  assert.equal(hasExportedGetHandler('const GET = async () => new Response();', 'private-route.ts'), false);
});

test('resolves exact anchors and rejects inferred or hostile inputs without reads', () => {
  const first = plan()[0]!;
  assert.equal(resolveHeadlessCanonicalReadPlan(first.anchorId), first);
  for (const value of [first.anchorId.toUpperCase(), ` ${first.anchorId}`, `${first.anchorId} `, '', null, 1, true]) {
    assert.equal(resolveHeadlessCanonicalReadPlan(value), null);
  }

  let reads = 0;
  const proxy = new Proxy({}, {
    get() { reads += 1; throw new Error('must not read'); },
    getPrototypeOf() { reads += 1; throw new Error('must not inspect'); },
    ownKeys() { reads += 1; throw new Error('must not enumerate'); },
  });
  assert.equal(resolveHeadlessCanonicalReadPlan(proxy), null);
  assert.equal(reads, 0);
});

test('keeps resolution and published values safe after ambient iterator and then poisoning', async () => {
  const firstAnchor = plan()[0]!.anchorId;
  const iterator = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator)!;
  const then = Object.getOwnPropertyDescriptor(Object.prototype, 'then');
  let thenReads = 0;
  let resolved: ReturnType<typeof resolveHeadlessCanonicalReadPlan> | undefined;
  let observed: Promise<unknown> | undefined;
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    ...iterator,
    value() { throw new Error('poisoned iterator'); },
  });
  Object.defineProperty(Object.prototype, 'then', {
    configurable: true,
    get() { thenReads += 1; throw new Error('poisoned then'); },
  });
  try {
    resolved = resolveHeadlessCanonicalReadPlan(firstAnchor);
    observed = Promise.resolve(resolved);
    Promise.resolve(HEADLESS_CANONICAL_READ_PLAN);
    Promise.resolve(HEADLESS_NETWORK_READ_EVIDENCE_CANDIDATES);
  } finally {
    Object.defineProperty(Array.prototype, Symbol.iterator, iterator);
    if (then) Object.defineProperty(Object.prototype, 'then', then);
    else Reflect.deleteProperty(Object.prototype, 'then');
  }
  assert.equal(await observed, resolved);
  assert.equal(thenReads, 0);
});

test('contains no transport, execution, database, or provider integration', () => {
  const source = readFileSync(new URL('lib/headless/canonical-read-plan.ts', root), 'utf8');
  assert.deepEqual(
    Array.from(source.matchAll(/^import\s+[^;]+from\s+['"]([^'"]+)['"];$/gmu), (match) => match[1]),
    ['./canonical-capability-catalog'],
  );
  assert.doesNotMatch(source, /(?:NextResponse|drizzle|dbServer|sqlite|providerSelection|venueSelection|fetch\s*\(|execute\s*\()/iu);
  assert.doesNotMatch(source, /headlessOperationId:\s*['"`]/u);
  assert.doesNotMatch(source, /applicationServiceRef:\s*['"`]/u);
});
