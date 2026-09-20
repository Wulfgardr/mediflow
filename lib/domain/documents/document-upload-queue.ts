/* @Codex: UI-only sequencing. Persistence is the existing attachment writer. */
export type DocumentUploadResult = Readonly<{
    saved: number;
    unconfirmed: readonly string[];
    notStarted: number;
    interrupted: boolean;
}>;

type UploadSource = Readonly<{ name: string }>;
type Dependencies<T extends UploadSource> = Readonly<{
    read(file: T, signal: AbortSignal): Promise<string>;
    persist(file: T, data: string): Promise<unknown>;
}>;

/** Cancel stops reads and the remaining queue, NOT an already submitted write.
 * An unconfirmed write is never retried automatically: its response may be lost
 * after the host has committed it. The caller must reread the attachment list. */
export function createDocumentUploadQueue<T extends UploadSource>(dependencies: Dependencies<T>) {
    let active: AbortController | null = null;
    return Object.freeze({
        cancel() { active?.abort(); },
        start(files: readonly T[]): Promise<DocumentUploadResult> | null {
            if (active || files.length === 0) return null;
            const controller = new AbortController();
            active = controller;
            const batch = [...files];
            return (async () => {
                let saved = 0;
                let started = 0;
                const unconfirmed: string[] = [];
                try {
                    for (const file of batch) {
                        if (controller.signal.aborted) break;
                        let data: string;
                        try {
                            data = await dependencies.read(file, controller.signal);
                        } catch {
                            if (controller.signal.aborted) break;
                            started += 1;
                            unconfirmed.push(file.name);
                            continue;
                        }
                        // Reading a source grants no persistence authority after cancellation.
                        if (controller.signal.aborted) break;
                        started += 1;
                        try {
                            await dependencies.persist(file, data);
                            saved += 1;
                        } catch {
                            unconfirmed.push(file.name);
                        }
                    }
                    return Object.freeze({ saved, unconfirmed: Object.freeze(unconfirmed),
                        notStarted: batch.length - started, interrupted: controller.signal.aborted });
                } finally {
                    if (active === controller) active = null;
                }
            })();
        },
    });
}

export function readDocumentDataUrl(file: File, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
        if (signal.aborted) { reject(new DOMException('Read cancelled', 'AbortError')); return; }
        const reader = new FileReader();
        const cleanup = () => {
            signal.removeEventListener('abort', cancel);
            reader.onload = reader.onerror = reader.onabort = null;
        };
        const cancel = () => {
            cleanup();
            reader.abort();
            reject(new DOMException('Read cancelled', 'AbortError'));
        };
        reader.onload = () => {
            const data = reader.result;
            cleanup();
            if (typeof data === 'string') resolve(data);
            else reject(new Error('Document read unavailable'));
        };
        reader.onerror = () => { cleanup(); reject(new Error('Document read unavailable')); };
        reader.onabort = () => { cleanup(); reject(new DOMException('Read cancelled', 'AbortError')); };
        signal.addEventListener('abort', cancel, { once: true });
        try { reader.readAsDataURL(file); }
        catch { cleanup(); reject(new Error('Document read unavailable')); }
    });
}
