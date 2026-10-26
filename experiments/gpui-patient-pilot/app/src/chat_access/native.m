#import <AppKit/AppKit.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>
#import <bsm/libbsm.h>
#import <libproc.h>
#import <sys/socket.h>
#import <sys/un.h>
#import <stdatomic.h>
#import <errno.h>

typedef struct {
    uint32_t token[8];
    int32_t peer;
    int32_t host;
    uint64_t peer_sec, peer_usec, host_sec, host_usec;
    int32_t kind;
    uint8_t host_hash[32];
    uint32_t host_hash_length;
} MFChatPeer;

extern void MFAmbulatoryWindowLockEvent(int permitsFreshAuth);

static atomic_uint_fast64_t lockEpoch = 0;
static atomic_bool screenLocked = false;

static NSMutableDictionary<NSData *, LAContext *> *contexts(void) {
    static NSMutableDictionary<NSData *, LAContext *> *value;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ value = [NSMutableDictionary new]; });
    return value;
}

int MFChatPrepareBiometric(const uint8_t nonce[32]) {
    @autoreleasepool {
        NSData *key = [NSData dataWithBytes:nonce length:32];
        @synchronized(contexts()) {
            if (contexts()[key]) return 0;
            contexts()[key] = [LAContext new];
        }
        return 1;
    }
}

void MFChatCancelBiometric(const uint8_t nonce[32]) {
    @autoreleasepool {
        NSData *key = [NSData dataWithBytes:nonce length:32];
        @synchronized(contexts()) {
            [contexts()[key] invalidate];
            [contexts() removeObjectForKey:key];
        }
    }
}

void MFChatInstallLockObserver(void) {
    static dispatch_once_t once;
    dispatch_once(&once, ^{
        [[NSDistributedNotificationCenter defaultCenter] addObserverForName:@"com.apple.screenIsLocked" object:nil queue:nil usingBlock:^(NSNotification *note) {
            (void)note; atomic_store(&screenLocked, true); atomic_fetch_add(&lockEpoch, 1);
            MFAmbulatoryWindowLockEvent(0);
        }];
        [[NSDistributedNotificationCenter defaultCenter] addObserverForName:@"com.apple.screenIsUnlocked" object:nil queue:nil usingBlock:^(NSNotification *note) {
            (void)note; atomic_store(&screenLocked, false);
            MFAmbulatoryWindowLockEvent(1);
        }];
        [[[NSWorkspace sharedWorkspace] notificationCenter] addObserverForName:NSWorkspaceSessionDidResignActiveNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
            (void)note; atomic_fetch_add(&lockEpoch, 1);
            MFAmbulatoryWindowLockEvent(0);
        }];
        [[[NSWorkspace sharedWorkspace] notificationCenter] addObserverForName:NSWorkspaceSessionDidBecomeActiveNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
            (void)note; MFAmbulatoryWindowLockEvent(1);
        }];
    });
}

uint64_t MFChatLockEpoch(void) { return atomic_load(&lockEpoch); }
int MFChatScreenLocked(void) { return atomic_load(&screenLocked); }
uint32_t MFChatUid(void) { return geteuid(); }
int MFChatConnectionOpen(int fd) {
    char byte;
    ssize_t count = recv(fd, &byte, 1, MSG_PEEK | MSG_DONTWAIT);
    return count > 0 || (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK));
}

static int bsd(pid_t pid, struct proc_bsdinfo *value) {
    return proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, value, sizeof(*value)) == sizeof(*value);
}

static SecCodeRef codeFor(NSDictionary *attributes) {
    SecCodeRef code = NULL;
    if (SecCodeCopyGuestWithAttributes(NULL, (__bridge CFDictionaryRef)attributes, kSecCSDefaultFlags, &code) != errSecSuccess) return NULL;
    if (SecCodeCheckValidity(code, kSecCSStrictValidate, NULL) != errSecSuccess) { CFRelease(code); return NULL; }
    return code;
}

static int sameExecutable(SecCodeRef code) {
    SecCodeRef own = NULL;
    CFDictionaryRef a = NULL, b = NULL;
    int same = 0;
    if (SecCodeCopySelf(kSecCSDefaultFlags, &own) == errSecSuccess
        && SecCodeCheckValidity(own, kSecCSStrictValidate, NULL) == errSecSuccess
        && SecCodeCopySigningInformation(code, kSecCSSigningInformation, &a) == errSecSuccess
        && SecCodeCopySigningInformation(own, kSecCSSigningInformation, &b) == errSecSuccess) {
        CFTypeRef ha = CFDictionaryGetValue(a, kSecCodeInfoUnique);
        CFTypeRef hb = CFDictionaryGetValue(b, kSecCodeInfoUnique);
        same = ha && hb && CFEqual(ha, hb);
    }
    if (a) CFRelease(a); if (b) CFRelease(b); if (own) CFRelease(own);
    return same;
}

static int hostKind(pid_t pid, MFChatPeer *output) {
    SecCodeRef code = codeFor(@{(__bridge NSString *)kSecGuestAttributePid: @(pid)});
    if (!code) return 0;
    NSArray<NSString *> *requirements = @[
        @"anchor apple generic and identifier \"com.openai.codex\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"2DC432GLL2\"",
        @"anchor apple generic and identifier \"com.anthropic.claudefordesktop\" and certificate 1[field.1.2.840.113635.100.6.2.6] exists and certificate leaf[field.1.2.840.113635.100.6.1.13] exists and certificate leaf[subject.OU] = \"Q6L2SF6YDW\""
    ];
    int kind = 0;
    for (NSUInteger i = 0; i < requirements.count; ++i) {
        SecRequirementRef requirement = NULL;
        if (SecRequirementCreateWithString((__bridge CFStringRef)requirements[i], kSecCSDefaultFlags, &requirement) == errSecSuccess) {
            if (SecCodeCheckValidity(code, kSecCSStrictValidate, requirement) == errSecSuccess) kind = (int)i + 1;
            CFRelease(requirement);
        }
        if (kind) break;
    }
    if (kind) {
        CFDictionaryRef info = NULL;
        if (SecCodeCopySigningInformation(code, kSecCSSigningInformation, &info) != errSecSuccess) kind = 0;
        else {
            CFTypeRef hash = CFDictionaryGetValue(info, kSecCodeInfoUnique);
            CFIndex length = hash && CFGetTypeID(hash) == CFDataGetTypeID() ? CFDataGetLength(hash) : 0;
            if (length != 20 && length != 32) kind = 0;
            else {
                CFDataGetBytes(hash, CFRangeMake(0, length), output->host_hash);
                output->host_hash_length = (uint32_t)length;
            }
            CFRelease(info);
        }
    }
    CFRelease(code);
    return kind;
}

int MFChatCapturePeer(int fd, MFChatPeer *output, int requireHost) {
    @autoreleasepool {
        memset(output, 0, sizeof(*output));
        audit_token_t token;
        socklen_t count = sizeof(token);
        pid_t peer = 0;
        socklen_t pidSize = sizeof(peer);
        if (getsockopt(fd, SOL_LOCAL, LOCAL_PEERTOKEN, &token, &count) || count != sizeof(token)
            || getsockopt(fd, SOL_LOCAL, LOCAL_PEERPID, &peer, &pidSize) || pidSize != sizeof(peer)
            || peer <= 0 || audit_token_to_pid(token) != peer || audit_token_to_euid(token) != geteuid()) return 0;
        SecCodeRef code = codeFor(@{(__bridge NSString *)kSecGuestAttributeAudit: [NSData dataWithBytes:&token length:sizeof(token)]});
        if (!code) return 0;
        int same = sameExecutable(code); CFRelease(code);
        if (!same) return 0;
        struct proc_bsdinfo info;
        if (!bsd(peer, &info)) return 0;
        memcpy(output->token, &token, sizeof(token));
        output->peer = peer; output->peer_sec = info.pbi_start_tvsec; output->peer_usec = info.pbi_start_tvusec;
        if (!requireHost) return 1;
        pid_t current = info.pbi_ppid;
        for (int depth = 0; depth < 24 && current > 1; ++depth) {
            struct proc_bsdinfo before, after;
            if (!bsd(current, &before)) return 0;
            int kind = hostKind(current, output);
            if (!bsd(current, &after) || before.pbi_start_tvsec != after.pbi_start_tvsec
                || before.pbi_start_tvusec != after.pbi_start_tvusec || before.pbi_ppid != after.pbi_ppid) return 0;
            if (kind) {
                output->host = current; output->host_sec = before.pbi_start_tvsec;
                output->host_usec = before.pbi_start_tvusec; output->kind = kind;
                return 1;
            }
            current = before.pbi_ppid;
        }
        return 0;
    }
}

int MFChatBiometric(const uint8_t nonce[32]) {
    @autoreleasepool {
        if (MFChatScreenLocked()) return 0;
        uint64_t epoch = MFChatLockEpoch();
        NSData *key = [NSData dataWithBytes:nonce length:32];
        LAContext *context;
        @synchronized(contexts()) { context = contexts()[key]; }
        if (!context) return 0;
        context.localizedFallbackTitle = @"";
        context.touchIDAuthenticationAllowableReuseDuration = 0;
        NSError *error = nil;
        if (![context canEvaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics error:&error]
            || context.biometryType != LABiometryTypeTouchID) {
            MFChatCancelBiometric(nonce);
            return error.code == LAErrorBiometryLockout ? 3 : 2;
        }
        dispatch_semaphore_t done = dispatch_semaphore_create(0);
        __block atomic_bool accepted = false;
        __block atomic_bool lockedOut = false;
        [context evaluatePolicy:LAPolicyDeviceOwnerAuthenticationWithBiometrics localizedReason:@"Conferma l'accesso monouso della chat mostrata in MediFlow" reply:^(BOOL success, NSError *failure) {
            atomic_store(&lockedOut, failure.code == LAErrorBiometryLockout);
            atomic_store(&accepted, success); dispatch_semaphore_signal(done);
        }];
        long timedOut = dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 30 * NSEC_PER_SEC));
        MFChatCancelBiometric(nonce);
        if (atomic_load(&lockedOut)) return 3;
        return !timedOut && atomic_load(&accepted) && !MFChatScreenLocked() && MFChatLockEpoch() == epoch;
    }
}
