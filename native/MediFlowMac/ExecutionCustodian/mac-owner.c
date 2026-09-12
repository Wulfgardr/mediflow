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
#include <poll.h>
#include <pthread.h>
#include <signal.h>
#include <spawn.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
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
static int child_exec(const char *mode, const char *root, const char *nonce) {
    /* Descriptor 4 is the private exec-status pipe, not the owner channel.
     * It is close-on-exec; Codex inherits ONLY stdin/stdout/stderr. */
    close(3); closefrom(5);
    if (fcntl(4, F_SETFD, FD_CLOEXEC) < 0) return 78;
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
static int probe(const char *root) {
    struct rlimit limit;
    if (getrlimit(RLIMIT_NPROC, &limit) || limit.rlim_cur != 0 || limit.rlim_max != 0) return 80;
    limit.rlim_cur = 1; limit.rlim_max = 1;
    if (!setrlimit(RLIMIT_NPROC, &limit) || errno != EPERM) return 81;
    /* The original child escapes its group. Ownership must survive this. */
    if (setsid() < 0) return 82;
    pid_t p = fork();
    if (p == 0) _exit(99);
    if (p > 0) { (void)kill(p, SIGKILL); (void)waitpid(p, NULL, 0); return 83; }
    if (errno != EAGAIN && !denied_errno()) return 84;
    char helper[PATH_MAX]; if (!path_join(helper, root, "runtime/mac-owner")) return 85;
    char *args[] = { helper, "--invalid-probe-child", NULL };
    int spawn_error = posix_spawn(&p, helper, NULL, NULL, args, environ);
    if (!spawn_error) { (void)kill(p, SIGKILL); (void)waitpid(p, NULL, 0); return 86; }
    if (spawn_error != EAGAIN && spawn_error != EPERM && spawn_error != EACCES) return 87;
    pthread_t thread;
    if (pthread_create(&thread, NULL, thread_noop, NULL) || pthread_join(thread, NULL)) return 88;
    if (fcntl(3, F_GETFD) != -1 || errno != EBADF || fcntl(4, F_GETFD) != -1 || errno != EBADF) return 89;
    char config[PATH_MAX], ca[PATH_MAX], moved[PATH_MAX], sentinel[PATH_MAX], ports[PATH_MAX], owned[PATH_MAX];
    if (!path_join(config, root, "codex/config.toml") || !path_join(ca, root, "runtime/public-ca.pem")
        || !path_join(moved, root, "work/moved-config") || !path_join(ports, root, "runtime/probe-ports")
        || !path_join(owned, root, "work/probe-owned")) return 90;
    int n = snprintf(sentinel, sizeof(sentinel), "%s.sentinel", root); if (n < 1 || n >= PATH_MAX) return 90;
    if (!file_denied(config, O_WRONLY) || !file_denied(ca, O_WRONLY) || !file_denied(helper, O_WRONLY)
        || !file_denied(sentinel, O_RDONLY) || !file_denied(sentinel, O_WRONLY)) return 91;
    if (!rename(config, moved) || !denied_errno() || !chmod(config, 0600) || !denied_errno()) return 92;
    int fd = open(owned, O_WRONLY | O_CREAT | O_EXCL, 0600);
    if (fd < 0 || write_all(fd, "synthetic", 9)) { if (fd >= 0) close(fd); return 93; }
    close(fd);
    FILE *file = fopen(ports, "r"); unsigned proxy_port = 0, blocked_port = 0; char extra;
    if (!file) return 94;
    int count = fscanf(file, "%u %u %c", &proxy_port, &blocked_port, &extra); fclose(file);
    if (count != 2 || !proxy_port || proxy_port > 65535 || !blocked_port || blocked_port > 65535 || proxy_port == blocked_port) return 94;
    if (tcp_connect_port(proxy_port) || !tcp_connect_port(blocked_port) || !denied_errno()) return 95;
    struct sockaddr_un address; memset(&address, 0, sizeof(address)); address.sun_family = AF_UNIX;
    n = snprintf(address.sun_path, sizeof(address.sun_path), "%s.sock", root);
    if (n < 1 || (size_t)n >= sizeof(address.sun_path)) return 96;
    fd = socket(AF_UNIX, SOCK_STREAM, 0); if (fd < 0) return 96;
    int result = connect(fd, (struct sockaddr *)&address, sizeof(address)), error = errno; close(fd); errno = error;
    if (result == 0 || !denied_errno()) return 96;
    mach_port_t service = MACH_PORT_NULL;
    if (bootstrap_look_up(bootstrap_port, "com.apple.SystemConfiguration.configd", &service) == KERN_SUCCESS) {
        mach_port_deallocate(mach_task_self(), service); return 97;
    }
    if (write_all(STDOUT_FILENO, "MAC_PROBE_OK_V1\n", 16)) return 98;
    /* Only the still-owning supervisor ends this process, proving escaped-leader drain. */
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
        mach_port_t service = MACH_PORT_NULL;
        if (bootstrap_look_up(bootstrap_port, "com.apple.SystemConfiguration.configd", &service) != KERN_SUCCESS) {
            (void)event(nonce, &sequence, "ERROR", 2, 0); return 78;
        }
        mach_port_deallocate(mach_task_self(), service);
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
