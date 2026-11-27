import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { stableStringify, validateBackupRowsArtifact, type BackupRowArtifact, type BackupRowDataset } from './backup-artifact';
import { BackupLineDecoder, BackupRowLayout, readBackupRow } from './backup-row-layout';

function *fileLines(descriptor: number, start: number, end: number) {
    const decoder = new BackupLineDecoder();
    for (let offset = start; offset < end;) {
        const buffer = Buffer.allocUnsafe(Math.min(128 * 1024, end - offset));
        const length = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
        if (length === 0) throw new SyntaxError('Incomplete backup');
        offset += length;
        yield* decoder.push(buffer.subarray(0, length));
    }
    decoder.finish();
}

export function readBackupRowsFile(descriptor: number): BackupRowArtifact {
    const layout = new BackupRowLayout();
    const hash = createHash('sha256').update('{');
    const collections: Record<string, Iterable<Record<string, unknown>>> = Object.create(null);
    const counts: Record<string, number> = Object.create(null);
    let offset = 0;
    let start = 0;
    let manifest: unknown;
    let first = true;
    for (const { text, byteLength } of fileLines(descriptor, 0, fs.fstatSync(descriptor).size)) {
        const event = layout.read(text);
        if (event.kind === 'start') {
            start = offset + byteLength;
            hash.update(text);
            counts[event.collection] = 0;
            first = true;
        } else if (event.kind === 'row') {
            if (!first) hash.update(',');
            hash.update(stableStringify(event.row));
            counts[event.collection]++;
            first = false;
        } else if (event.kind === 'end') {
            const from = start, to = offset;
            collections[event.collection] = { [Symbol.iterator]: function* () {
                for (const line of fileLines(descriptor, from, to)) yield readBackupRow(line.text);
            } };
            hash.update(']');
        } else if (event.kind === 'manifest') {
            manifest = event.value;
        }
        offset += byteLength;
    }
    layout.finish();
    return validateBackupRowsArtifact(collections as BackupRowDataset, manifest, counts, hash.update('}').digest('hex'));
}
