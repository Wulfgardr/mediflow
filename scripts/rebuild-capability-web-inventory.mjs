/* @Codex */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const ROUTES = `${ROOT}/docs/capability-mapping/sources/web-http-routes.v1.json`;
const PAGES = `${ROOT}/docs/capability-mapping/sources/web-product-pages.v1.json`;
const OUTPUT = `${ROOT}/docs/capability-mapping/nodes/web-surfaces.v1.json`;
const REF = '93362ca505149f5d6c51502784395e65126921df';
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const record = (source, surface, description) => ({ id: `surface:web:page:${source.path}@93362ca50514`, sourceIdentity: { sourceKind: 'web_surface', identifier: source.path }, description, surface, stage: 'unresolved', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref: `${REF}:${source.path}`, locator: 'module', claim: 'enumerated product surface' }], terminalDisposition: 'out_of_catalog', gitBlob: source.gitBlob, byteLength: source.byteLength });
const routes = json(ROUTES).records.map((source) => record(source, 'web_http_route', 'Frozen Web route surface'));
const pages = json(PAGES).records.map((source) => record(source, 'web_page', 'Frozen Web page surface'));
if (pages.some((entry) => entry.sourceIdentity.identifier.startsWith('app/mockups/')) || routes.length !== 140 || pages.length !== 26) throw new Error('web inventory eligibility drift');
const records = [...routes, ...pages];
writeFileSync(OUTPUT, `{\n  "schema": "mediflow.capability-mapping.web-surfaces.v1",\n  "status": "candidate_not_integrated",\n  "applyPolicy": "none",\n  "records": [\n${records.map((entry) => `    ${JSON.stringify(entry)}`).join(',\n')}\n  ]\n}\n`);
