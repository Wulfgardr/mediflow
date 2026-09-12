/* @Codex: Focused FD hygiene regression. No downloads, provider, account or production issuer.
 * node --test native/MediFlowMac/ExecutionCustodian/descriptor-close.test.mjs
 * Compiles exact function excerpts, not a portable production custodian.
 * Linux uses a TEST-ONLY /proc/self/fd enumerator; Darwin uses real libproc.
 * Profile/limits/sandbox are test doubles in this harness: NOT OS containment proof.
 * Real kernel FDs cross two execs; faults are injected only in this generated test TU.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
const here = dirname(fileURLToPath(import.meta.url));
const sourceBytes = readFileSync(join(here, 'mac-owner.c'));
const source = sourceBytes.toString('utf8');
function excerpt(start, end) {
    const first = source.indexOf(start), last = source.indexOf(end, first + start.length);
    assert.ok(first >= 0 && last > first, `exact source excerpt not found: ${start}`);
    assert.equal(source.indexOf(start, first + start.length), -1, 'ambiguous source excerpt');
    return source.slice(first, last);
}
const writeAll = excerpt('static int write_all(', 'static bool nonce_ok(');
const cleanup = excerpt('static bool close_inherited_descriptors(', 'static int child_exec(');
const childExec = excerpt('static int child_exec(', 'static bool denied_errno(');

test('complete C source pin and unchanged safety-critical startup gates', () => {
    const native = readFileSync(join(here, '../../../lib/chatgpt-execution/execution-mac-native.ts'), 'utf8');
    const pin = native.match(/MAC_NATIVE_SOURCE = Object\.freeze\(\{ bytes: (\d+), sha256: '([a-f0-9]{64})' \}\)/);
    assert.ok(pin, 'fixed whole-source pin is required');
    assert.equal(Number(pin[1]), sourceBytes.length);
    assert.equal(pin[2], createHash('sha256').update(sourceBytes).digest('hex'));
    assert.doesNotMatch(source, /\bclosefrom\s*\(/);
    assert.match(source, /#include <libproc\.h>/);
    assert.match(source, /#include <sys\/proc_info\.h>/);
    assert.match(source, /#if !defined\(__APPLE__\)/);
    assert.match(childExec, /fcntl\(4, F_SETFD, FD_CLOEXEC\) < 0 \|\| !close_inherited_descriptors\(\)/);
    assert.ok(childExec.indexOf('close_inherited_descriptors()') < childExec.indexOf('read_profile('));
    assert.ok(childExec.indexOf('sandbox_init(') < childExec.indexOf('write_all(4, "R", 1)'));
    assert.match(source, /POSIX_SPAWN_CLOEXEC_DEFAULT/);
    assert.match(source, /posix_spawn_file_actions_adddup2\(&actions, ready\[1\], 4\)/);
    assert.match(source, /struct rlimit nproc = \{ 0, 0 \}, core = \{ 0, 0 \}, nofile = \{ 256, 256 \}/);
    assert.match(source, /getuid\(\) == 0 \|\| getuid\(\) != geteuid\(\) \|\| getgid\(\) != getegid\(\)/);
    assert.match(source, /waitpid\(child, &status, WNOHANG\)/);
    assert.doesNotMatch(source, /kill\(-/);
    assert.match(native, /'-Werror', '-Wno-deprecated-declarations'/);
    assert.match(native, /'--verify', '--strict', '-R', '=anchor apple'/);
    // The builder still constructs an explicit environment; no general env spreading.
    const trusted = native.slice(native.indexOf('function trustedCommand('), native.indexOf('/** The compiler'));
    assert.match(trusted, /env: \{ NODE_ENV: 'production', HOME: root, TMPDIR: join\(root, 'tmp'\), PATH: '\/usr\/bin:\/bin', LANG: 'C', LC_ALL: 'C' \}/);
    assert.doesNotMatch(trusted, /process\.env|\.\.\.\s*env/);
});

const harness = String.raw`
#define _DARWIN_C_SOURCE 1
#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#ifdef __APPLE__
#include <libproc.h>
#include <sys/proc_info.h>
#else
#include <dirent.h>
/* TEST ABI only. This is never included in mac-owner.c or its fixed build. */
struct proc_fdinfo { int32_t proc_fd; uint32_t proc_fdtype; };
#define PROC_PIDLISTFDS 1
#endif
extern char **environ;
static const int high_fds[] = { 1023, 4097, 8191 };
static const char *scenario, *self_path;
static unsigned snapshots, close_attempts, profile_reads, limit_calls, sandbox_calls;
static void require(bool ok, const char *message) {
    if (!ok) { fprintf(stderr, "FD_TEST_FAILURE:%s\n", message); _exit(90); }
}
static bool is_case(const char *name) { return strcmp(scenario, name) == 0; }
static bool fd_open(int fd) { return fcntl(fd, F_GETFD) >= 0; }
static bool fd_absent(int fd) { return fcntl(fd, F_GETFD) == -1 && errno == EBADF; }
static int real_snapshot(int pid, int flavor, uint64_t arg, void *buffer, int capacity) {
#ifdef __APPLE__
    return proc_pidinfo(pid, flavor, arg, buffer, capacity);
#else
    require(pid == getpid() && flavor == PROC_PIDLISTFDS && arg == 0, "self-only-query");
    DIR *directory = opendir("/proc/self/fd");
    if (!directory) return 0;
    int enumerator = dirfd(directory), used = 0;
    struct proc_fdinfo *out = buffer;
    for (;;) {
        errno = 0;
        struct dirent *entry = readdir(directory);
        if (!entry) {
            int error = errno;
            if (closedir(directory) != 0 || error != 0) return 0;
            return used;
        }
        if (entry->d_name[0] == '.') continue;
        char *end = NULL;
        long fd = strtol(entry->d_name, &end, 10);
        require(end && *end == 0 && fd >= 0 && fd <= INT_MAX, "test-enumerator-entry");
        if (fd == enumerator) continue;
        if (used + (int)sizeof(*out) > capacity) { (void)closedir(directory); return capacity; }
        out[used / (int)sizeof(*out)] = (struct proc_fdinfo){ (int32_t)fd, 0 };
        used += (int)sizeof(*out);
    }
#endif
}
static int snapshot_fault(int pid, int flavor, uint64_t arg, void *buffer, int capacity) {
    ++snapshots;
    require(snapshots <= 2, "bounded-snapshot-count");
    char name[64];
#define MATCH_PHASE(kind) (snprintf(name, sizeof(name), kind "_%u", snapshots), is_case(name))
    if (MATCH_PHASE("query_error")) { errno = EPERM; return 0; }
    if (MATCH_PHASE("query_negative")) { errno = EIO; return -1; }
    if (MATCH_PHASE("query_zero")) { errno = 0; return 0; }
    if (MATCH_PHASE("query_partial")) return 1;
    if (MATCH_PHASE("query_full")) return capacity;
    if (MATCH_PHASE("query_oversize")) return capacity + (int)sizeof(struct proc_fdinfo);
    int bytes = real_snapshot(pid, flavor, arg, buffer, capacity);
    require(bytes > 0 && bytes <= capacity && bytes % (int)sizeof(struct proc_fdinfo) == 0, "real-snapshot-valid-or-full");
    if (bytes == capacity) return bytes; /* Production must reject a full real snapshot. */
    struct proc_fdinfo *fds = buffer;
    if (MATCH_PHASE("negative_fd")) fds[0].proc_fd = -1;
    if (MATCH_PHASE("missing_status")) {
        int count = bytes / (int)sizeof(*fds), used = 0;
        for (int i = 0; i < count; ++i) if (fds[i].proc_fd != 4) fds[used++] = fds[i];
        bytes = used * (int)sizeof(*fds);
    }
#undef MATCH_PHASE
    return bytes;
}
static int close_fault(int fd) {
    ++close_attempts;
    require(fd == 3 || fd >= 5, "never-close-stdio-or-status");
    require(close_attempts <= 4095, "bounded-close-count");
    if (fd == 3 && is_case("close_owner_error")) { errno = EIO; return -1; }
    if (fd == 8191) {
        if (is_case("close_eintr")) { errno = EINTR; return -1; }
        if (is_case("close_eintr_absent") || is_case("close_eio_absent")) {
            require(close(fd) == 0, "injected-closed-with-error"); errno = is_case("close_eintr_absent") ? EINTR : EIO; return -1;
        }
        if (is_case("close_eio")) { errno = EIO; return -1; }
        if (is_case("close_status_write_failure")) { require(close(4) == 0, "inject-status-loss"); errno = EIO; return -1; }
        if (is_case("close_noop")) return 0;
        if (is_case("close_ebadf_leak")) { errno = EBADF; return -1; }
        if (is_case("close_ebadf_absent")) { require(close(fd) == 0, "injected-already-closed"); errno = EBADF; return -1; }
    }
    return close(fd);
}
static int fcntl_fault(int fd, int command, int value) {
    require(fd == 4 && command == F_SETFD && value == FD_CLOEXEC, "exact-private-status-flags");
    if (is_case("status_flag_error")) { errno = EIO; return -1; }
    return fcntl(fd, command, value);
}
static bool path_join(char out[PATH_MAX], const char *root, const char *suffix) {
    int n = snprintf(out, PATH_MAX, "%s/%s", root, suffix);
    return n > 0 && n < PATH_MAX;
}
static void check_clean(bool after_exec) {
    for (int fd = 0; fd <= 2; ++fd) require(fd_open(fd), "stdio-preserved");
    require(fd_absent(3), "owner-channel-not-leaked");
    for (size_t i = 0; i < sizeof(high_fds)/sizeof(high_fds[0]); ++i) require(fd_absent(high_fds[i]), "high-fd-not-leaked");
    if (after_exec) require(fd_absent(4), "status-closed-by-exec");
    else require(fcntl(4, F_GETFD) == FD_CLOEXEC, "status-preserved-until-exec");
    struct rlimit limit;
    require(getrlimit(RLIMIT_NOFILE, &limit) == 0 && limit.rlim_cur == 64 && limit.rlim_max == 64, "prelowered-soft-and-hard");
}
/* These stubs make child_exec gating observable; NOT an OS containment test. */
static char *read_profile(const char *path) {
    (void)path; ++profile_reads; check_clean(false);
    return strdup("synthetic-profile-not-applied");
}
static bool set_limits(void) { ++limit_calls; return true; }
static int sandbox_init(const char *profile, uint64_t flags, char **error) {
    (void)profile; (void)flags; ++sandbox_calls; *error = NULL; return 0;
}
static void sandbox_free_error(char *error) { free(error); }
static int exec_redirect(const char *path, char *const args[], char *const env[]) {
    (void)path; (void)args; (void)env;
    require(profile_reads == 1 && limit_calls == 1 && sandbox_calls == 1, "stages-complete-before-exec");
    require(snapshots == 2, "two-complete-snapshots");
    check_clean(false);
    char *next[] = { (char *)self_path, "--after-exec", (char *)scenario, NULL };
    return execve(self_path, next, environ);
}
` + writeAll + String.raw`
#define proc_pidinfo snapshot_fault
#define close close_fault
#define fcntl fcntl_fault
#define execve exec_redirect
` + cleanup + childExec + String.raw`
#undef execve
#undef fcntl
#undef close
#undef proc_pidinfo
static void prepare_inheritance(void) {
    require(fd_open(3) && fd_open(4), "real-owner-and-private-channels-from-parent");
    struct rlimit original;
    require(getrlimit(RLIMIT_NOFILE, &original) == 0, "read-fd-limit");
    require(original.rlim_max == RLIM_INFINITY || original.rlim_max >= 8192, "test-needs-hard-fd-limit-at-least-8192");
    if (original.rlim_cur < 8192) {
        struct rlimit raised = original; raised.rlim_cur = 8192;
        require(setrlimit(RLIMIT_NOFILE, &raised) == 0, "test-only-raise-soft-within-existing-hard-limit");
    }
    if (is_case("dense_below_capacity") || is_case("dense_at_capacity") || is_case("dense_above_capacity")) {
        int total = is_case("dense_below_capacity") ? 4095 : is_case("dense_at_capacity") ? 4096 : 4097;
        int file = open("/dev/null", O_RDONLY);
        require(file >= 5 && file < 128, "dense-fixture-source");
        /* Leave low-numbered holes for the exec loader after lowering both limits. */
        for (int fd = 128; fd < 128 + total - 5; ++fd) require(dup2(file, fd) == fd, "dense-fixture-dup");
        require(close(file) == 0, "dense-fixture-source-close");
    } else if (!is_case("no_extras")) {
        int file = open("/dev/null", O_RDONLY), pair[2], pipefd[2];
        require(file >= 5 && socketpair(AF_UNIX, SOCK_STREAM, 0, pair) == 0 && pipe(pipefd) == 0, "synthetic-fd-fixture");
        require(dup2(file, high_fds[0]) == high_fds[0] && dup2(pair[0], high_fds[1]) == high_fds[1]
            && dup2(pipefd[0], high_fds[2]) == high_fds[2], "install-sparse-high-fds");
        require(close(file) == 0 && close(pair[0]) == 0 && close(pair[1]) == 0
            && close(pipefd[0]) == 0 && close(pipefd[1]) == 0, "fixture-own-temporaries-closed");
    } else require(close(3) == 0, "already-absent-owner-channel");
    struct rlimit lowered = { 64, 64 };
    require(setrlimit(RLIMIT_NOFILE, &lowered) == 0, "lower-soft-and-hard-with-high-fds-open");
    if (is_case("missing_status_fd")) require(close(4) == 0, "status-physically-absent");
    char *next[] = { (char *)self_path, "--inherited", (char *)scenario, NULL };
    execve(self_path, next, environ);
    require(false, "inheritance-exec-failed");
}
int main(int argc, char **argv) {
    require(argc == 3, "test-arguments");
    self_path = argv[0]; scenario = argv[2];
    (void)signal(SIGPIPE, SIG_IGN);
    if (!strcmp(argv[1], "--prepare")) { prepare_inheritance(); return 90; }
    if (!strcmp(argv[1], "--after-exec")) { check_clean(true); puts("FD_CLEAN_EXEC_OK"); return 0; }
    require(!strcmp(argv[1], "--inherited"), "test-mode");
    if (strncmp(scenario, "dense_", 6) == 0) require(fd_open(4097), "dense-high-descriptors-really-inherited");
    else if (!is_case("no_extras")) for (size_t i = 0; i < sizeof(high_fds)/sizeof(high_fds[0]); ++i)
        require(fd_open(high_fds[i]), "high-descriptors-really-inherited-above-limits");
    int result = child_exec("version", "/synthetic-no-file-read", "0123456789abcdef0123456789abcdef");
    require(result == 78, "failure-exit-code-78");
    require(profile_reads == 0 && limit_calls == 0 && sandbox_calls == 0, "failure-before-profile-limits-sandbox-exec");
    return result;
}
`;

const cases = [
    ['success', true], ['no_extras', true], ['close_ebadf_absent', true],
    ['dense_below_capacity', true], ['dense_at_capacity', false], ['dense_above_capacity', false],
    ['close_eintr', false], ['close_eio', false], ['close_eintr_absent', false], ['close_eio_absent', false], ['close_owner_error', false],
    ['close_noop', false], ['close_ebadf_leak', false], ['status_flag_error', false],
    ['missing_status_fd', false, ''], ['close_status_write_failure', false, ''],
    ...[1, 2].flatMap(pass => ['query_error', 'query_negative', 'query_zero', 'query_partial', 'query_full',
        'query_oversize', 'negative_fd', 'missing_status'].map(kind => [`${kind}_${pass}`, false])),
];
test('exact C excerpts: inherited sparse FDs, FD4 handoff and fail-closed faults (NOT containment)', {
    skip: !['darwin', 'linux'].includes(process.platform), timeout: 120_000,
}, async t => {
    if (process.platform === 'darwin') assert.notEqual(process.getuid?.(), 0, 'nonprivileged Mac only; never sudo');
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'mfmac-fd-regression-')));
    chmodSync(root, 0o700); mkdirSync(join(root, 'tmp'), { mode: 0o700 });
    const env = { NODE_ENV: 'test', HOME: root, TMPDIR: join(root, 'tmp'), PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' };
    const command = (binary, args, options = {}) => {
        const result = spawnSync(binary, args, { cwd: root, env, shell: false, timeout: 30_000,
            maxBuffer: 32_768, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options });
        assert.ifError(result.error); assert.equal(result.signal, null, `signal: ${binary}`);
        return result;
    };
    try {
        const c = join(root, 'fd-harness.c'), binary = join(root, 'fd-harness');
        writeFileSync(c, harness, { mode: 0o400, flag: 'wx' });
        let compiler = '/usr/bin/cc', platformFlags = [];
        if (process.platform === 'darwin') {
            const compilerResult = command('/usr/bin/xcrun', ['--find', 'clang']);
            assert.equal(compilerResult.status, 0); compiler = realpathSync(compilerResult.stdout.trim());
            const sdkResult = command('/usr/bin/xcrun', ['--sdk', 'macosx', '--show-sdk-path']);
            assert.equal(sdkResult.status, 0);
            assert.equal(command('/usr/bin/codesign', ['--verify', '--strict', '-R', '=anchor apple', compiler]).status, 0);
            platformFlags = ['-isysroot', realpathSync(sdkResult.stdout.trim()), '-mmacosx-version-min=13.0'];
        }
        const args = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-Wno-deprecated-declarations',
            '-fstack-protector-strong', '-D_FORTIFY_SOURCE=2', ...platformFlags, c, '-o', binary];
        const compiled = command(compiler, args);
        assert.equal(compiled.status, 0, compiled.stderr);
        t.diagnostic(JSON.stringify({ platform: process.platform, node: process.version, compiler, args,
            enumeration: process.platform === 'darwin' ? 'real libproc, excerpt only' : 'TEST-ONLY /proc/self/fd backend',
            containment: 'NOT_TESTED', cases: cases.length }));
        for (const [name, success, failureBytes = 'F'] of cases) {
            await t.test(name, () => {
                const observed = command(binary, ['--prepare', name], { stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe'] });
                assert.equal(observed.status, success ? 0 : 78, observed.stderr);
                assert.equal(observed.stderr, '');
                assert.equal(observed.stdout, success ? 'FD_CLEAN_EXEC_OK\n' : '');
                assert.equal(observed.output[3], '', 'no public owner frames from child');
                assert.equal(observed.output[4], success ? 'R' : failureBytes, 'private status: no false R on failure');
            });
        }
    } finally { rmSync(root, { recursive: true, force: false }); }
});
