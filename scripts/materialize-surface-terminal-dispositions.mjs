/* @Codex */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WEB = `${ROOT}/docs/capability-mapping/nodes/web-surfaces.v1.json`;
const MINI = `${ROOT}/docs/capability-mapping/nodes/mini-command-surfaces.v1.json`;
const IOS = `${ROOT}/docs/capability-mapping/nodes/ios-ipados-runtime-surfaces.v1.json`;
const MACOS = `${ROOT}/docs/capability-mapping/nodes/macos-runtime-surfaces.v1.json`;
const RELATIONS = `${ROOT}/docs/capability-mapping/relations/mini-command-bindings.v1.json`;
const RECEIPT = `${ROOT}/docs/capability-mapping/surface-terminal-dispositions.v1.json`;
const MINI_REF = '1e35733c0218eae67a1d6e158085aab7340bc26b:packages/mini/contracts/mini-parity.json';

function fail(message) { throw new Error(`surface disposition: ${message}`); }
function json(path) { return JSON.parse(readFileSync(path, 'utf8')); }
function replace(path, from, to, expected) {
  const source = readFileSync(path, 'utf8');
  const count = source.split(from).length - 1;
  const existing = source.split(to).length - 1;
  if (count === expected) writeFileSync(path, source.replaceAll(from, to));
  else if (count !== 0 || existing !== expected) fail(`${path}: expected ${expected}, found ${count}`);
}
function write(path, value) { writeFileSync(path, `${JSON.stringify(value)}\n`); }

replace(WEB, '"terminalDisposition":"unmapped"', '"terminalDisposition":"out_of_catalog"', 168);
replace(MINI, '"terminalDisposition":"unmapped"', '"terminalDisposition":"mapped"', 6);
replace(IOS, '"terminalDisposition":"unmapped"', '"terminalDisposition":"out_of_catalog"', 1);
replace(MACOS, '"terminalDisposition":"unmapped"', '"terminalDisposition":"out_of_catalog"', 4);

const mini = json(MINI).records;
const records = mini.map((record) => {
  const canonicalId = record.sourceIdentity.identifier.slice(0, record.sourceIdentity.identifier.lastIndexOf(':'));
  return { id: `relation:${record.id}`, from: record.id, to: `anchor:web:${canonicalId}@1e35733c0218`, relationKind: 'supports', authority: 'unresolved', stage: 'unresolved', evidence: [{ evidenceKind: 'manifest', ref: MINI_REF, locator: `/capabilities/${record.sourceIdentity.sourceRow - 1}/miniCommands/${Number(record.sourceIdentity.identifier.split(':').at(-1)) - 1}`, claim: 'the canonical Mini manifest declares this command under the exact anchor capability' }] };
});
if (records.length !== 6 || new Set(records.map(({ to }) => to)).size !== 5) fail('Mini command hierarchy is incomplete');
write(RELATIONS, { schema: 'mediflow.capability-mapping.mini-command-bindings.v1', status: 'candidate_not_integrated', applyPolicy: 'none', records });
write(RECEIPT, { schema: 'mediflow.capability-mapping.surface-terminal-dispositions.v1', status: 'candidate_not_integrated', applyPolicy: 'none', closedCatalogEvidence: { ref: MINI_REF, locator: '/capabilities', claim: 'the 66-row canonical catalog is closed; source-only Web and Apple entries without a declared canonical relation are out_of_catalog' }, populationCounts: { webOutOfCatalog: 168, miniMapped: 6, iosIpadosOutOfCatalog: 1, macosOutOfCatalog: 4 }, authorityRule: 'terminal disposition does not grant or union authority or stage' });
