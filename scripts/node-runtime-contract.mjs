#!/usr/bin/env node
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const defaultRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export const SQLITE_PREBUILDS = {
    "darwin-arm64": {
        "archive": "664a814a90450eb472f7297d1992b7dc2b512c37cabbd9a1029b3e858e7a981c",
        "binary": "f4ab8ddc57768a1342fad1a948c7ff943fe553ebd73671054cd58c1f7cd33021"
    },
    "darwin-x64": {
        "archive": "fe062db9af00cd6d49e64777bc1bb0933644ae1a10bba6d9162e83191068227a",
        "binary": "94360f9f3d8d924f161e8a93ab5599f9d4954950c8e1105b0991d5a3108e28bb"
    },
    "linux-arm64": {
        "archive": "4e66c2c0cbe200206008a35fbcfb8a893aa475df223a1100ccc50d6dd2dce844",
        "binary": "145193b7aad7e02d51ae9c6376c81de1e05af4af9cf9c7097b5eb38d4b22f036"
    },
    "linux-x64": {
        "archive": "3138ba6a9268b70a194b212809c12967b77ac286d65645f8fb01472464b9865b",
        "binary": "0ce99d60cc96c6aeea33438748d6c0a8d585f8dec24a10dbe5c68dcaed29ef83"
    },
    "win32-x64": {
        "archive": "697a0e0cf5068742b6ef01c6c91b6dd7e3a838822ab037e6d6f5cd7508f3ac3e",
        "binary": "d57f5f983a4885855b5d22b102c71ffd567bd219ef428f5f7dc1d9d23b9ddb54"
    },
    "win32-arm64": {
        "archive": "438a54b43b1fd33a2bff584f9ae18cce9b588018dd25618b06d0b86e4f072106",
        "binary": "ea687d1228417aaeb9dc3c57a2bb074cafded007c3e3c5bd15dae5c1d04b19d7"
    },
    "linuxmusl-x64": {
        "archive": "99823652951e0a0b41a8915fdff4b987343168bb9b6449af0e0c1baaf1b1b2d6",
        "binary": "959f1e74e9f27a0233606f210db2341aa14ba51c123e6679802e4eefd390869d"
    },
    "linuxmusl-arm64": {
        "archive": "5b95080fe2dd7c6b293e6b06ab883745a621191c84f2596a24428e32f456edda",
        "binary": "d83972b5bf08bfc511a9fbd6a21b18ac425e2e42e2805d368f62b01e3a306e88"
    }
};

export function sqlitePrebuildTarget() {
    const platform = process.platform === "linux" && !process.report.getReport().header.glibcVersionRuntime ? "linuxmusl" : process.platform;
    return `${platform}-${process.arch}`;
}

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

export function verifyNativeBindingInChild(root = defaultRoot) {
    const env = { ...process.env };
    for (const name of ['NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH']) delete env[name];
    execFileSync(process.execPath, [fileURLToPath(import.meta.url), 'probe-native-binding', path.resolve(root)],
        { env, windowsHide: true, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
}

export function verifyNativeBinding(root = defaultRoot, nativeBinding = undefined) {
    const runtimeRoot = fs.realpathSync(root);
    const requireFromRoot = createRequire(path.join(runtimeRoot, 'package.json'));
    const packageRoot = path.join(runtimeRoot, 'node_modules/better-sqlite3');
    const packageJson = requireFromRoot.resolve('better-sqlite3/package.json');
    const entry = requireFromRoot.resolve('better-sqlite3');
    if (fs.realpathSync(packageRoot) !== packageRoot
        || packageJson !== path.join(packageRoot, 'package.json')
        || fs.realpathSync(packageJson) !== packageJson
        || !entry.startsWith(`${packageRoot}${path.sep}`)
        || fs.realpathSync(entry) !== entry) {
        throw new Error('better-sqlite3 must resolve from the selected runtime physical node_modules package.');
    }
    const Database = requireFromRoot(entry);
    const db = new Database(':memory:', { nativeBinding });
    try {
        if (db.prepare('select 1 as value').get().value !== 1) throw new Error('SQLite probe failed.');
    } finally {
        db.close();
    }
}

export function verifyPinnedNativeBinding(root = defaultRoot) {
    const binary = path.join(root, 'node_modules/better-sqlite3', 'build/Release/better_sqlite3.node');
    const expected = SQLITE_PREBUILDS[sqlitePrebuildTarget()];
    if (!expected || JSON.parse(fs.readFileSync(path.join(root, 'node_modules/better-sqlite3/package.json'), 'utf8')).version !== '12.6.2'
        || fs.realpathSync(binary) !== binary || !fs.lstatSync(binary).isFile()
        || crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') !== expected.binary) {
        throw new Error('Prebuild SQLite non ammesso. Esegui npm run prepare:dependencies dopo npm ci.');
    }
    verifyNativeBinding(root, binary);
}

export function standaloneDirectory(root = defaultRoot, environment = process.env) {
    return path.join(root, environment.MEDIFLOW_NEXT_DIST_DIR || '.next', 'standalone');
}

export function writeStandaloneManifest(root = defaultRoot) {
    const contract = readNodeContract(root);
    const runtime = assertNodeRuntime(contract);
    verifyPinnedNativeBinding(root);
    const dependency = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/better-sqlite3/package.json'), 'utf8'));
    const output = path.join(standaloneDirectory(root), 'mediflow-runtime-contract.json');
    fs.writeFileSync(output, `${JSON.stringify({
        schemaVersion: 1,
        distDir: path.basename(path.dirname(standaloneDirectory(root))),
        node: { major: contract.major, version: runtime.version, moduleVersion: runtime.moduleVersion },
        platform: process.platform,
        arch: process.arch,
        betterSqlite3Version: dependency.version,
    }, null, 2)}\n`);
    return output;
}

function main() {
    const command = process.argv[2] || 'verify';
    if (command === 'probe-native-binding') {
        if (process.platform !== 'win32' || process.argv.length !== 4 || !path.isAbsolute(process.argv[3])) throw new Error('Invalid native binding probe arguments.');
        verifyNativeBinding(process.argv[3]);
        return;
    }
    const contract = readNodeContract();
    const runtime = assertNodeRuntime(contract);
    if (command === 'verify') verifyPinnedNativeBinding();
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
