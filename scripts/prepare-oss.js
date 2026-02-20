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
    'node_modules',
    '.next',
    '.vscode',
    '.DS_Store',
    '.env',
    '.env.local',
    'scripts',
    'oss-assets',
    'brain',
    '.gemini',
    'Farmaci'
];

const TO_EXCLUDE_BY_PATH = [
    'AGENTS.md',
    'docs/agent-attribution.md',
    'docs/private'
];

const REPLACEMENTS = [
    { from: /Leonardo Pegollo/g, to: 'Nome Medico' },
    { from: /Pegollo/g, to: 'Medico' },
    { from: /Ambulatorio del Medico di Distretto/g, to: 'Nome Ambulatorio' },
    { from: /Dr\. Leonardo Pegollo/g, to: 'Dr. Nome Medico' }
];

const MARKDOWN_LINK_PATTERN = /(!?)\[([^\]]*)\]\(([^)]+)\)/g;
const INLINE_DOC_REF_PATTERN = /`([^`\n]*?\.md(?:#[^`\n]+)?)`/g;

function normalizePathForMatch(inputPath) {
    return inputPath.split(path.sep).join('/');
}

function shouldExclude(relPath, itemName) {
    const normalizedRelPath = normalizePathForMatch(relPath);
    if (TO_EXCLUDE_BY_NAME.includes(itemName)) return true;

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

        if (content !== original) {
            fs.writeFileSync(markdownFile, content, 'utf8');
            updatedFiles += 1;
        }
    }

    console.log(
        `Sanitized markdown references: ${updatedFiles} files, ` +
        `${strippedLinks} link(s) downgraded, ${downgradedInlineRefs} inline ref(s) downgraded.`
    );
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

    console.log('Done! Open Source version ready at: ' + TARGET_DIR);
} catch (e) {
    console.error('Error:', e);
}
