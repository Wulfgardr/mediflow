import { build } from 'esbuild';
import { writeFile } from 'node:fs/promises';

export async function bundleEvidenceQueueWorker() {
    const result = await build({ entryPoints: ['experiments/gpui-patient-pilot/worker/evidence-queue.ts'],
        bundle: true, platform: 'node', format: 'esm', target: 'node24', minify: true, write: false });
    return result.outputFiles[0].text;
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
    bundleEvidenceQueueWorker().then(result => writeFile('experiments/gpui-patient-pilot/worker/evidence-queue.bundle.mjs', result))
        .catch(error => { console.error(error); process.exitCode = 1; });
}
