import { readFileSync, writeFileSync } from 'node:fs';
import { catalogEntries, catalogCalls, verifyCall } from './dossier-conformance';
const root = 'native/contracts/dossier-conformance/';
const calls = [...JSON.parse(readFileSync(root + 'ts-cases.json', 'utf8')), ...JSON.parse(readFileSync(root + 'banco-cases.json', 'utf8')), ...catalogCalls()];
writeFileSync(root + 'catalog-cases.json', JSON.stringify(catalogCalls()));
writeFileSync(root + 'expected.json', JSON.stringify(calls.map(verifyCall)));
writeFileSync(root + 'catalog.json', JSON.stringify(catalogEntries()));
console.log(`${calls.length} risultati completi generati dal verificatore Web`);
