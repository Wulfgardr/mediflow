#!/usr/bin/env node
/* @Codex */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function readNodeContract(root = defaultRoot) {
    const major = Number(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim().replace(/^v/, ''));
    const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const engines = packageJson.engines?.node;
    if (!Number.isInteger(major) || engines !== `>=${major} <${major + 1}`) {
        throw new Error(`Contratto Node incoerente: .nvmrc=${major || 'invalid'}, engines=${engines || 'missing'}.`);
    }
    return { major, engines };
}

export function assertNodeRuntime(contract, runtime = process.versions) {
    const actualMajor = Number(runtime.node.split('.')[0]);
    if (actualMajor !== contract.major) {
        throw new Error(`Node ${contract.major}.x richiesto; runtime attuale ${runtime.node} (ABI ${runtime.modules}).`);
    }
    return { version: runtime.node, moduleVersion: String(runtime.modules) };
}

export function verifyNativeBinding(root = defaultRoot) {
    const requireFromRoot = createRequire(path.join(root, 'package.json'));
    const Database = requireFromRoot('better-sqlite3');
    const db = new Database(':memory:');
    try {
        if (db.prepare('select 1 as value').get().value !== 1) throw new Error('SQLite probe failed.');
    } finally {
        db.close();
    }
}

export function standaloneDirectory(root = defaultRoot, environment = process.env) {
    return path.join(root, environment.MEDIFLOW_NEXT_DIST_DIR || '.next', 'standalone');
}

export function writeStandaloneManifest(root = defaultRoot) {
    const contract = readNodeContract(root);
    const runtime = assertNodeRuntime(contract);
    verifyNativeBinding(root);
    const dependency = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/better-sqlite3/package.json'), 'utf8'));
    const output = path.join(standaloneDirectory(root), 'mediflow-runtime-contract.json');
    fs.writeFileSync(output, `${JSON.stringify({
        schemaVersion: 1,
        node: { major: contract.major, version: runtime.version, moduleVersion: runtime.moduleVersion },
        platform: process.platform,
        arch: process.arch,
        betterSqlite3Version: dependency.version,
    }, null, 2)}\n`);
    return output;
}

function main() {
    const command = process.argv[2] || 'verify';
    const contract = readNodeContract();
    const runtime = assertNodeRuntime(contract);
    if (command === 'verify') verifyNativeBinding();
    else if (command === 'write-standalone-manifest') writeStandaloneManifest();
    else if (command !== 'verify-node') throw new Error(`Comando sconosciuto: ${command}`);
    console.log(`[node-runtime] PASS Node ${runtime.version}, ABI ${runtime.moduleVersion}${command === 'verify' ? ', better-sqlite3 load' : ''}.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try { main(); } catch (error) {
        console.error(`[node-runtime] ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    }
}
