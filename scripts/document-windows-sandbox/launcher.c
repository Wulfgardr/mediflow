#define _WIN32_WINNT 0x0A00
#include <windows.h>
#include <aclapi.h>
#include <userenv.h>
#include <stdio.h>
#include <wchar.h>

static DWORD allow_stage(wchar_t *stage, PSID sid) {
    PACL previous = NULL, updated = NULL;
    PSECURITY_DESCRIPTOR descriptor = NULL;
    DWORD code = GetNamedSecurityInfoW(stage, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
        NULL, NULL, &previous, NULL, &descriptor);
    if (!code && !previous) code = ERROR_INVALID_ACL;
    if (!code) {
        EXPLICIT_ACCESSW ace = {0};
        ace.grfAccessPermissions = FILE_GENERIC_READ | FILE_GENERIC_EXECUTE;
        ace.grfAccessMode = GRANT_ACCESS;
        ace.grfInheritance = SUB_CONTAINERS_AND_OBJECTS_INHERIT;
        BuildTrusteeWithSidW(&ace.Trustee, sid);
        code = SetEntriesInAclW(1, &ace, previous, &updated);
        if (!code) code = SetNamedSecurityInfoW(stage, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION,
            NULL, NULL, updated, NULL);
    }
    if (updated) LocalFree(updated);
    if (descriptor) LocalFree(descriptor);
    return code;
}

static BOOL confined(HANDLE process, PSID expected) {
    HANDLE token = NULL;
    DWORD is_container = 0, size = 0;
    BYTE sid_storage[sizeof(TOKEN_APPCONTAINER_INFORMATION) + SECURITY_MAX_SID_SIZE];
    TOKEN_APPCONTAINER_INFORMATION *container = (TOKEN_APPCONTAINER_INFORMATION *)sid_storage;
    TOKEN_GROUPS capabilities;
    if (!OpenProcessToken(process, TOKEN_QUERY, &token)) return FALSE;
    BOOL accepted = GetTokenInformation(token, TokenIsAppContainer, &is_container, sizeof(is_container), &size)
        && is_container == 1
        && GetTokenInformation(token, TokenAppContainerSid, container, sizeof(sid_storage), &size)
        && container->TokenAppContainer && EqualSid(expected, container->TokenAppContainer)
        && GetTokenInformation(token, TokenCapabilities, &capabilities, sizeof(capabilities), &size)
        && capabilities.GroupCount == 0;
    CloseHandle(token);
    return accepted;
}

static DWORD launch(wchar_t *stage, wchar_t *node, wchar_t *command, PSID sid) {
    const wchar_t *step = L"stage";
    DWORD code = allow_stage(stage, sid), exit_code = 126;
    HANDLE job = NULL, pipes[3] = {0};
    STARTUPINFOEXW startup = {0};
    PROCESS_INFORMATION child = {0};
    BOOL attributes_initialized = FALSE;
    SIZE_T length = 0;
    SECURITY_CAPABILITIES capabilities = {sid, NULL, 0, 0};
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = {0};
    const DWORD standard[] = {STD_INPUT_HANDLE, STD_OUTPUT_HANDLE, STD_ERROR_HANDLE};
    if (code) goto done;

    step = L"job";
    job = CreateJobObjectW(NULL, NULL);
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE | JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
    limits.BasicLimitInformation.ActiveProcessLimit = 1;
    if (!job || !SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))) goto failed;

    step = L"pipes";
    for (int i = 0; i < 3; i++) {
        HANDLE standard_handle = GetStdHandle(standard[i]);
        if (GetFileType(standard_handle) != FILE_TYPE_PIPE) {
            code = ERROR_INVALID_HANDLE;
            goto done;
        }
        if (!DuplicateHandle(GetCurrentProcess(), standard_handle, GetCurrentProcess(), &pipes[i],
                0, TRUE, DUPLICATE_SAME_ACCESS)) goto failed;
    }

    step = L"attributes";
    InitializeProcThreadAttributeList(NULL, 3, 0, &length);
    if (!length) goto failed;
    startup.lpAttributeList = HeapAlloc(GetProcessHeap(), 0, length);
    if (!startup.lpAttributeList) { code = ERROR_OUTOFMEMORY; goto done; }
    if (!InitializeProcThreadAttributeList(startup.lpAttributeList, 3, 0, &length)) goto failed;
    attributes_initialized = TRUE;
    if (!UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
            &capabilities, sizeof(capabilities), NULL, NULL)
        || !UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
            pipes, sizeof(pipes), NULL, NULL)
        || !UpdateProcThreadAttribute(startup.lpAttributeList, 0, PROC_THREAD_ATTRIBUTE_JOB_LIST,
            &job, sizeof(job), NULL, NULL)) goto failed;

    step = L"create";
    startup.StartupInfo.cb = sizeof(startup);
    startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    startup.StartupInfo.hStdInput = pipes[0];
    startup.StartupInfo.hStdOutput = pipes[1];
    startup.StartupInfo.hStdError = pipes[2];
    if (!CreateProcessW(node, command, NULL, NULL, TRUE,
            EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED | CREATE_NO_WINDOW,
            NULL, stage, &startup.StartupInfo, &child)) goto failed;

    step = L"token";
    if (!confined(child.hProcess, sid)) {
        code = ERROR_ACCESS_DENIED;
        goto done;
    }

    step = L"resume";
    if (ResumeThread(child.hThread) != 1) goto failed;
    step = L"exit";
    if (WaitForSingleObject(child.hProcess, INFINITE) != WAIT_OBJECT_0
        || !GetExitCodeProcess(child.hProcess, &exit_code)) goto failed;
    goto done;

failed:
    code = GetLastError();
    if (!code) code = ERROR_GEN_FAILURE;
done:
    if (job) CloseHandle(job);
    if (child.hProcess) {
        WaitForSingleObject(child.hProcess, INFINITE);
        CloseHandle(child.hProcess);
    }
    if (child.hThread) CloseHandle(child.hThread);
    for (int i = 0; i < 3; i++) if (pipes[i]) CloseHandle(pipes[i]);
    if (attributes_initialized) DeleteProcThreadAttributeList(startup.lpAttributeList);
    if (startup.lpAttributeList) HeapFree(GetProcessHeap(), 0, startup.lpAttributeList);
    if (code) fwprintf(stderr, L"Windows document sandbox: %ls (%lu)\n", step, (unsigned long)code);
    return code ? 126 : exit_code;
}

static BOOL valid_profile(const wchar_t *name) {
    const wchar_t prefix[] = L"MediFlow.Document.";
    size_t prefix_length = sizeof(prefix) / sizeof(prefix[0]) - 1;
    return wcslen(name) == prefix_length + 32
        && wcsncmp(name, prefix, prefix_length) == 0
        && wcsspn(name + prefix_length, L"0123456789abcdef") == 32;
}

static BOOL delete_profile(const wchar_t *name) {
    HRESULT result;
    for (int attempt = 0; attempt < 8; attempt++) {
        if (attempt) Sleep(100);
        result = DeleteAppContainerProfile(name);
        if (SUCCEEDED(result)) return TRUE;
    }
    fwprintf(stderr, L"Windows document sandbox: profile cleanup (0x%08lx)\n", (unsigned long)result);
    return FALSE;
}

int wmain(int argc, wchar_t **argv) {
    if (argc == 3 && wcscmp(argv[1], L"--delete-profile") == 0)
        return valid_profile(argv[2]) && delete_profile(argv[2]) ? 0 : 126;
    if (argc != 5 || !valid_profile(argv[1])) return 126;
    PSID sid = NULL;
    HRESULT result = CreateAppContainerProfile(argv[1], L"MediFlow document worker", L"Local PDF and AnyDoc processing", NULL, 0, &sid);
    if (FAILED(result) || !sid) {
        fwprintf(stderr, L"Windows document sandbox: profile (0x%08lx)\n", (unsigned long)result);
        return 126;
    }
    DWORD code = launch(argv[2], argv[3], argv[4], sid);
    FreeSid(sid);
    if (!delete_profile(argv[1])) return 126;
    return code <= 255 ? (int)code : 126;
}
