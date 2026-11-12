import { readFileSync, writeSync } from 'node:fs';
import { buildEvidenceQueue, type BuildEvidenceQueueInput } from '../../../lib/domain/documents/evidence-queue-contract';

if (!process.version.startsWith('v24.')) throw new Error('Node 24 required');
const input = readFileSync(0, 'utf8');
if (Buffer.byteLength(input) > 16 * 1024 * 1024) throw new Error('Input limit');
const queue = buildEvidenceQueue(JSON.parse(input) as BuildEvidenceQueueInput);
const output = JSON.stringify(queue);
if (Buffer.byteLength(output) > 16 * 1024 * 1024) throw new Error('Output limit');
writeSync(1, output);
