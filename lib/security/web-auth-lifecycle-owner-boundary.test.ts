/* @Codex */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    realpathSync,
    rmSync,
    statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PACKAGE_DIRECTORY = join(REPOSITORY_ROOT, 'packages/web-auth-lifecycle-owner');
const ARTIFACT_RELATIVE_PATH =
    'packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.6.tgz';
const ARTIFACT_PATH = join(REPOSITORY_ROOT, ARTIFACT_RELATIVE_PATH);
const PROVENANCE_PATH = join(
    REPOSITORY_ROOT,
    'packages/web-auth-lifecycle-owner/artifacts/mediflow-web-auth-lifecycle-owner-0.8.6.provenance.json',
);
const DEPENDENCY_SPECIFIER = `file:${ARTIFACT_RELATIVE_PATH}`;
const ARTIFACT_SHA256 = '044dfb1a9aedfc52da181707ddab2c582c097909d2f54cff886f6f33273f2b45';
const ARTIFACT_INTEGRITY =
    'sha512-itcn0K8Ru1BHWcpd4sVOrzl0qMX4+8gZr+EX+JABsdOid0yYz2qgYJX5naSBPLp+6xkz7X/a5TieIJ25OKQlmw==';
const PROVENANCE_SHA256 = '66c4e11cd29657fc824308a4ded5bfa6fe212fdc6ccef869dcddb6d86bddfca4';
const ACCEPTED_BASE = '5fa27923613b1932993a57f46b06e51264193e01';
const PREDECESSOR_ARTIFACT_PATH = join(
    PACKAGE_DIRECTORY,
    'artifacts/mediflow-web-auth-lifecycle-owner-0.8.5.tgz',
);
const PREDECESSOR_PROVENANCE_PATH = join(
    PACKAGE_DIRECTORY,
    'artifacts/mediflow-web-auth-lifecycle-owner-0.8.5.provenance.json',
);
const PREDECESSOR_ARTIFACT_SHA256 = 'c9e64cd0857a8c9e0e869857af9f023654e79ac2959d630dd2eff14fc90bcf2c';
const PREDECESSOR_PROVENANCE_SHA256 = '1d745decc7676c7ef11d0837e7300e8da5159785b10e7a79ef581ddd050696f3';

const EXPECTED_INPUTS = [
    ['index.js', 116, '1abc52ee8abe9fd25b28046f1f00ecc2f09d699ba220c61e6222730c22ca44c5'],
    ['index.d.ts', 3529, '647385b9d57d2bd2309f70de08866d326736c200f2fce201e54857ec63da3987'],
    ['internal/control-record.cjs', 19478, '3d443096679799ffde96e744060de5be59c9a86ddb383bdd975de75c913b9aa4'],
    ['internal/owner.cjs', 37866, 'f9d5e54e89a41788ecdf228841473a7210616fc054d9b3e3ded6316a91c94d2d'],
    ['internal/session-activation.cjs', 6143, '5ed4c9543f8bc15903c0915a8565b997d697d004e9ccfaaa54a3da6236a2aa96'],
    ['internal/session-cell.cjs', 23897, '4cd0c2e9f8b40b346d43a93de561e20e85c5662fc8a2f9a0a170403fc80c2e31'],
    ['internal/session-resolver.cjs', 2965, '75409d670b8411dbadcc95e4bd9bfebeff47d2f687bde0d638809bb9114b5fa0'],
    ['internal/session-resource.cjs', 14096, '127de77dfb73f91f313e5318fd64e838f3f5e3147e801e19b492e0876127d876'],
    ['internal/session-retirement.cjs', 5664, '8848c92cb88635c6c09baf685839e7c6f1aca40d667ea6580e84e275349f1516'],
    ['internal/support/successor-fence.cjs', 1172, '7e36178331d5f899d81d877603acb0100eef1436d1873287ad4b27ccc227e7ff'],
    ['internal/support/value.cjs', 47, '9f0968a0290c6184c898f06de2c408540d4eda1ecd0e3e80ae013bb37a782be1'],
    ['package.json', 281, '06f785441953621ac6b2fd6f313471f8bbd33bd730d1e603de94b45da382f99d'],
] as const;

const EXPECTED_TAR_PATHS = [
    'internal/control-record.cjs',
    'internal/owner.cjs',
    'internal/session-activation.cjs',
    'internal/session-cell.cjs',
    'internal/session-resolver.cjs',
    'internal/session-resource.cjs',
    'internal/session-retirement.cjs',
    'internal/support/successor-fence.cjs',
    'internal/support/value.cjs',
    'index.js',
    'package.json',
    'index.d.ts',
] as const;

const ROOT_KEYS = [
    'bootstrapControl',
    'begin',
    'issue',
    'abort',
    'resolve',
    'retire',
    'retireForUser',
    'prepareUserRetirement',
    'commitUserRetirement',
    'abortUserRetirement',
    'prepareAdminReset',
    'commitAdminReset',
    'abortAdminReset',
    'mintResourcePort',
    'releaseResourcePort',
    'beginResourceUse',
    'commitResourceUse',
    'abortResourceUse',
    'withCurrentResourceBinding',
    'registerPrivateResource',
    'unregisterPrivateResource',
] as const;

type JsonRecord = Record<string, unknown>;
type TarEntry = {
    path: string;
    type: string;
    mode: number;
    uid: number;
    gid: number;
    mtime: number;
    bytes: number;
    sha256: string;
};

function sha256(value: Buffer | string): string {
    return createHash('sha256').update(value).digest('hex');
}

function readJson(path: string): JsonRecord {
    return JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;
}

function tarText(header: Buffer, start: number, length: number): string {
    return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/u, '').trim();
}

function tarOctal(header: Buffer, start: number, length: number): number {
    const value = tarText(header, start, length);
    return value ? Number.parseInt(value, 8) : 0;
}

function parseTar(archive: Buffer): TarEntry[] {
    const tar = gunzipSync(archive);
    const entries: TarEntry[] = [];
    let offset = 0;
    while (offset + 512 <= tar.length) {
        const header = tar.subarray(offset, offset + 512);
        if (header.every((byte) => byte === 0)) break;
        const prefix = tarText(header, 345, 155);
        const name = tarText(header, 0, 100);
        const bytes = tarOctal(header, 124, 12);
        const bodyStart = offset + 512;
        const body = tar.subarray(bodyStart, bodyStart + bytes);
        assert.equal(body.length, bytes, `truncated tar body: ${name}`);
        entries.push({
            path: prefix ? `${prefix}/${name}` : name,
            type: tarText(header, 156, 1) || '0',
            mode: tarOctal(header, 100, 8),
            uid: tarOctal(header, 108, 8),
            gid: tarOctal(header, 116, 8),
            mtime: tarOctal(header, 136, 12),
            bytes,
            sha256: sha256(body),
        });
        offset = bodyStart + Math.ceil(bytes / 512) * 512;
    }
    return entries;
}

function walkFiles(directory: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) files.push(...walkFiles(path));
        else if (entry.isFile()) files.push(path);
    }
    return files;
}

test('preserves the accepted 0.8.5 artifact and provenance as immutable predecessor evidence', () => {
    assert.equal(sha256(readFileSync(PREDECESSOR_ARTIFACT_PATH)), PREDECESSOR_ARTIFACT_SHA256);
    assert.equal(sha256(readFileSync(PREDECESSOR_PROVENANCE_PATH)), PREDECESSOR_PROVENANCE_SHA256);
});

test('pins the exact final source manifest and immutable input bytes', () => {
    const manifest = readJson(join(PACKAGE_DIRECTORY, 'package.json'));
    assert.deepEqual(manifest, {
        name: '@mediflow/web-auth-lifecycle-owner',
        version: '0.8.6',
        private: true,
        type: 'commonjs',
        main: './index.js',
        types: './index.d.ts',
        exports: './index.js',
        files: ['index.js', 'index.d.ts', 'internal/'],
        engines: { node: '>=24 <25' },
    });

    const actualSourceFiles = walkFiles(PACKAGE_DIRECTORY)
        .filter((path) => !path.includes('/artifacts/'))
        .map((path) => relative(PACKAGE_DIRECTORY, path))
        .sort();
    assert.deepEqual(actualSourceFiles, EXPECTED_INPUTS.map(([path]) => path).sort());

    for (const [path, bytes, expectedSha256] of EXPECTED_INPUTS) {
        const content = readFileSync(join(PACKAGE_DIRECTORY, path));
        assert.equal(content.length, bytes, path);
        assert.equal(sha256(content), expectedSha256, path);
    }
});

test('pins the final tarball and its normalized regular-file roster', () => {
    const archive = readFileSync(ARTIFACT_PATH);
    assert.equal(archive.length, 19_785);
    assert.equal(sha256(archive), ARTIFACT_SHA256);
    assert.equal(`sha512-${createHash('sha512').update(archive).digest('base64')}`, ARTIFACT_INTEGRITY);

    const entries = parseTar(archive);
    assert.equal(entries.length, EXPECTED_INPUTS.length);
    assert.deepEqual(
        entries.map(({ path, type, mode, uid, gid, mtime, bytes, sha256: digest }) => ({
            path,
            type,
            mode,
            uid,
            gid,
            mtime,
            bytes,
            sha256: digest,
        })),
        EXPECTED_TAR_PATHS.map((path) => {
            const input = EXPECTED_INPUTS.find(([inputPath]) => inputPath === path);
            assert.ok(input, path);
            const [, bytes, digest] = input;
            return {
            path: `package/${path}`,
            type: '0',
            mode: 0o644,
            uid: 0,
            gid: 0,
            mtime: Number.parseInt('3560116604', 8),
            bytes,
            sha256: digest,
            };
        }),
    );
});

test('reproduces the tracked artifact byte-for-byte from two clean offline source copies', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'mediflow-owner-086-pack-'));
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
        const artifacts: Buffer[] = [];
        for (const suffix of ['a', 'b']) {
            const source = join(temporaryRoot, `source-${suffix}`);
            const output = join(temporaryRoot, `output-${suffix}`);
            const cache = join(temporaryRoot, `cache-${suffix}`);
            mkdirSync(output, { recursive: true });
            for (const [path] of EXPECTED_INPUTS) {
                const target = join(source, path);
                mkdirSync(dirname(target), { recursive: true });
                copyFileSync(join(PACKAGE_DIRECTORY, path), target);
            }
            const packed = spawnSync(npmCommand, [
                'pack', source, '--ignore-scripts', '--offline', '--cache', cache,
                '--pack-destination', output,
            ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
            assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
            artifacts.push(readFileSync(join(output, 'mediflow-web-auth-lifecycle-owner-0.8.6.tgz')));
        }
        assert.ok(artifacts[0]);
        assert.ok(artifacts[1]);
        assert.equal(artifacts[0].equals(artifacts[1]), true);
        assert.equal(artifacts[0].equals(readFileSync(ARTIFACT_PATH)), true);
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('binds provenance to the accepted base, predecessor, inputs, and tar roster', () => {
    const bytes = readFileSync(PROVENANCE_PATH);
    assert.equal(bytes.length, 5_898);
    assert.equal(sha256(bytes), PROVENANCE_SHA256);
    const provenance = JSON.parse(bytes.toString('utf8')) as JsonRecord;
    assert.equal(provenance.schemaVersion, 'mediflow.web-auth-lifecycle-owner.package-provenance.v1');
    assert.equal(provenance.acceptedBase, ACCEPTED_BASE);
    assert.deepEqual(provenance.predecessor, {
        version: '0.8.5',
        tarSha256: PREDECESSOR_ARTIFACT_SHA256,
        provenanceSha256: PREDECESSOR_PROVENANCE_SHA256,
    });
    assert.deepEqual(provenance.package, {
        name: '@mediflow/web-auth-lifecycle-owner',
        version: '0.8.6',
    });
    assert.deepEqual(provenance.pack, {
        command: 'npm pack <clean-temporary-copy> --ignore-scripts --offline --cache <empty-temporary-cache> --pack-destination <temporary-directory>',
        runs: 2,
        sourceCopies: 2,
        network: 'offline',
        scripts: 'ignored',
        cache: 'empty_temporary',
        byteIdentical: true,
    });
    assert.deepEqual(provenance.installation, {
        command: 'npm install --offline --ignore-scripts --no-audit --no-fund --cache <empty-temporary-cache> <tracked-tarball>',
        scratch: 'empty_package',
        physical: true,
        symlink: false,
        hardlink: false,
    });
    assert.deepEqual(provenance.artifact, {
        path: ARTIFACT_RELATIVE_PATH,
        bytes: 19_785,
        sha256: ARTIFACT_SHA256,
        integrity: ARTIFACT_INTEGRITY,
    });
    assert.deepEqual(
        provenance.inputs,
        EXPECTED_INPUTS.map(([path, bytes, digest]) => ({ path, bytes, sha256: digest })),
    );
    assert.deepEqual(
        provenance.roster,
        parseTar(readFileSync(ARTIFACT_PATH)).map(({ path, type, mode, bytes, sha256: digest }) => ({
            path,
            type: type === '0' ? 'file' : type,
            mode: mode.toString(8).padStart(4, '0'),
            bytes,
            sha256: digest,
        })),
    );
});

test('installs exactly one physical package copy from the pinned artifact', () => {
    const packageJson = readJson(join(REPOSITORY_ROOT, 'package.json'));
    const packageLock = readJson(join(REPOSITORY_ROOT, 'package-lock.json'));
    const dependencies = packageJson.dependencies as JsonRecord;
    const lockPackages = packageLock.packages as JsonRecord;
    const lockRoot = lockPackages[''] as JsonRecord;
    const lockRootDependencies = lockRoot.dependencies as JsonRecord;
    const lockEntry = lockPackages['node_modules/@mediflow/web-auth-lifecycle-owner'] as JsonRecord;
    assert.equal(dependencies['@mediflow/web-auth-lifecycle-owner'], DEPENDENCY_SPECIFIER);
    assert.equal(lockRootDependencies['@mediflow/web-auth-lifecycle-owner'], DEPENDENCY_SPECIFIER);
    assert.deepEqual(lockEntry, {
        version: '0.8.6',
        resolved: DEPENDENCY_SPECIFIER,
        integrity: ARTIFACT_INTEGRITY,
        engines: { node: '>=24 <25' },
    });

    const installedDirectory = join(REPOSITORY_ROOT, 'node_modules/@mediflow/web-auth-lifecycle-owner');
    const installedDirectoryStat = lstatSync(installedDirectory);
    assert.equal(installedDirectoryStat.isDirectory(), true);
    assert.equal(installedDirectoryStat.isSymbolicLink(), false);
    assert.equal(realpathSync(installedDirectory), installedDirectory);
    assert.notEqual(realpathSync(installedDirectory), realpathSync(PACKAGE_DIRECTORY));
    const installedManifest = readJson(join(installedDirectory, 'package.json'));
    assert.equal(installedManifest.version, '0.8.6');
    for (const [path, bytes, expectedSha256] of EXPECTED_INPUTS) {
        const installedPath = join(installedDirectory, path);
        const installedLstat = lstatSync(installedPath);
        const installedStat = statSync(installedPath);
        assert.equal(installedLstat.isFile(), true, `installed regular file ${path}`);
        assert.equal(installedLstat.isSymbolicLink(), false, `installed symlink ${path}`);
        assert.equal(installedStat.nlink, 1, `installed hardlink ${path}`);
        assert.equal(realpathSync(installedPath), installedPath, `installed realpath ${path}`);
        const content = readFileSync(installedPath);
        assert.equal(content.length, bytes, `installed ${path}`);
        assert.equal(sha256(content), expectedSha256, `installed ${path}`);
    }

    const installedCopies = walkFiles(join(REPOSITORY_ROOT, 'node_modules'))
        .filter((path) => basename(path) === 'package.json')
        .filter((path) => {
            try {
                return readJson(path).name === '@mediflow/web-auth-lifecycle-owner';
            } catch {
                return false;
            }
        });
    assert.deepEqual(installedCopies, [join(installedDirectory, 'package.json')]);
});

test('installs the tracked artifact offline as one physical scratch package', () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), 'mediflow-owner-086-install-'));
    const application = join(temporaryRoot, 'application');
    const cache = join(temporaryRoot, 'cache');
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    try {
        mkdirSync(application, { recursive: true });
        const installed = spawnSync(npmCommand, [
            'install', '--prefix', application, '--offline', '--ignore-scripts',
            '--no-audit', '--no-fund', '--cache', cache, ARTIFACT_PATH,
        ], { cwd: REPOSITORY_ROOT, encoding: 'utf8' });
        assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
        const packageDirectory = join(application, 'node_modules/@mediflow/web-auth-lifecycle-owner');
        const packageStat = lstatSync(packageDirectory);
        assert.equal(packageStat.isDirectory(), true);
        assert.equal(packageStat.isSymbolicLink(), false);
        assert.equal(
            realpathSync(packageDirectory),
            join(realpathSync(application), 'node_modules/@mediflow/web-auth-lifecycle-owner'),
        );
        for (const [path, bytes, expectedSha256] of EXPECTED_INPUTS) {
            const installedPath = join(packageDirectory, path);
            const installedLstat = lstatSync(installedPath);
            assert.equal(installedLstat.isFile(), true, path);
            assert.equal(installedLstat.isSymbolicLink(), false, path);
            assert.equal(statSync(installedPath).nlink, 1, path);
            const content = readFileSync(installedPath);
            assert.equal(content.length, bytes, path);
            assert.equal(sha256(content), expectedSha256, path);
        }
    } finally {
        rmSync(temporaryRoot, { recursive: true, force: true });
    }
});

test('exposes only the frozen final root and keeps the adapter package-only', () => {
    const requireFromHere = createRequire(import.meta.url);
    const owner = requireFromHere('@mediflow/web-auth-lifecycle-owner') as JsonRecord;
    assert.equal(Object.isFrozen(owner), true);
    assert.deepEqual(Object.keys(owner), ROOT_KEYS);
    for (const key of ROOT_KEYS) {
        assert.equal(typeof owner[key], 'function', key);
    }
    assert.equal(Object.hasOwn(owner, 'createOwner'), false);

    const adapter = readFileSync(join(REPOSITORY_ROOT, 'lib/security/web-auth-lifecycle-owner-adapter.ts'), 'utf8');
    const runtimeSpecifiers = [...adapter.matchAll(/^import\s+(?:[^'";]+\s+from\s+)?['"]([^'"]+)['"];?$/gmu)]
        .map((match) => match[1]);
    assert.deepEqual(runtimeSpecifiers, ['server-only', '@mediflow/web-auth-lifecycle-owner']);
    assert.match(adapter, /lifecycleOwnerAdapterState = 'external_owner_active'/u);
    assert.doesNotMatch(adapter, /web-auth-lifecycle-owner-legacy|globalThis|\b(?:Map|WeakMap|Set)\b/u);
    assert.equal(existsSync(join(REPOSITORY_ROOT, 'lib/security/web-auth-lifecycle-owner-legacy.ts')), false);

    const nextConfig = readFileSync(join(REPOSITORY_ROOT, 'next.config.ts'), 'utf8');
    const externalizationBlocks = nextConfig.match(/serverExternalPackages:\s*\[[^\]]*\]/gu) ?? [];
    assert.equal(externalizationBlocks.length, 1);
    assert.equal(externalizationBlocks[0]?.match(/@mediflow\/web-auth-lifecycle-owner/gu)?.length, 1);
    const deliveryMatches = nextConfig.match(
        /["']\.\/node_modules\/@mediflow\/web-auth-lifecycle-owner\/\*\*\/\*["']/gu,
    ) ?? [];
    assert.equal(deliveryMatches.length, 1);
    assert.equal(nextConfig.match(/@mediflow\/web-auth-lifecycle-owner/gu)?.length, 2);
});

test('leaves the historical owner cluster without production consumers', () => {
    const productionRoots = ['app', 'components', 'lib', 'scripts'];
    const sourceFiles = productionRoots.flatMap((directory) => walkFiles(join(REPOSITORY_ROOT, directory)))
        .filter((path) => /\.(?:cjs|mjs|js|jsx|ts|tsx)$/u.test(path))
        .filter((path) => !/\.(?:test|spec)\.[^.]+$/u.test(path));
    const historicalCluster = new Set([
        'lib/security/web-auth-control-owner.ts',
        'lib/security/web-auth-control-record.ts',
        'lib/security/web-auth-session-issuer.ts',
    ]);
    const forbiddenHistoricalImport = /(?:from\s+|require\(\s*)['"][^'"]*web-auth-(?:lifecycle-owner-legacy|session-issuer|control-owner|control-record)(?:\.[cm]?[jt]s)?['"]/u;
    const deepPackageImport = /@mediflow\/web-auth-lifecycle-owner\//u;
    const failures: string[] = [];
    for (const path of sourceFiles) {
        const repositoryPath = relative(REPOSITORY_ROOT, path);
        const source = readFileSync(path, 'utf8');
        if (!historicalCluster.has(repositoryPath) && forbiddenHistoricalImport.test(source)) {
            failures.push(`${repositoryPath}: historical owner import`);
        }
        if (deepPackageImport.test(source)) failures.push(`${repositoryPath}: deep package import`);
    }
    assert.deepEqual(failures, []);
});
