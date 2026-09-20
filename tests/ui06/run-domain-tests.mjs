/* @Codex UI06: transpile real pure modules into a disposable tree, not a typecheck. */
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const temporary = await mkdtemp(path.join(tmpdir(), 'mediflow-ui06-domain-'));
const entries = ['tests/ui06/scale-behavior.test.ts', 'tests/ui06/workspace-counters.test.ts', 'lib/patient-workspace.test.ts'];
const files = [...entries, 'tests/ui06/synthetic-scale.ts', 'lib/scale-validation.ts', 'lib/scale-submission.ts', 'lib/scale-definitions.ts', 'lib/scale-history.ts', 'lib/scales/tinetti-poma28-v1.ts', 'lib/patient-workspace.ts'];
try {
    // Never reuse a user data directory. This runner owns both data and emitted code.
    const dataDir = path.join(temporary, 'synthetic-data'); await mkdir(dataDir);
    for (const file of files) {
        const emitted = ts.transpileModule(await readFile(path.join(root, file), 'utf8'), {
            fileName: file, reportDiagnostics: true,
            compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        });
        const errors = emitted.diagnostics?.filter(d => d.category === ts.DiagnosticCategory.Error) ?? [];
        if (errors.length) throw new Error(ts.formatDiagnostics(errors, { getCanonicalFileName: p => p, getCurrentDirectory: () => root, getNewLine: () => '\n' }));
        const output = path.join(temporary, file.replace(/\.ts$/, '.js'));
        await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, emitted.outputText);
    }
    console.log(`UI06 real pure modules; Node ${process.version}; TypeScript ${ts.version}; MEDIFLOW_DATA_DIR is a fresh owned temporary directory.`);
    const result = spawnSync(process.execPath, ['--test', ...entries.map(file => path.join(temporary, file.replace(/\.ts$/, '.js')))], {
        cwd: root, env: { ...process.env, MEDIFLOW_DATA_DIR: dataDir }, encoding: 'utf8',
    });
    process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
} finally { await rm(temporary, { recursive: true, force: true }); }
