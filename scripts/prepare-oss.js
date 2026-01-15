const fs = require('fs');
const path = require('path');

const SOURCE_DIR = path.resolve(__dirname, '..');
const TARGET_DIR = path.resolve(__dirname, '../../medical-record-app-oss');

// Config
const TO_EXCLUDE = [
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
    '.gemini'
];

const REPLACEMENTS = [
    { from: /Leonardo Pegollo/g, to: 'Nome Medico' },
    { from: /Pegollo/g, to: 'Medico' },
    { from: /Ambulatorio del Medico di Distretto/g, to: 'Nome Ambulatorio' },
    { from: /Dr\. Leonardo Pegollo/g, to: 'Dr. Nome Medico' }
];

function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest);
        }
        const files = fs.readdirSync(src);
        for (const file of files) {
            if (TO_EXCLUDE.includes(file)) continue;
            copyRecursive(path.join(src, file), path.join(dest, file));
        }
    } else {
        // File copy with replacement
        const content = fs.readFileSync(src);

        // Only replace text in text files
        if (src.endsWith('.ts') || src.endsWith('.tsx') || src.endsWith('.js') || src.endsWith('.json') || src.endsWith('.md')) {
            let text = content.toString('utf8');
            const original = text;
            for (const rep of REPLACEMENTS) {
                text = text.replace(rep.from, rep.to);
            }
            fs.writeFileSync(dest, text);
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

    // Overwrite README and LICENSE
    console.log('Applying OSS assets...');
    if (fs.existsSync(path.join(SOURCE_DIR, 'oss-assets', 'README.md'))) {
        fs.copyFileSync(path.join(SOURCE_DIR, 'oss-assets', 'README.md'), path.join(TARGET_DIR, 'README.md'));
    }
    if (fs.existsSync(path.join(SOURCE_DIR, 'oss-assets', 'LICENSE'))) {
        fs.copyFileSync(path.join(SOURCE_DIR, 'oss-assets', 'LICENSE'), path.join(TARGET_DIR, 'LICENSE'));
    }

    console.log('Done! Open Source version ready at: ' + TARGET_DIR);
} catch (e) {
    console.error('Error:', e);
}
