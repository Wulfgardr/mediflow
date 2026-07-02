/* @Codex */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '..');
const DEFAULT_TARGET_DIR = path.resolve(__dirname, '../../medical-record-app-oss');
const TARGET_DIR = path.resolve(process.env.MEDIFLOW_OSS_TARGET_DIR || DEFAULT_TARGET_DIR);

// Config
const TO_EXCLUDE_BY_NAME = [
    '.git',
    '.build',
    'node_modules',
    '.next',
    '.next-manual-browser',
    '.playwright-cli',
    '.vscode',
    '.DS_Store',
    '__pycache__',
    '.env',
    '.env.local',
    '.venv_mlx',
    '.venv_openmed',
    'Build',
    'certs',
    'oss-assets',
    'prompt-exports',
    'brain',
    '.gemini',
    '.claude',
    'Farmaci',
    'medical.db',
    'next-env.d.ts',
    'playwright-report',
    'test-results',
    'tmp',
    'tsconfig.tsbuildinfo',
    'tsconfig.typecheck.tsbuildinfo'
];

const TO_EXCLUDE_BY_PATH = [
    'AGENTS.md',
    'PLANS.md',
    'docs/agent-attribution.md',
    'docs/ai-rollout-governance.md',
    'docs/ai-stack-execution-plan.md',
    'docs/ai-stack-reliability-review.md',
    'docs/apple-wide-parity-qa.md',
    'docs/apple-wide-qa-manifest.json',
    'docs/apple-docs-mcp.md',
    'docs/siss-fse-corpus-mcp.md',
    'docs/clinical-entities-benchmark.md',
    'docs/clinical-facts-benchmark-observations.md',
    'docs/cloud-comparator-shadow-eval.md',
    'docs/codex-opus-dialogue.md',
    'docs/codex-workflow-monitor.md',
    'docs/development-push-proposal-2026-06-16.md',
    'docs/agentic-development-operating-loop.md',
    'docs/agentic-dual-thesis-run-ledger-template.md',
    'docs/loop-orchestrator.config.json',
    'docs/dialogue',
    'docs/document-intelligence-lab.md',
    'docs/e2e-smoke.md',
    'docs/adr/0027-ai-task-extraction-envelope-and-local-render.md',
    'docs/adr/0028-stack-aware-ai-model-evaluation-matrix.md',
    'docs/adr/0029-ai-model-parliament-and-local-retention-policy.md',
    'docs/adr/0030-openmed-redaction-and-italian-ner-benchmark-lanes.md',
    'docs/adr/0031-clinical-entities-evidence-first-medication-problem-lane.md',
    'docs/adr/0032-document-intelligence-corpus-and-private-shadow-vault.md',
    'docs/adr/0033-ai-rollout-governance-lane-aware-shadow-mode.md',
    'docs/adr/0037-network-ai-plane-optional-central-runtime-on-trusted-lan.md',
    'docs/adr/0039-cloud-comparator-shadow-eval-private-case-pack-and-distillation.md',
    'docs/adr/0040-document-intelligence-evidence-ledger-and-decision-layers.md',
    'docs/adr/0041-openmed-redaction-shadow-adapter.md',
    'docs/adr/0043-macos-oncology-backbone-prototype.md',
    'docs/adr/0044-turboquant-feasibility-and-benchmark-only-runtime-prototype.md',
    'docs/adr/0063-local-workflow-monitor-control-plane.md',
    'docs/adr/0067-agentic-development-operating-loop.md',
    'docs/adr/0069-loop-orchestrator-baseline.md',
    'docs/analysis',
    'docs/analysis/2026-06-01-agentic-dynamics-test-run.md',
    'docs/analysis/2026-06-01-agentic-parliament-repoprompt-export.md',
    'docs/analysis/2026-06-01-agentic-parliament-run.md',
    'docs/parliament',
    'docs/private',
    'docs/linear-codex-playbook.md',
    'docs/linear-completed-issues-archive-2026-05-21.md',
    'docs/linear-seed-issues.csv',
    'docs/linear-import-open.linear.csv',
    'docs/linear-import-open.mf-core-q2.linear.csv',
    'docs/linear-import-open.mf-parity-q2.linear.csv',
    'docs/linear-import-open.mf-fse-q2.linear.csv',
    'docs/linear-memory-workflow.md',
    'scripts/agentic-stack-readiness.mjs',
    'scripts/agentic-stack-readiness.test.mjs',
    'scripts/cloud-comparator-shadow-eval.test.ts',
    'scripts/cloud-comparator-shadow-eval.ts',
    'scripts/check-apple-wide-qa-manifest.mjs',
    'scripts/codex-workflow-monitor.mjs',
    'scripts/codex-workflow-monitor.test.mjs',
    'scripts/loop-orchestrator.mjs',
    'scripts/loop-orchestrator.test.mjs',
    'scripts/codex-mcp-apple-docs-validate.sh',
    'scripts/codex-mcp-siss-fse-corpus-validate.sh',
    'scripts/linear-import-all.sh',
    'scripts/linear-import-via-api.mjs',
    'scripts/linear-memory-tool.mjs',
    'scripts/mcp-apple-docs-smoke.mjs',
    'scripts/siss-fse-corpus-mcp.mjs',
    'scripts/siss-fse-corpus-mcp-smoke.mjs',
    'scripts/prepare-linear-import.mjs',
    'scripts/prepare-oss.js',
    'scripts/prepare-oss.mjs',
    'docs/openmed-redaction-benchmark.md',
    'docs/openmed-toolkit-evaluation.md',
    'docs/parity-click-map-macos.md',
    'docs/parity-smoke.md',
    'docs/patient-concurrency-tests.md',
    'docs/patient-insight-benchmark.md',
    'docs/patient-insight-document-troubleshooting.md',
    'docs/resolver-benchmark.md',
    'docs/turboquant-runtime-benchmark.md'
];

const TO_EXCLUDE_FILE_EXTENSIONS = [
    '.db',
    '.sqlite',
    '.sqlite3'
];

const TO_EXCLUDE_RUNTIME_DIR_PATTERNS = [
    /^tmp-/,
    /^\.next/,
    /^\.venv/
];

const REPLACEMENTS = [
    { from: /Leonardo Pegollo/g, to: 'Nome Medico' },
    { from: /Pegollo/g, to: 'Medico' },
    { from: /Ambulatorio del Medico di Distretto/g, to: 'Nome Ambulatorio' },
    { from: /Dr\. Leonardo Pegollo/g, to: 'Dr. Nome Medico' }
];

const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
const INLINE_DOC_REF_PATTERN = /`([^`\n]*?\.md(?:#[^`\n]+)?)`/g;
const OSS_PACKAGE_JSON_SCRIPT_EXCLUSIONS = [
    'agentic:readiness',
    'benchmark:cloud-comparator',
    'check:apple-wide-qa',
    'linear:archive-done',
    'linear:archive-plan',
    'linear:delete-done',
    'linear:import:all',
    'linear:import:api',
    'loop-orchestrator',
    'linear:memory-check',
    'linear:prepare-import',
    'linear:snapshot-done',
    'mcp:apple-docs:test',
    'mcp:apple-docs:validate',
    'mcp:siss-fse-corpus:test',
    'mcp:siss-fse-corpus:validate',
    'prepare:oss',
    'test:agentic-readiness',
    'test:cloud-comparator',
    'test:loop-orchestrator',
    'test:workflow-monitor',
    'workflow-monitor'
];
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const PRIVATE_MARKDOWN_LINE_PATTERNS = [
    ...TO_EXCLUDE_BY_PATH
        .filter((excludedPath) => excludedPath.endsWith('.md'))
        .map((excludedPath) => new RegExp(escapeRegExp(path.basename(excludedPath)))),
    /docs\/private\//,
    /\]\(\.\/analysis\//,
    /\]\(\.\.\/analysis\//,
    /docs\/analysis\//,
    /apple-wide-parity-qa/,
    /apple-wide-qa/,
    /check:apple-wide-qa/,
    /codex-workflow-monitor/,
    /development-push-proposal-2026-06-16/,
    /linear-completed-issues-archive/,
    /linear-memory-workflow/,
    /linear\.app/,
    /prepare:oss/,
    /MEDIFLOW_OSS_TARGET_DIR/,
    /oss-assets\/README\.md/,
    /^<!-- Codex: created .* -->$/,
    /^<!-- @Codex created .* -->$/,
    /Codex/,
    /Linear/,
    /PLANS/,
    /^Fonte canonica del protocollo operativo:$/,
    /^Questo progetto traccia il codice generato da agent\.$/,
    /^## Attribution \(Codex \/ agent\)$/,
    /^Se il codice e scritto principalmente da Codex, marcature richieste:$/,
    /^Se il codice è scritto principalmente da Codex, marcature richieste:$/,
    /^- Blocco: `\/\* @Codex \*\/`$/,
    /^- Riga: `\/\/ @Codex`$/,
    /^Per aggiunte non banali, aggiungi una entry in `docs\/agent-attribution\.md`\.$/
];

function normalizePathForMatch(inputPath) {
    return inputPath.split(path.sep).join('/');
}

function shouldExclude(relPath, itemName) {
    const normalizedRelPath = normalizePathForMatch(relPath);
    if (TO_EXCLUDE_BY_NAME.includes(itemName)) return true;
    if (TO_EXCLUDE_FILE_EXTENSIONS.includes(path.extname(itemName))) return true;
    if (TO_EXCLUDE_RUNTIME_DIR_PATTERNS.some((pattern) => pattern.test(itemName))) return true;

    for (const excludedPath of TO_EXCLUDE_BY_PATH) {
        if (normalizedRelPath === excludedPath || normalizedRelPath.startsWith(`${excludedPath}/`)) {
            return true;
        }
    }

    return false;
}

function isTextFile(filePath) {
    return (
        filePath.endsWith('.ts') ||
        filePath.endsWith('.tsx') ||
        filePath.endsWith('.js') ||
        filePath.endsWith('.json') ||
        filePath.endsWith('.md')
    );
}

function isExternalLikeTarget(url) {
    return /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i.test(url);
}

function parseMarkdownTarget(rawTarget) {
    const trimmed = rawTarget.trim();
    if (!trimmed) return '';

    if (trimmed.startsWith('<')) {
        const closing = trimmed.indexOf('>');
        if (closing > 0) return trimmed.slice(1, closing);
    }

    const firstToken = trimmed.match(/^(\S+)/);
    return firstToken ? firstToken[1] : trimmed;
}

function pathExistsInOss(currentFileDir, targetPath) {
    if (!targetPath || targetPath === '.') return true;

    const direct = path.resolve(currentFileDir, targetPath);
    if (fs.existsSync(direct)) return true;

    if (!targetPath.startsWith('.') && !path.isAbsolute(targetPath)) {
        const fromRoot = path.resolve(TARGET_DIR, targetPath);
        if (fs.existsSync(fromRoot)) return true;
    }

    return false;
}

function collectFilesByExtension(baseDir, extension) {
    const files = [];

    function walk(currentDir) {
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });
        for (const entry of entries) {
            const absolutePath = path.join(currentDir, entry.name);
            if (entry.isDirectory()) {
                walk(absolutePath);
                continue;
            }

            if (entry.isFile() && absolutePath.endsWith(extension)) {
                files.push(absolutePath);
            }
        }
    }

    walk(baseDir);
    return files;
}

function sanitizeMarkdownReferences(targetDir) {
    const markdownFiles = collectFilesByExtension(targetDir, '.md');
    let updatedFiles = 0;
    let strippedLinks = 0;
    let downgradedInlineRefs = 0;
    let removedInternalLines = 0;

    for (const markdownFile of markdownFiles) {
        const original = fs.readFileSync(markdownFile, 'utf8');
        const currentFileDir = path.dirname(markdownFile);

        let content = original.replace(MARKDOWN_LINK_PATTERN, (fullMatch, imageMarker, label, rawTarget) => {
            if (imageMarker === '!') return fullMatch;

            const parsedTarget = parseMarkdownTarget(rawTarget);
            if (!parsedTarget || isExternalLikeTarget(parsedTarget)) return fullMatch;

            const withoutHash = parsedTarget.split('#')[0];
            if (!withoutHash || pathExistsInOss(currentFileDir, withoutHash)) return fullMatch;

            strippedLinks += 1;
            const visibleLabel = label || parsedTarget;
            return `${visibleLabel} (private)`;
        });

        content = content
            .replace(/orchestrazione/g, 'coordinamento')
            .replace(/orchestratore/g, 'coordinatore')
            .replace(/orchestrata/g, 'coordinata')
            .replace(/orchestration/g, 'coordination');

        content = content.replace(INLINE_DOC_REF_PATTERN, (fullMatch, docRef, offset, fullText) => {
            if (docRef.includes('*')) return fullMatch;
            if (isExternalLikeTarget(docRef)) return fullMatch;
            if (fullText.slice(offset + fullMatch.length).startsWith(' (private)')) return fullMatch;

            const withoutHash = docRef.split('#')[0];
            if (!withoutHash || !withoutHash.endsWith('.md')) return fullMatch;
            if (!/(?:^|\/)[^/\s]+\.md$/i.test(withoutHash)) return fullMatch;
            if (withoutHash.includes('...')) return fullMatch;
            if (withoutHash.includes('<') || withoutHash.includes('>')) return fullMatch;
            if (pathExistsInOss(currentFileDir, withoutHash)) return fullMatch;

            downgradedInlineRefs += 1;
            return `\`${docRef}\` (private)`;
        });

        const filteredLines = [];
        for (const line of content.split('\n')) {
            if (PRIVATE_MARKDOWN_LINE_PATTERNS.some((pattern) => pattern.test(line))) {
                removedInternalLines += 1;
                continue;
            }
            filteredLines.push(line);
        }
        content = filteredLines.join('\n');
        content = content.replace(/\n{3,}/g, '\n\n');
        content = content.replace(/\n---\n(?:\s*\n)*---\n/g, '\n---\n');

        if (content !== original) {
            fs.writeFileSync(markdownFile, content, 'utf8');
            updatedFiles += 1;
        }
    }

    console.log(
        `Sanitized markdown references: ${updatedFiles} files, ` +
        `${strippedLinks} link(s) downgraded, ${downgradedInlineRefs} inline ref(s) downgraded, ` +
        `${removedInternalLines} internal line(s) removed.`
    );
}

function sanitizePackageJsonForOss(targetDir) {
    const packageJsonPath = path.join(targetDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return;

    const original = fs.readFileSync(packageJsonPath, 'utf8');
    const parsed = JSON.parse(original);

    if (parsed.private === true) {
        parsed.private = false;
    }

    if (parsed.scripts && typeof parsed.scripts === 'object') {
        for (const scriptName of OSS_PACKAGE_JSON_SCRIPT_EXCLUSIONS) {
            delete parsed.scripts[scriptName];
        }
    }

    const sanitized = `${JSON.stringify(parsed, null, 2)}\n`;
    if (sanitized !== original) {
        fs.writeFileSync(packageJsonPath, sanitized, 'utf8');
        console.log('Sanitized package.json for OSS.');
    }
}

function sanitizeContributingForOss(targetDir) {
    const contributingPath = path.join(targetDir, 'CONTRIBUTING.md');
    if (!fs.existsSync(contributingPath)) return;

    const original = fs.readFileSync(contributingPath, 'utf8');
    const sanitized = original
        .replace(/\n## [^\n]*Igiene workflow e tracciabilita[\s\S]*?\n---\n/m, '\n')
        .replace(/\n## [^\n]*Attribution \(Codex \/ agent\)[\s\S]*?\n---\n/m, '\n')
        .replace(/\n## [^\n]*Export OSS \(repo pubblica\)[\s\S]*$/m, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+$/g, '\n');

    if (sanitized !== original) {
        fs.writeFileSync(contributingPath, sanitized, 'utf8');
        console.log('Sanitized CONTRIBUTING.md for OSS.');
    }
}

function sanitizePublicDocsCopyForOss(targetDir) {
    const docsReadmePath = path.join(targetDir, 'docs', 'README.md');
    if (fs.existsSync(docsReadmePath)) {
        const original = fs.readFileSync(docsReadmePath, 'utf8');
        let content = original
            .replace(/> \[!NOTE\]\n> La repo OSS[^\n]*\n\n/m, '')
            .replace('## Policy di consultazione (agent)', '## Percorso di lettura consigliato')
            .replace('Documenti da consultare **sempre**:', 'Per orientarti rapidamente:')
            .replace('Documenti da consultare **al bisogno**:', 'Approfondimenti utili:')
            .replace(/\n- Playbook orchestrazione lavoro con Linear\/Codex:[^\n]*/g, '')
            .replace(/\n- Tooling documentale Apple \(MCP\):[^\n]*/g, '')
            .replace(/\| FAQ pubbliche \| \[docs\/FAQ\.md\]\(\.\/FAQ\.md\) \| `SECONDARY` \|[^\n]*/g, '| FAQ pubbliche | [docs/FAQ.md](./FAQ.md) | `SECONDARY` | Sintesi rapida per capire cosa fa oggi MediFlow, quali sono i boundary dichiarati e come orientarsi nel progetto. |')
            .replace(/\n- `docs\/private\/openhospital-alignment\/\*`:[^\n]*/g, '')
            .replace(/\n- Alcuni documenti interni[^\n]*/g, '')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+$/g, '\n');

        content = content.replace(
            /## Percorso di lettura consigliato[\s\S]*?## Convenzione stato documenti/m,
            `## Percorso di lettura consigliato

Per orientarti rapidamente:

1. [README.md](../README.md)
2. [docs/README.md](./README.md) (questo file)
3. [ARCHITECTURE.md](../ARCHITECTURE.md)
4. [SECURITY.md](../SECURITY.md)
5. [CONTRIBUTING.md](../CONTRIBUTING.md)
6. [docs/ROADMAP.md](./ROADMAP.md)
7. [docs/walkthrough.md](./walkthrough.md)
8. [docs/adr/](./adr/README.md) (partendo dai più recenti)

Approfondimenti utili:

- Mappa completa markdown: [docs/markdown-index.md](./markdown-index.md)
- FAQ pubbliche e stato sintetico del prodotto: [docs/FAQ.md](./FAQ.md)
- Walkthrough operativo end-to-end: [docs/walkthrough.md](./walkthrough.md)
- Parity web/macOS: [docs/parity-matrix.md](./parity-matrix.md)
- Contratto OpenAPI \`/api/v1\`: [docs/openapi/mediflow-v1.yaml](./openapi/mediflow-v1.yaml), [docs/openapi/README.md](./openapi/README.md), [docs/adr/0010-openapi-spec-first-for-api-v1.md](./adr/0010-openapi-spec-first-for-api-v1.md)

## Convenzione stato documenti`
        );

        if (content !== original) {
            fs.writeFileSync(docsReadmePath, content, 'utf8');
            console.log('Sanitized docs/README.md public copy.');
        }
    }

    const markdownIndexPath = path.join(targetDir, 'docs', 'markdown-index.md');
    if (fs.existsSync(markdownIndexPath)) {
        const original = fs.readFileSync(markdownIndexPath, 'utf8');
        const content = original
            .replace(/\n- Nella repo OSS[^\n]*/g, '')
            .replace('## Orchestrazione e governance (consultazione sempre)', '## Orientamento e governance')
            .replace('## Tracciabilità agent e metadoc', '## Indici e contratti tecnici')
            .replace(/\| \[docs\/FAQ\.md\]\(\.\/FAQ\.md\) \| FAQ sintetiche pubbliche:[^\n]*/g, '| [docs/FAQ.md](./FAQ.md) | FAQ sintetiche pubbliche: stato attuale del prodotto, boundary dichiarati e orientamento rapido. | Per onboarding rapido o lettura pubblica del progetto. |')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+$/g, '\n');

        if (content !== original) {
            fs.writeFileSync(markdownIndexPath, content, 'utf8');
            console.log('Sanitized docs/markdown-index.md public copy.');
        }
    }

    const statePath = path.join(targetDir, 'docs', 'STATE_OF_THE_SYSTEM.md');
    if (fs.existsSync(statePath)) {
        const original = fs.readFileSync(statePath, 'utf8');
        const content = original
            .replace(
                /\nQuando esporti OSS:\n\n- esegui `MEDIFLOW_OSS_TARGET_DIR=<target> npm run prepare:oss` su una\n  destinazione di prova;\n- verifica che non compaiano DB, runtime artifacts o documenti interni;\n- cerca termini interni e riferimenti privati;\n- aggiorna `oss-assets\/README\.md` se cambia la facciata pubblica\.\n/g,
                '\n'
            )
            .replace(/\nMEDIFLOW_OSS_TARGET_DIR=\/tmp\/mediflow-oss-docs-check npm run prepare:oss\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .replace(/\s+$/g, '\n');

        if (content !== original) {
            fs.writeFileSync(statePath, content, 'utf8');
            console.log('Sanitized docs/STATE_OF_THE_SYSTEM.md public copy.');
        }
    }
}

function sanitizeSecurityForOss(targetDir) {
    const securityPath = path.join(targetDir, 'SECURITY.md');
    if (!fs.existsSync(securityPath)) return;

    const original = fs.readFileSync(securityPath, 'utf8');
    const sanitized = original
        .replace(/\n## Comparator cloud opt-in[\s\S]*?\n---\n\n## Logging e redazione/m, '\n## Logging e redazione')
        .replace(/\n- case pack privati\/comparator cloud o output non minimizzati di shadow eval/g, '')
        .replace(/canale privato/g, 'canale riservato')
        .replace(/Preferisci canale riservato/g, 'Preferisci un canale riservato')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/\s+$/g, '\n');

    if (sanitized !== original) {
        fs.writeFileSync(securityPath, sanitized, 'utf8');
        console.log('Sanitized SECURITY.md for OSS.');
    }
}

function sanitizeClaimsGuardForOss(targetDir) {
    const claimsGuardPath = path.join(targetDir, 'scripts', 'check-claims-guard.mjs');
    if (!fs.existsSync(claimsGuardPath)) return;

    const original = fs.readFileSync(claimsGuardPath, 'utf8');
    const sanitized = original
        .replace("'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CONTRIBUTING.md', 'PLANS.md',", "'README.md', 'ARCHITECTURE.md', 'SECURITY.md', 'CONTRIBUTING.md',")
        .replace("'docs/private', ", '')
        .replace(/\nskipped\.push\(`\$\{path\.sep\}docs\$\{path\.sep\}linear-completed-issues-archive-2026-05-21\.md`\);\n/, '\n');

    if (sanitized !== original) {
        fs.writeFileSync(claimsGuardPath, sanitized, 'utf8');
        console.log('Sanitized scripts/check-claims-guard.mjs for OSS.');
    }
}

function copyRecursive(src, dest, relPath = '') {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const files = fs.readdirSync(src);
        for (const file of files) {
            const childRelPath = relPath ? path.join(relPath, file) : file;
            if (shouldExclude(childRelPath, file)) continue;
            copyRecursive(path.join(src, file), path.join(dest, file), childRelPath);
        }
    } else {
        // File copy with replacement
        const content = fs.readFileSync(src);

        // Only replace text in text files
        if (isTextFile(src)) {
            let text = content.toString('utf8');
            for (const rep of REPLACEMENTS) {
                text = text.replace(rep.from, rep.to);
            }
            fs.writeFileSync(dest, text, 'utf8');
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

try {
    console.log(`Preparing OSS release...`);
    console.log(`Source: ${SOURCE_DIR}`);
    console.log(`Target: ${TARGET_DIR}`);

    if (fs.existsSync(TARGET_DIR)) {
        console.log('Cleaning target directory (preserving .git)...');
        if (fs.existsSync(path.join(TARGET_DIR, '.git'))) {
            const textFiles = fs.readdirSync(TARGET_DIR);
            for (const file of textFiles) {
                if (file === '.git') continue;
                fs.rmSync(path.join(TARGET_DIR, file), { recursive: true, force: true });
            }
        } else {
            fs.rmSync(TARGET_DIR, { recursive: true, force: true });
            fs.mkdirSync(TARGET_DIR);
        }
    } else {
        fs.mkdirSync(TARGET_DIR);
    }

    console.log('Copying files...');
    copyRecursive(SOURCE_DIR, TARGET_DIR);

    // Overwrite README and LICENSE and other assets
    console.log('Applying OSS assets...');
    if (fs.existsSync(path.join(SOURCE_DIR, 'oss-assets'))) {
        const assets = fs.readdirSync(path.join(SOURCE_DIR, 'oss-assets'));
        for (const asset of assets) {
            fs.copyFileSync(path.join(SOURCE_DIR, 'oss-assets', asset), path.join(TARGET_DIR, asset));
        }
    }

    console.log('Sanitizing internal markdown references...');
    sanitizeMarkdownReferences(TARGET_DIR);
    sanitizePackageJsonForOss(TARGET_DIR);
    sanitizeContributingForOss(TARGET_DIR);
    sanitizePublicDocsCopyForOss(TARGET_DIR);
    sanitizeSecurityForOss(TARGET_DIR);
    sanitizeClaimsGuardForOss(TARGET_DIR);

    console.log('Done! Open Source version ready at: ' + TARGET_DIR);
} catch (e) {
    console.error('Error:', e);
}
