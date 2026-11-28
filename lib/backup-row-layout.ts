export const BACKUP_ROWS_HEADER = '{"format":"mediflow-backup","version":1,"payload":{';
export const BACKUP_ROWS_MANIFEST = '},"manifest":';
export const BACKUP_ROWS_TRANSPORT_HEADER = 'x-mediflow-backup-layout';
export const BACKUP_ROWS_TRANSPORT = 'rows-v1';
export const MAX_BACKUP_ROW_BYTES = 64 * 1024 * 1024;

export function invalidBackupRows(): never { throw new SyntaxError('Invalid backup row layout'); }

type Line = { text: string; byteLength: number };

export class BackupLineDecoder {
    private parts: Uint8Array[] = [];
    private size = 0;
    private readonly decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

    private append(bytes: Uint8Array): void {
        this.size += bytes.byteLength;
        if (this.size > MAX_BACKUP_ROW_BYTES) invalidBackupRows();
        if (bytes.byteLength) this.parts.push(bytes);
    }

    public *push(bytes: Uint8Array): Generator<Line> {
        let start = 0;
        for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
            this.append(bytes.subarray(start, end));
            const byteLength = this.size + 1;
            let data = this.parts[0] ?? new Uint8Array();
            if (this.parts.length > 1) {
                data = new Uint8Array(this.size);
                let offset = 0;
                for (const part of this.parts) {
                    data.set(part, offset);
                    offset += part.byteLength;
                }
            }
            this.parts = [];
            this.size = 0;
            start = end + 1;
            yield { text: this.decoder.decode(data), byteLength };
        }
        this.append(bytes.subarray(start));
    }

    finish(): void {
        if (this.size !== 0) invalidBackupRows();
    }
}

function readJson(line: string): unknown {
    try { return JSON.parse(line); } catch { invalidBackupRows(); }
}

export function readBackupRow(line: string): Record<string, unknown> {
    const value = readJson(line[0] === ',' ? line.slice(1) : line);
    if (!value || typeof value !== 'object' || Array.isArray(value)) invalidBackupRows();
    return value as Record<string, unknown>;
}

type LayoutEvent = { kind: 'header' } | { kind: 'start' | 'end'; collection: string }
    | { kind: 'row'; collection: string; row: Record<string, unknown> }
    | { kind: 'manifest'; value: unknown };

export class BackupRowLayout {
    private started = false;
    private complete = false;
    private previous = '';
    private collection = '';
    private firstRow = true;

    read(line: string): LayoutEvent {
        if (!this.started) {
            if (line !== BACKUP_ROWS_HEADER) invalidBackupRows();
            this.started = true;
            return { kind: 'header' };
        }
        if (this.complete) invalidBackupRows();
        if (this.collection) {
            if (line === ']') {
                this.previous = this.collection;
                this.collection = '';
                return { kind: 'end', collection: this.previous };
            }
            if (line[0] !== (this.firstRow ? '{' : ',') || (!this.firstRow && line[1] !== '{')) invalidBackupRows();
            this.firstRow = false;
            return { kind: 'row', collection: this.collection, row: readBackupRow(line) };
        }
        if (line.startsWith(BACKUP_ROWS_MANIFEST) && line.endsWith('}')) {
            const value = readJson(line.slice(BACKUP_ROWS_MANIFEST.length, -1));
            this.complete = true;
            return { kind: 'manifest', value };
        }
        const next = /^(,?)"([a-zA-Z]+)":\[$/u.exec(line);
        if (!next || next[1] !== (this.previous ? ',' : '') || next[2] <= this.previous) invalidBackupRows();
        this.firstRow = true;
        this.collection = next[2];
        return { kind: 'start', collection: this.collection };
    }

    finish(): void {
        if (!this.complete) invalidBackupRows();
    }
}
