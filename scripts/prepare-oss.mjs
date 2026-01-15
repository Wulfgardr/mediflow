
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
    'scripts', // Don't include this script in the output
    'oss-assets', // Don't include the assets folder itself
    'brain', // Exclude internal brain artifacts if any
    '.gemini'
];

const REPLACEMENTS = [
    { from: /Leonardo Pegollo/g, to: 'Nome Medico' },
    { from: /Pegollo/g, to: 'Medico' },
    { from: /Ambulatorio del Medico di Distretto/g, to: 'Nome Ambulatorio' },
    { from: /Dr\. Leonardo Pegollo/g, to: 'Dr. Nome Medico' }
];

async function copyRecursive(src, dest) {
    const stats = fs.statSync(src);
    if (stats.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest);
        }
        const files = fs.readdirSync(src);
        for (const file of files) {
            if (TO_EXCLUDE.includes(file)) continue;
            // Also exclude the Farmaci folder contents except maybe a sample? 
            // User said "sfruttabile in pieno", so maybe keep Farmaci but empty or with sample?
            // Actually, keep Farmaci structure but maybe not all files if they are huge? 
            // The user wants a functioning app. I'll keep them for now unless they are sensitive.
            // They are AIFA open data, so likely fine.

            await copyRecursive(path.join(src, file), path.join(dest, file));
        }
    } else {
        // File copy with replacement
        let content = fs.readFileSync(src);

        // Only replace text in text files
        if (src.endsWith('.ts') || src.endsWith('.tsx') || src.endsWith('.js') || src.endsWith('.json') || src.endsWith('.md')) {
            let text = content.toString('utf8');
            let original = text;
            for (const rep of REPLACEMENTS) {
                text = text.replace(rep.from, rep.to);
            }
            if (text !== original) {
                console.log(`Sanitized: ${path.relative(SOURCE_DIR, src)}`);
            }
            fs.writeFileSync(dest, text);
        } else {
            fs.copyFileSync(src, dest);
        }
    }
}

async function main() {
    console.log(`Preparing OSS release...`);
    console.log(`Source: ${SOURCE_DIR}`);
    console.log(`Target: ${TARGET_DIR}`);

    if (fs.existsSync(TARGET_DIR)) {
        console.log('Cleaning target directory (preserving .git)...');
        // Delete everything except .git
        const textFiles = fs.readdirSync(TARGET_DIR);
        for (const file of textFiles) {
            if (file === '.git') continue;
            fs.rmSync(path.join(TARGET_DIR, file), { recursive: true, force: true });
        }
    } else {
        fs.mkdirSync(TARGET_DIR);
    }

    console.log('Copying files...');
    await copyRecursive(SOURCE_DIR, TARGET_DIR);

    // Overwrite README and LICENSE
    console.log('Applying OSS assets...');
    fs.copyFileSync(path.join(SOURCE_DIR, 'oss-assets', 'README.md'), path.join(TARGET_DIR, 'README.md'));
    fs.copyFileSync(path.join(SOURCE_DIR, 'oss-assets', 'LICENSE'), path.join(TARGET_DIR, 'LICENSE'));

    console.log('Done! Open Source version ready at: ' + TARGET_DIR);
}

main().catch(console.error);
