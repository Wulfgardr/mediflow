import type { Page } from '@playwright/test';

export async function saveRecoveryToTestDownload(page: Page): Promise<void> {
    await page.addInitScript(() => {
        Object.defineProperty(window, 'showSaveFilePicker', {
            configurable: true,
            value: async ({ suggestedName }: { suggestedName: string }) => {
                const directory = await navigator.storage.getDirectory();
                const file = await directory.getFileHandle(suggestedName, { create: true });
                return {
                    name: file.name,
                    async createWritable() {
                        const output = await file.createWritable();
                        const writer = output.getWriter();
                        return new WritableStream<Uint8Array<ArrayBuffer>>({
                            write: bytes => writer.write(bytes),
                            abort: reason => writer.abort(reason),
                            async close() {
                                await writer.close();
                                const url = URL.createObjectURL(await file.getFile());
                                const link = document.createElement('a');
                                link.href = url;
                                link.download = file.name;
                                link.click();
                            },
                        });
                    },
                };
            },
        });
    });
}
