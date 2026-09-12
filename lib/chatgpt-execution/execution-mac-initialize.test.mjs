/* @Codex — run-owned installation_id preparation regression.
 * node --test lib/chatgpt-execution/execution-mac-initialize.test.mjs
 * Executes the EXACT private TypeScript helper after built-in type stripping.
 * Only fault tests substitute filesystem calls; no production exports/hooks.
 * Linux kernel tests use a behavioral C port + seccomp MODE denial, NOT the
 * upstream Rust executable or Darwin Seatbelt/whole-container qualification.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const qualification = fs.readFileSync(join(here, 'execution-mac-qualification.ts'), 'utf8');
const start = qualification.indexOf('function prepareMacInstallationId(');
const end = qualification.indexOf('/** Explicit host operation:', start);
assert.ok(start >= 0 && end > start, 'private source helper missing');
assert.equal(qualification.indexOf('function prepareMacInstallationId(', start + 1), -1);
const helperSource = qualification.slice(start, end);
const helperJs = stripTypeScriptTypes(helperSource);
// This is the delivered error class, not an issuer or authority test double.
const contract = stripTypeScriptTypes(fs.readFileSync(join(here, 'execution-contract.ts'), 'utf8'), { mode: 'transform' });
const { ExecutionError } = await import(`data:text/javascript;base64,${Buffer.from(contract).toString('base64')}`);
function helper(overrides = {}) {
    return runInNewContext(`(${helperJs})`, { ...fs, join, process, ExecutionError, ...overrides });
}
const prepare = helper();
function fixture(run) {
    const root = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'mfmac-initialize-test-')));
    fs.chmodSync(root, 0o700);
    fs.mkdirSync(join(root, 'codex'), { mode: 0o700 }); fs.chmodSync(join(root, 'codex'), 0o700);
    try { return run(root, join(root, 'codex', 'installation_id')); }
    finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function withMask(mask, run) { const before = process.umask(mask); try { return run(); } finally { process.umask(before); } }
function stamp(path) {
    const s = fs.lstatSync(path);
    return [s.dev, s.ino, s.uid, s.gid, s.mode, s.nlink, s.size, s.mtimeMs, s.ctimeMs];
}
const boundary = error => error instanceof ExecutionError && error.code === 'unqualified_boundary';
function sentinel(root, content = 'synthetic-protected') {
    const path = join(root, 'protected'); fs.writeFileSync(path, content, { flag: 'wx', mode: 0o400 }); fs.chmodSync(path, 0o400); return path;
}

test('integration is private, one-use, after earlier gate drain and before server launch', () => {
    assert.equal((qualification.match(/prepareMacInstallationId\(root\);/g) ?? []).length, 1);
    assert.match(qualification, /protocolMatched = true; check\(\);\s+stage = 'initialize';\s+prepareMacInstallationId\(root\); check\(\);\s+serverOwner = launchMacCustodian/);
    assert.doesNotMatch(qualification, /export\s+(?:async\s+)?function prepareMacInstallationId/);
    assert.match(helperSource, /constants\.O_EXCL \| constants\.O_NOFOLLOW/);
    assert.match(helperSource, /finally \{ closeSync\(fd\); \}/);
    assert.doesNotMatch(helperSource, /(?<!f)chmodSync|process\.umask|process\.env|writeFileSync|randomBytes|\bawait\b|console\./);
});
test('native source binding, restrictive umask and sandbox mode denial remain enforced', () => {
    // Historical whole-file hashes remain in the reviewed delivery manifest.
    const c = fs.readFileSync(join(here, '../../native/MediFlowMac/ExecutionCustodian/mac-owner.c'));
    const native = fs.readFileSync(join(here, 'execution-mac-native.ts'), 'utf8');
    const pin = native.match(/MAC_NATIVE_SOURCE = Object\.freeze\(\{ bytes: (\d+), sha256: '([a-f0-9]{64})' \}\)/);
    assert.ok(pin); assert.equal(c.length, Number(pin[1])); assert.equal(createHash('sha256').update(c).digest('hex'), pin[2]);
    assert.match(c.toString(), /umask\(0077\)/);
    assert.match(fs.readFileSync(join(here, 'execution-sandbox.ts'), 'utf8'), /\(deny file-write-mode file-write-owner file-write-flags\)/);
});
for (const mask of [0o000, 0o022, 0o077, 0o777]) test(`exclusive empty file gets exact 0644 regardless of host umask ${mask.toString(8)}`, () => fixture((root, path) => {
    const r = stamp(root), h = stamp(join(root, 'codex'));
    withMask(mask, () => { prepare(root); assert.equal(process.umask(), mask); });
    const s = fs.lstatSync(path);
    assert.equal(s.mode & 0o7777, 0o644); assert.equal(s.uid, process.getuid()); assert.equal(s.nlink, 1); assert.equal(s.size, 0);
    assert.equal(s.isFile(), true); assert.equal(s.isSymbolicLink(), false);
    // APFS directory link counts include new entries; identity/owner/mode stay fixed.
    assert.deepEqual(stamp(root), r); assert.deepEqual(stamp(join(root, 'codex')).slice(0, 5), h.slice(0, 5));
    assert.deepEqual(fs.readdirSync(join(root, 'codex')), ['installation_id']);
}));
for (const mode of [0o400, 0o600, 0o644]) test(`pre-existing file ${mode.toString(8)} is neither adopted, truncated nor chmodded`, () => fixture((root, path) => {
    fs.writeFileSync(path, '', { mode, flag: 'wx' }); fs.chmodSync(path, mode);
    const before = stamp(path); assert.throws(() => prepare(root), { code: 'EEXIST' }); assert.deepEqual(stamp(path), before);
}));
test('nonempty pre-existing file and second preparation fail without changing contents', () => fixture((root, path) => {
    prepare(root); fs.writeFileSync(path, 'synthetic-existing-id'); const before = stamp(path);
    assert.throws(() => prepare(root), { code: 'EEXIST' }); assert.equal(fs.readFileSync(path, 'utf8'), 'synthetic-existing-id'); assert.deepEqual(stamp(path), before);
}));
for (const kind of ['symlink', 'hardlink', 'dangling-symlink', 'directory']) test(`reject existing ${kind} without touching its target`, () => fixture((root, path) => {
    const target = sentinel(root, ''); const before = stamp(target);
    if (kind === 'symlink') fs.symlinkSync(target, path);
    if (kind === 'hardlink') fs.linkSync(target, path);
    if (kind === 'dangling-symlink') fs.symlinkSync(join(root, 'not-created'), path);
    if (kind === 'directory') fs.mkdirSync(path, 0o700);
    const linked = stamp(target); assert.throws(() => prepare(root)); assert.deepEqual(stamp(target), linked);
    assert.equal(fs.lstatSync(target).mode & 0o7777, 0o400); assert.equal(fs.readFileSync(target).length, 0);
    assert.equal(fs.existsSync(join(root, 'not-created')), false); assert.deepEqual(stamp(target).slice(0, 5), before.slice(0, 5));
}));
for (const place of ['root', 'home']) for (const mode of [0o711, 0o755, 0o1700]) test(`reject ${place} permissions ${mode.toString(8)} without repair`, () => fixture((root, path) => {
    const dir = place === 'root' ? root : join(root, 'codex'); fs.chmodSync(dir, mode); const before = stamp(dir);
    assert.throws(() => prepare(root), boundary); assert.equal(fs.existsSync(path), false); assert.deepEqual(stamp(dir), before);
}));
test('reject symlinked CODEX_HOME before creating anything in the target', () => fixture((root, path) => {
    fs.renameSync(join(root, 'codex'), join(root, 'actual-home')); fs.symlinkSync(join(root, 'actual-home'), join(root, 'codex'));
    assert.throws(() => prepare(root), boundary); assert.equal(fs.existsSync(path), false); assert.deepEqual(fs.readdirSync(join(root, 'actual-home')), []);
}));
test('reject non-canonical root alias before file creation', () => fixture((root, path) => {
    fs.symlinkSync(root, join(root, 'alias')); assert.throws(() => prepare(join(root, 'alias')), boundary); assert.equal(fs.existsSync(path), false);
}));
test('foreign directory owner is rejected before exclusive open (injected observation)', () => fixture((root, path) => {
    let opened = false;
    const run = helper({ lstatSync(p) { const s = fs.lstatSync(p); if (p === root) s.uid += 1; return s; }, openSync() { opened = true; throw new Error('must not open'); } });
    assert.throws(() => run(root), boundary); assert.equal(opened, false); assert.equal(fs.existsSync(path), false);
}));
test('failed fchmod is fail-closed and the fresh descriptor is closed', () => fixture((root, path) => {
    let captured, closed = 0;
    const run = helper({ fchmodSync(fd) { captured = fd; throw Object.assign(new Error('synthetic mode failure'), { code: 'EPERM' }); },
        closeSync(fd) { closed++; fs.closeSync(fd); } });
    withMask(0o077, () => assert.throws(() => run(root), { code: 'EPERM' }));
    assert.equal(closed, 1); assert.throws(() => fs.fstatSync(captured), { code: 'EBADF' }); assert.equal(fs.statSync(path).mode & 0o7777, 0o600);
}));
test('a no-op fchmod cannot manufacture a successful preparation', () => fixture((root) => {
    withMask(0o077, () => assert.throws(() => helper({ fchmodSync() {} })(root), boundary));
}));
test('exclusive descriptor never chmods a target substituted by symlink after open', () => fixture((root, path) => {
    const target = sentinel(root), before = stamp(target); let fd;
    const run = helper({ fchmodSync(opened, mode) { fd = opened; fs.renameSync(path, join(root, 'fresh-inode')); fs.symlinkSync(target, path); fs.fchmodSync(opened, mode); } });
    assert.throws(() => run(root), boundary); assert.deepEqual(stamp(target), before);
    assert.equal(fs.statSync(join(root, 'fresh-inode')).mode & 0o7777, 0o644); assert.throws(() => fs.fstatSync(fd), { code: 'EBADF' });
}));
test('a link introduced onto the fresh inode is detected after mode preparation', () => fixture((root, path) => {
    const run = helper({ fchmodSync(fd, mode) { fs.fchmodSync(fd, mode); fs.linkSync(path, join(root, 'unexpected-alias')); } });
    assert.throws(() => run(root), boundary); assert.equal(fs.statSync(path).nlink, 2);
}));
test('rebound home is detected before fchmod (injected scheduling seam)', () => fixture((root) => {
    let count = 0, changed = false;
    const run = helper({ fstatSync(fd) { const s = fs.fstatSync(fd); if (++count === 1) {
        fs.renameSync(join(root, 'codex'), join(root, 'old-home')); fs.mkdirSync(join(root, 'codex'), 0o700);
    } return s; }, fchmodSync() { changed = true; } });
    assert.throws(() => run(root), boundary); assert.equal(changed, false);
}));
test('run removal removes prepared artifacts, without a durable identity outside the run', () => {
    let removed;
    fixture((root, path) => { removed = root; prepare(root); assert.equal(fs.existsSync(path), true); });
    assert.equal(fs.existsSync(removed), false);
});

/* Behavioral port of the open/mode/lock/write sequence in official
 * core/src/installation_id.rs at 3d2ee51ca2d5db578f328aa75e20aa22c0197c9a.
 * The kernel enforces chmod EPERM. A fixed SYNTHETIC UUID avoids account data.
 * This is NOT the Rust function, Codex binary, or full sandbox policy.
 */
const cSource = String.raw`
#define _GNU_SOURCE 1
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>
#include <sys/file.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#if defined(__x86_64__)
#define TEST_ARCH AUDIT_ARCH_X86_64
#elif defined(__aarch64__)
#define TEST_ARCH AUDIT_ARCH_AARCH64
#else
#error This focused Linux harness supports x86_64 or aarch64 only
#endif
#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, (n), 0, 1), BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ERRNO|EPERM)
static int mode_deny(void) {
    struct sock_filter code[] = {
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K, TEST_ARCH, 1, 0),
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef __NR_chmod
        DENY(__NR_chmod),
#endif
        DENY(__NR_fchmod), DENY(__NR_fchmodat),
#ifdef __NR_fchmodat2
        DENY(__NR_fchmodat2),
#endif
        BPF_STMT(BPF_RET|BPF_K, SECCOMP_RET_ALLOW)
    };
    struct sock_fprog program = { (unsigned short)(sizeof(code)/sizeof(code[0])), code };
    return prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) || prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program);
}
static int denied(int result, int error) {
    if (result != -1 || error != EPERM) return 91;
    puts("MODE_CHANGE_DENIED:EPERM"); return 77;
}
int main(int argc, char **argv) {
    if (argc != 3) return 90;
    umask(0077);
    if (mode_deny()) { perror("seccomp unavailable"); return 92; }
    if (!strcmp(argv[1], "chmod")) { int r = chmod(argv[2], 0600); return denied(r, errno); }
    if (!strcmp(argv[1], "fchmodat")) { int r = fchmodat(AT_FDCWD, argv[2], 0600, 0); return denied(r, errno); }
    if (!strcmp(argv[1], "fchmod")) {
        int fd = open(argv[2], O_RDONLY); if (fd < 0) return 93;
        int r = fchmod(fd, 0600), e = errno; if (close(fd)) return 94; return denied(r, e);
    }
    if (strcmp(argv[1], "resolve")) return 95;
    int fd = open(argv[2], O_RDWR|O_CREAT, 0644); if (fd < 0) return 96;
    if (flock(fd, LOCK_EX)) return 97;
    struct stat st; if (fstat(fd, &st)) return 98;
    if ((st.st_mode & 0777) != 0644) {
        int r = fchmod(fd, 0644), e = errno;
        if (r) { if (close(fd)) return 99; return denied(r, e); }
    }
    char value[64] = {0}; ssize_t n = read(fd, value, sizeof(value));
    if (n < 0) return 100;
    const char *synthetic = "00000000-0000-4000-8000-000000000001";
    if (!n) {
        if (ftruncate(fd, 0) || lseek(fd, 0, SEEK_SET) != 0
            || write(fd, synthetic, strlen(synthetic)) != (ssize_t)strlen(synthetic) || fsync(fd)) return 101;
    } else if (n != (ssize_t)strlen(synthetic) || memcmp(value, synthetic, (size_t)n)) return 102;
    if (close(fd)) return 103;
    puts("RESOLVED_WITHOUT_MODE_CHANGE"); return 0;
}
`;
test('Linux kernel-backed mode-denial mechanism (not Darwin or Codex)', { skip: process.platform !== 'linux' }, async t => {
    const scratch = fs.realpathSync(fs.mkdtempSync(join(tmpdir(), 'mfmac-mode-probe-')));
    try {
        const file = join(scratch, 'mode-probe.c'), binary = join(scratch, 'mode-probe'); fs.writeFileSync(file, cSource);
        const compiler = process.env.MEDIFLOW_TEST_CC || 'cc';
        const built = spawnSync(compiler, ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', file, '-o', binary], { encoding: 'utf8', timeout: 20_000 });
        assert.equal(built.error, undefined); assert.equal(built.status, 0, built.stderr);
        const run = (op, path) => {
            const result = spawnSync(binary, [op, path], { encoding: 'utf8', timeout: 3000 });
            assert.equal(result.error, undefined); assert.equal(result.signal, null, result.stderr); return result;
        };
        await t.test('unprepared file reproduces exact EPERM with umask 0077', () => fixture((root, path) => {
            const result = run('resolve', path); assert.equal(result.status, 77, result.stderr); assert.equal(result.stdout, 'MODE_CHANGE_DENIED:EPERM\n');
            assert.equal(fs.statSync(path).mode & 0o7777, 0o600); assert.equal(fs.statSync(path).size, 0);
        }));
        await t.test('precreating 0600 does NOT solve the incompatibility', () => fixture((root, path) => {
            fs.writeFileSync(path, '', { flag: 'wx', mode: 0o600 }); fs.chmodSync(path, 0o600);
            assert.equal(run('resolve', path).status, 77);
        }));
        await t.test('exact delivered preparation allows lock/read/write/fsync with mode denial still active', () => fixture((root, path) => {
            withMask(0o077, () => prepare(root)); const result = run('resolve', path);
            assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'RESOLVED_WITHOUT_MODE_CHANGE\n');
            assert.equal(fs.statSync(path).mode & 0o7777, 0o644); assert.equal(fs.readFileSync(path, 'utf8'), '00000000-0000-4000-8000-000000000001');
            const before = stamp(path); assert.equal(run('resolve', path).status, 0); assert.deepEqual(stamp(path), before);
        }));
        for (const op of ['chmod', 'fchmod', 'fchmodat']) await t.test(`${op} remains denied through a protected-file hardlink alias`, () => fixture((root, path) => {
            const target = sentinel(root); fs.linkSync(target, path); const before = stamp(target);
            assert.equal(run(op, path).status, 77); assert.deepEqual(stamp(target), before); assert.equal(fs.readFileSync(target, 'utf8'), 'synthetic-protected');
        }));
    } finally { fs.rmSync(scratch, { recursive: true, force: true }); }
});
