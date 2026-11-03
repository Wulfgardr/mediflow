/* @Codex — Mac-only, nonprivileged execution custodian. No provider credentials,
 * no networking/IPC in the supervisor beyond administrative presence checks and
 * its inherited private owner channel. Build with the fixed recipe. */
#if !defined(__APPLE__)
#error "Mac execution custodian requires the macOS SDK; no portable success stub"
#endif
#ifndef _DARWIN_C_SOURCE
#define _DARWIN_C_SOURCE 1
#endif
#include <CoreFoundation/CoreFoundation.h>
#include <mach/mach.h>
#include <mach/mach_time.h>
#include <servers/bootstrap.h>
#include <sandbox.h>
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <libproc.h>
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/proc_info.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>

extern char **environ;
static volatile sig_atomic_t interrupted = 0;
static void on_signal(int sig) { (void)sig; interrupted = 1; }
static uint64_t milliseconds(void) {
    mach_timebase_info_data_t scale;
    if (mach_timebase_info(&scale) != KERN_SUCCESS || scale.denom == 0) _exit(78);
    return (uint64_t)((long double)mach_continuous_time() * scale.numer / scale.denom / 1000000.0L);
}
static int write_all(int fd, const void *buffer, size_t size) {
    const char *p = buffer;
    while (size) {
        ssize_t count = write(fd, p, size);
        if (count < 0 && errno == EINTR) continue;
        if (count <= 0) return -1;
        p += count; size -= (size_t)count;
    }
    return 0;
}
static bool nonce_ok(const char *s) {
    if (strlen(s) != 32) return false;
    for (size_t i = 0; i < 32; ++i) if (!((s[i] >= '0' && s[i] <= '9') || (s[i] >= 'a' && s[i] <= 'f'))) return false;
    return true;
}
static bool root_ok(const char *root) {
    char canonical[PATH_MAX]; struct stat st;
    if (root[0] != '/' || strlen(root) > PATH_MAX - 100 || !realpath(root, canonical) || strcmp(root, canonical) != 0
        || lstat(root, &st) != 0 || !S_ISDIR(st.st_mode) || st.st_uid != getuid() || (st.st_mode & 0777) != 0700) return false;
    for (const unsigned char *p = (const unsigned char *)root; *p; ++p) if (*p < 32 || *p == 127) return false;
    return true;
}
static bool path_join(char out[PATH_MAX], const char *root, const char *suffix) {
    int n = snprintf(out, PATH_MAX, "%s/%s", root, suffix);
    return n > 0 && n < PATH_MAX;
}
/* Never open/decode/log administrative content. ONLY ENOENT means absent.
 * 77: an existing managed setting; 78: an unobservable/invalid setting. */
static int admin_absent(void) {
    static const char *paths[] = { "/etc/codex/requirements.toml", "/etc/codex/config.toml", "/etc/codex/managed_config.toml" };
    for (size_t i = 0; i < sizeof(paths)/sizeof(paths[0]); ++i) {
        struct stat st;
        if (lstat(paths[i], &st) == 0) return 77;
        if (errno != ENOENT) return 78;
    }
    CFStringRef domain = CFSTR("com.openai.codex");
    if (!CFPreferencesAppSynchronize(domain)) return 78;
    CFStringRef keys[] = { CFSTR("requirements_toml_base64"), CFSTR("config_toml_base64") };
    for (size_t i = 0; i < sizeof(keys)/sizeof(keys[0]); ++i) {
        CFPropertyListRef value = CFPreferencesCopyAppValue(keys[i], domain);
        if (value != NULL) { CFRelease(value); return 77; }
        if (CFPreferencesAppValueIsForced(keys[i], domain)) return 78;
    }
    return 0;
}
static bool mode_ok(const char *mode) {
    return !strcmp(mode, "server") || !strcmp(mode, "schemas") || !strcmp(mode, "version") || !strcmp(mode, "probe");
}
static char *read_profile(const char *path) {
    int fd = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC); struct stat st;
    if (fd < 0) return NULL;
    if (fstat(fd, &st) || !S_ISREG(st.st_mode) || st.st_uid != getuid() || (st.st_mode & 0222) || st.st_size < 1 || st.st_size > 32768) {
        close(fd); return NULL;
    }
    size_t length = (size_t)st.st_size; char *s = calloc(length + 1, 1);
    if (!s) { close(fd); return NULL; }
    size_t offset = 0;
    while (offset < length) {
        ssize_t n = read(fd, s + offset, length - offset);
        if (n < 0 && errno == EINTR) continue;
        if (n <= 0) { close(fd); free(s); return NULL; }
        offset += (size_t)n;
    }
    close(fd);
    if (memchr(s, '\0', length) != NULL) { free(s); return NULL; }
    return s;
}
static bool set_limits(void) {
    struct rlimit nproc = { 0, 0 }, core = { 0, 0 }, nofile = { 256, 256 }, observed;
    if (setrlimit(RLIMIT_NPROC, &nproc) || setrlimit(RLIMIT_CORE, &core) || setrlimit(RLIMIT_NOFILE, &nofile)) return false;
    return getrlimit(RLIMIT_NPROC, &observed) == 0 && observed.rlim_cur == 0 && observed.rlim_max == 0;
}
/* This is the fresh, single-threaded --child image, before sandbox/limits.
 * Current soft/hard limits do NOT bound already inherited descriptor numbers.
 * Inspect our own kernel FD list instead: no directory opens, paths or content.
 * A full/malformed/unobservable snapshot is a failure, never a truncated success.
 * Two fixed-size snapshots bound work to at most 4095 close calls; the second
 * proves that only stdio and the private FD4 remain. No retry on ambiguous close
 * errors (including EINTR): the caller reports F and exits without staging R. */
static bool close_inherited_descriptors(void) {
    struct proc_fdinfo descriptors[4096];
    for (unsigned pass = 0; pass < 2; ++pass) {
        int bytes = proc_pidinfo(getpid(), PROC_PIDLISTFDS, 0, descriptors, (int)sizeof(descriptors));
        if (bytes <= 0 || (size_t)bytes >= sizeof(descriptors)
            || (size_t)bytes % sizeof(descriptors[0]) != 0) return false;
        size_t count = (size_t)bytes / sizeof(descriptors[0]);
        bool status_present = false;
        for (size_t i = 0; i < count; ++i) {
            int fd = descriptors[i].proc_fd;
            if (fd < 0) return false;
            if (fd == 4) { status_present = true; continue; }
            if (fd <= STDERR_FILENO) continue;
            if (pass != 0 || (close(fd) != 0 && errno != EBADF)) return false;
        }
        if (!status_present) return false;
    }
    return true;
}
static int child_exec(const char *mode, const char *root, const char *nonce) {
    /* Descriptor 4 is the private exec-status pipe, not the owner channel.
     * It is close-on-exec; Codex inherits ONLY stdin/stdout/stderr. */
    if (fcntl(4, F_SETFD, FD_CLOEXEC) < 0 || !close_inherited_descriptors()) {
        (void)write_all(4, "F", 1); return 78;
    }
    char profile_path[PATH_MAX], binary[PATH_MAX], helper[PATH_MAX], output[PATH_MAX];
    if (!path_join(profile_path, root, !strcmp(mode, "probe") ? "runtime/profile-probe.sb" : "runtime/profile.sb")
        || !path_join(binary, root, "runtime/codex") || !path_join(helper, root, "runtime/mac-owner")
        || !path_join(output, root, "work/schemas")) return 78;
    char *profile = read_profile(profile_path);
    if (!profile || !set_limits()) { free(profile); (void)write_all(4, "F", 1); return 78; }
    char *error = NULL;
    int applied = sandbox_init(profile, 0, &error);
    free(profile);
    if (error) sandbox_free_error(error); /* Never emit potentially sensitive OS prose. */
    if (applied != 0) { (void)write_all(4, "F", 1); return 78; }
    if (write_all(4, "R", 1)) return 78;
    if (!strcmp(mode, "server")) {
        char *args[] = { binary, "app-server", "--strict-config", "--listen", "stdio://", NULL };
        execve(binary, args, environ);
    } else if (!strcmp(mode, "schemas")) {
        char *args[] = { binary, "app-server", "generate-json-schema", "--experimental", "--out", output, NULL };
        execve(binary, args, environ);
    } else if (!strcmp(mode, "version")) {
        char *args[] = { binary, "--version", NULL };
        execve(binary, args, environ);
    } else {
        char *args[] = { helper, "--probe", (char *)root, (char *)nonce, NULL };
        execve(helper, args, environ);
    }
    (void)write_all(4, "F", 1);
    return 78;
}
static bool denied_errno(void) { return errno == EPERM || errno == EACCES; }
static void *thread_noop(void *arg) { return arg; }
static bool file_denied(const char *path, int flags) {
    int fd = open(path, flags);
    if (fd >= 0) { close(fd); return false; }
    return denied_errno();
}
static int tcp_connect_port(unsigned port) {
    int fd = socket(AF_INET, SOCK_STREAM, 0); if (fd < 0) return -1;
    struct sockaddr_in address; memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET; address.sin_port = htons((uint16_t)port); address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int result = connect(fd, (struct sockaddr *)&address, sizeof(address)), error = errno;
    close(fd); errno = error; return result;
}
/* Fixed order and names: the host accepts exactly this line and decides.
 * 1 passed, 0 failed, 2 target absent on this station (database only). */
static const char *const probe_names[] = { "nproc", "fork", "spawn", "thread", "descriptors", "owned_read",
    "owned_write", "protected_write", "protected_rename", "outside_read", "outside_write", "home_read", "data_read",
    "database_read", "proxy_connect", "loopback_other", "unix_socket", "mach_lookup", "external_network" };
enum { PROBE_CHECKS = sizeof(probe_names) / sizeof(probe_names[0]) };
/* Services that exist outside the sandbox; the supervisor proves presence first. */
static const char *const probe_services[] = { "com.apple.SystemConfiguration.configd",
    "com.apple.system.opendirectoryd.libinfo", "com.apple.dnssd.service" };
static bool directory_denied(const char *path) {
    int fd = open(path, O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd >= 0) { close(fd); return false; }
    return denied_errno();
}
static bool unix_denied(const char *path) {
    struct sockaddr_un address; memset(&address, 0, sizeof(address)); address.sun_family = AF_UNIX;
    int n = snprintf(address.sun_path, sizeof(address.sun_path), "%s", path);
    if (n < 1 || (size_t)n >= sizeof(address.sun_path)) return false;
    int fd = socket(AF_UNIX, SOCK_STREAM, 0); if (fd < 0) return denied_errno();
    int result = connect(fd, (struct sockaddr *)&address, sizeof(address)), error = errno; close(fd); errno = error;
    return result != 0 && denied_errno();
}
/* 192.0.2.1 is TEST-NET-1: no real service. Non-blocking, so a permissive
 * profile shows EINPROGRESS/ENETUNREACH at once instead of hanging. */
static bool external_denied(void) {
    int fd = socket(AF_INET, SOCK_STREAM, 0); if (fd < 0) return denied_errno();
    if (fcntl(fd, F_SETFL, O_NONBLOCK) < 0) { close(fd); return false; }
    struct sockaddr_in address; memset(&address, 0, sizeof(address));
    address.sin_family = AF_INET; address.sin_port = htons(443); address.sin_addr.s_addr = htonl(0xC0000201u);
    int result = connect(fd, (struct sockaddr *)&address, sizeof(address)), error = errno; close(fd); errno = error;
    return result != 0 && denied_errno();
}
/* One absolute path or "-" per line, written read-only by the host. */
static bool target_line(FILE *file, char out[PATH_MAX], bool optional) {
    if (!fgets(out, PATH_MAX, file)) return false;
    size_t length = strlen(out);
    if (length < 2 || out[length - 1] != '\n') return false;
    out[--length] = '\0';
    if (optional && !strcmp(out, "-")) return true;
    if (out[0] != '/') return false;
    for (const unsigned char *p = (const unsigned char *)out; *p; ++p) if (*p < 32 || *p == 127) return false;
    return true;
}
static int probe(const char *root) {
    int ok[PROBE_CHECKS]; for (size_t i = 0; i < PROBE_CHECKS; ++i) ok[i] = 0;
    char helper[PATH_MAX], config[PATH_MAX], ca[PATH_MAX], moved[PATH_MAX], sentinel[PATH_MAX], escape[PATH_MAX];
    char ports[PATH_MAX], paths[PATH_MAX], owned[PATH_MAX], unix_path[PATH_MAX];
    char home[PATH_MAX], data[PATH_MAX], database[PATH_MAX], dns[PATH_MAX];
    if (!path_join(helper, root, "runtime/mac-owner") || !path_join(config, root, "codex/config.toml")
        || !path_join(ca, root, "runtime/public-ca.pem") || !path_join(moved, root, "work/moved-config")
        || !path_join(ports, root, "runtime/probe-ports") || !path_join(paths, root, "runtime/probe-paths")
        || !path_join(owned, root, "work/probe-owned")) return 90;
    int n = snprintf(sentinel, sizeof(sentinel), "%s.sentinel", root); if (n < 1 || n >= PATH_MAX) return 90;
    n = snprintf(escape, sizeof(escape), "%s.escape", root); if (n < 1 || n >= PATH_MAX) return 90;
    n = snprintf(unix_path, sizeof(unix_path), "%s.sock", root); if (n < 1 || n >= PATH_MAX) return 90;
    FILE *file = fopen(ports, "r"); unsigned proxy_port = 0, blocked_port = 0; char extra;
    if (!file) return 94;
    int count = fscanf(file, "%u %u %c", &proxy_port, &blocked_port, &extra); fclose(file);
    if (count != 2 || !proxy_port || proxy_port > 65535 || !blocked_port || blocked_port > 65535 || proxy_port == blocked_port) return 94;
    file = fopen(paths, "r"); if (!file) return 94;
    bool targets = target_line(file, home, false) && target_line(file, data, false)
        && target_line(file, database, true) && target_line(file, dns, true) && fgetc(file) == EOF;
    fclose(file); if (!targets) return 94;

    struct rlimit limit;
    ok[0] = !getrlimit(RLIMIT_NPROC, &limit) && limit.rlim_cur == 0 && limit.rlim_max == 0;
    limit.rlim_cur = 1; limit.rlim_max = 1;
    if (!setrlimit(RLIMIT_NPROC, &limit) || errno != EPERM) ok[0] = 0;
    /* The original child escapes its group. Ownership must survive this. */
    if (setsid() < 0) return 82;
    pid_t p = fork();
    if (p == 0) _exit(99);
    if (p > 0) { (void)kill(p, SIGKILL); (void)waitpid(p, NULL, 0); }
    ok[1] = p < 0 && (errno == EAGAIN || denied_errno());
    char *args[] = { helper, "--invalid-probe-child", NULL };
    int spawn_error = posix_spawn(&p, helper, NULL, NULL, args, environ);
    if (!spawn_error) { (void)kill(p, SIGKILL); (void)waitpid(p, NULL, 0); }
    ok[2] = spawn_error == EAGAIN || spawn_error == EPERM || spawn_error == EACCES;
    pthread_t thread;
    ok[3] = !pthread_create(&thread, NULL, thread_noop, NULL) && !pthread_join(thread, NULL);
    ok[4] = fcntl(3, F_GETFD) == -1 && errno == EBADF && fcntl(4, F_GETFD) == -1 && errno == EBADF;
    int fd = open(config, O_RDONLY | O_CLOEXEC); char byte;
    ok[5] = fd >= 0 && read(fd, &byte, 1) == 1; if (fd >= 0) close(fd);
    fd = open(owned, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    ok[6] = fd >= 0 && !write_all(fd, "synthetic", 9); if (fd >= 0) close(fd);
    ok[7] = file_denied(config, O_WRONLY) && file_denied(ca, O_WRONLY) && file_denied(helper, O_WRONLY);
    ok[8] = rename(config, moved) && denied_errno();
    if (ok[8]) ok[8] = chmod(config, 0600) && denied_errno();
    ok[9] = file_denied(sentinel, O_RDONLY);
    ok[10] = file_denied(sentinel, O_WRONLY);
    fd = open(escape, O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC, 0600);
    if (fd >= 0) { close(fd); (void)unlink(escape); ok[10] = 0; }
    else if (!denied_errno()) ok[10] = 0;
    ok[11] = directory_denied(home);
    ok[12] = directory_denied(data);
    ok[13] = !strcmp(database, "-") ? 2 : file_denied(database, O_RDONLY);
    ok[14] = tcp_connect_port(proxy_port) == 0;
    ok[15] = tcp_connect_port(blocked_port) != 0 && denied_errno();
    ok[16] = unix_denied(unix_path) && (!strcmp(dns, "-") || unix_denied(dns));
    ok[17] = 1;
    for (size_t i = 0; i < sizeof(probe_services) / sizeof(probe_services[0]); ++i) {
        mach_port_t service = MACH_PORT_NULL;
        if (bootstrap_look_up(bootstrap_port, probe_services[i], &service) == KERN_SUCCESS) {
            mach_port_deallocate(mach_task_self(), service); ok[17] = 0;
        }
    }
    ok[18] = external_denied();

    char line[1024]; size_t used = 0;
    n = snprintf(line, sizeof(line), "MAC_PROBE_V2"); if (n < 1) return 98; used = (size_t)n;
    for (size_t i = 0; i < PROBE_CHECKS; ++i) {
        n = snprintf(line + used, sizeof(line) - used, " %s=%d", probe_names[i], ok[i]);
        if (n < 1 || (size_t)n >= sizeof(line) - used) return 98;
        used += (size_t)n;
    }
    if (used + 1 >= sizeof(line)) return 98;
    line[used++] = '\n';
    if (write_all(STDOUT_FILENO, line, used)) return 98;
    /* Only the still-owning supervisor ends this process, proving escaped-leader drain,
     * whatever the result: the host alone judges the line. */
    for (;;) pause();
}
static int event(const char *nonce, unsigned *sequence, const char *kind, long value, long detail) {
    char line[160];
    int n = snprintf(line, sizeof(line), "MFM1 %s %u %s %ld %ld\n", nonce, ++*sequence, kind, value, detail);
    if (n < 1 || (size_t)n >= sizeof(line)) return -1;
    return write_all(3, line, (size_t)n);
}
static int supervise(const char *mode, const char *root, const char *nonce) {
    unsigned sequence = 0;
    if (admin_absent()) { (void)event(nonce, &sequence, "ERROR", 1, 0); return 78; }
    if (!strcmp(mode, "probe")) {
        /* A nonexistent Mach service is not a successful deny probe. */
        for (size_t i = 0; i < sizeof(probe_services) / sizeof(probe_services[0]); ++i) {
            mach_port_t service = MACH_PORT_NULL;
            if (bootstrap_look_up(bootstrap_port, probe_services[i], &service) != KERN_SUCCESS) {
                (void)event(nonce, &sequence, "ERROR", 2, 0); return 78;
            }
            mach_port_deallocate(mach_task_self(), service);
        }
    }
    char helper[PATH_MAX]; if (!path_join(helper, root, "runtime/mac-owner")) return 78;
    int ready[2]; if (pipe(ready)) return 78;
    if (fcntl(ready[0], F_SETFD, FD_CLOEXEC) || fcntl(ready[1], F_SETFD, FD_CLOEXEC)) { close(ready[0]); close(ready[1]); return 78; }
    posix_spawn_file_actions_t actions; posix_spawnattr_t attributes;
    if (posix_spawn_file_actions_init(&actions)) { close(ready[0]); close(ready[1]); return 78; }
    if (posix_spawnattr_init(&attributes)) { posix_spawn_file_actions_destroy(&actions); close(ready[0]); close(ready[1]); return 78; }
    int setup = posix_spawnattr_setflags(&attributes, POSIX_SPAWN_CLOEXEC_DEFAULT);
    for (int fd = 0; fd < 3; ++fd) setup |= posix_spawn_file_actions_adddup2(&actions, fd, fd);
    setup |= posix_spawn_file_actions_addclose(&actions, ready[0]);
    setup |= posix_spawn_file_actions_adddup2(&actions, ready[1], 4);
    if (ready[1] != 4) setup |= posix_spawn_file_actions_addclose(&actions, ready[1]);
    setup |= posix_spawn_file_actions_addclose(&actions, 3);
    char *args[] = { helper, "--child", (char *)mode, (char *)root, (char *)nonce, NULL };
    pid_t child = -1;
    int spawned = setup ? setup : posix_spawn(&child, helper, &actions, &attributes, args, environ);
    posix_spawn_file_actions_destroy(&actions); posix_spawnattr_destroy(&attributes); close(ready[1]);
    if (spawned) { close(ready[0]); (void)event(nonce, &sequence, "ERROR", 3, 0); return 78; }
    (void)fcntl(ready[0], F_SETFL, O_NONBLOCK);
    (void)fcntl(3, F_SETFL, O_NONBLOCK);
    uint64_t start = milliseconds(), last_ping = start, last_admin = start, last_live = start, closing_at = 0;
    bool staged = false, started = false, closing = false, killed = false, failed = false;
    char control[64]; size_t length = 0;
    long reason = 0; /* 0 normal exit, 1 owner close, 2 lease, 3 policy/protocol/error */
    for (;;) {
        int status = 0; pid_t observed = waitpid(child, &status, WNOHANG);
        if (observed == child) {
            child = -1;
            /* Fast --version/generator processes may exit before the poll turn. */
            if (!started) {
                char ch; ssize_t n;
                while ((n = read(ready[0], &ch, 1)) > 0) {
                    if (ch == 'R' && !staged) staged = true; else failed = true;
                }
                if (n == 0 && staged && !failed) {
                    started = true;
                    if (event(nonce, &sequence, "START", observed, 0)) failed = true;
                }
            }
            close(ready[0]);
            if (!started || admin_absent()) failed = true;
            long code = WIFEXITED(status) ? WEXITSTATUS(status) : WIFSIGNALED(status) ? -WTERMSIG(status) : -255;
            if (failed) (void)event(nonce, &sequence, "ERROR", 4, reason);
            (void)event(nonce, &sequence, "STOP", code, reason);
            return failed ? 78 : 0;
        }
        if (observed < 0 && errno != EINTR) {
            /* ECHILD/unknown is NOT evidence of reaping; never signal this PID again. */
            close(ready[0]); (void)event(nonce, &sequence, "ERROR", 5, 0); return 78;
        }
        uint64_t now = milliseconds();
        if (!closing && (interrupted || now - last_ping > 1000 || now - start > 300000)) {
            closing = true; reason = interrupted ? 1 : 2;
        }
        if (!closing && now - last_admin >= 100) {
            last_admin = now;
            if (admin_absent()) { closing = true; failed = true; reason = 3; }
        }
        if (!closing && !started && now - start > 5000) { closing = true; failed = true; reason = 3; }
        if (closing && !closing_at) {
            closing_at = now;
            /* Direct unreaped child only: PID cannot be reused until waitpid above. */
            if (kill(child, SIGTERM) && errno != ESRCH) failed = true;
        }
        if (closing_at && !killed && now - closing_at >= 80) {
            killed = true;
            if (kill(child, SIGKILL) && errno != ESRCH) failed = true;
        }
        if (closing_at && now - closing_at > 800) {
            /* No false drain; Node retains the run root for host investigation. */
            close(ready[0]); (void)event(nonce, &sequence, "ERROR", 6, 0); return 78;
        }
        struct pollfd polls[2] = { { 3, POLLIN, 0 }, { started ? -1 : ready[0], POLLIN | POLLHUP, 0 } };
        if (poll(polls, 2, 20) < 0 && errno != EINTR) { closing = true; failed = true; reason = 3; }
        if (polls[0].revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) {
            char chunk[64]; ssize_t count = read(3, chunk, sizeof(chunk));
            if (count == 0 || (count < 0 && errno != EAGAIN && errno != EINTR)) { if (!closing) reason = 1; closing = true; }
            for (ssize_t i = 0; i < count; ++i) {
                if (chunk[i] == '\n') {
                    if (length == 1 && control[0] == 'P') last_ping = milliseconds();
                    else if (length == 1 && control[0] == 'C') { if (!closing) reason = 1; closing = true; }
                    else { closing = true; failed = true; reason = 3; }
                    length = 0;
                } else if (length < sizeof(control)) control[length++] = chunk[i];
                else { closing = true; failed = true; reason = 3; }
            }
        }
        if (!started && polls[1].revents & (POLLIN | POLLHUP | POLLERR)) {
            char ch; ssize_t n;
            while ((n = read(ready[0], &ch, 1)) > 0) {
                if (ch == 'R' && !staged) staged = true;
                else { closing = true; failed = true; reason = 3; }
            }
            if (n == 0 && staged && !failed) {
                started = true;
                if (event(nonce, &sequence, "START", child, 0)) { if (!closing) reason = 1; closing = true; }
            } else if (n == 0) { closing = true; failed = true; reason = 3; }
        }
        if (started && !closing && milliseconds() - last_live >= 100) {
            last_live = milliseconds();
            if (event(nonce, &sequence, "LIVE", child, 0)) { if (!closing) reason = 1; closing = true; }
        }
    }
}
int main(int argc, char **argv) {
    if (getuid() == 0 || getuid() != geteuid() || getgid() != getegid()) return 78;
    (void)umask(0077);
    (void)signal(SIGPIPE, SIG_IGN);
    if (argc == 2 && !strcmp(argv[1], "--admin-check")) return admin_absent();
    if (argc == 5 && !strcmp(argv[1], "--child") && mode_ok(argv[2]) && root_ok(argv[3]) && nonce_ok(argv[4]))
        return child_exec(argv[2], argv[3], argv[4]);
    if (argc == 4 && !strcmp(argv[1], "--probe") && root_ok(argv[2]) && nonce_ok(argv[3])) return probe(argv[2]);
    if (argc != 4 || !mode_ok(argv[1]) || !root_ok(argv[2]) || !nonce_ok(argv[3]) || fcntl(3, F_GETFD) < 0) return 78;
    struct sigaction action; memset(&action, 0, sizeof(action)); action.sa_handler = on_signal;
    sigemptyset(&action.sa_mask);
    (void)sigaction(SIGTERM, &action, NULL); (void)sigaction(SIGINT, &action, NULL); (void)sigaction(SIGHUP, &action, NULL);
    return supervise(argv[1], argv[2], argv[3]);
}
