#define WIN32_LEAN_AND_MEAN
#define NAPI_VERSION 1
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <node_api.h>

static napi_value fail(napi_env env) {
  napi_throw_error(env, "MEDIFLOW_WINDOWS_SYSTEM_DIRECTORY", "Windows system directory unavailable.");
  return NULL;
}

static napi_value get_system_directory(napi_env env, napi_callback_info info) {
  WCHAR initial[256];
  WCHAR *buffer = initial;
  UINT capacity = 256;
  UINT length = GetSystemDirectoryW(buffer, capacity);
  napi_value result;
  napi_status status;
  (void)info;
  if (length == 0) return fail(env);
  if (length >= capacity) {
    if (length >= 32768) return fail(env);
    capacity = length + 1;
    buffer = (WCHAR *)HeapAlloc(GetProcessHeap(), 0, capacity * sizeof(WCHAR));
    if (buffer == NULL) return fail(env);
    length = GetSystemDirectoryW(buffer, capacity);
    if (length == 0 || length >= capacity) {
      HeapFree(GetProcessHeap(), 0, buffer);
      return fail(env);
    }
  }
  status = napi_create_string_utf16(env, (const char16_t *)buffer, length, &result);
  if (buffer != initial && !HeapFree(GetProcessHeap(), 0, buffer)) return fail(env);
  if (status != napi_ok) return fail(env);
  return result;
}

static napi_value identity_unavailable(napi_env env) {
  napi_throw_error(env, "MEDIFLOW_WINDOWS_PROCESS_IDENTITY", "Windows process identity unavailable.");
  return NULL;
}

static BOOL creation_ticks(const FILETIME *creation, ULONGLONG *ticks) {
  static const WORD month_days[12] = {31,28,31,30,31,30,31,31,30,31,30,31};
  SYSTEMTIME utc;
  ULONGLONG raw = ((ULONGLONG)creation->dwHighDateTime << 32) | creation->dwLowDateTime;
  ULONGLONG year, days;
  DWORD month, limit;
  BOOL leap;
  if (raw > 2650467743999999999ULL || !FileTimeToSystemTime(creation, &utc)) return FALSE;
  if (utc.wYear < 1 || utc.wYear > 9999 || utc.wMonth < 1 || utc.wMonth > 12
      || utc.wHour > 23 || utc.wMinute > 59 || utc.wSecond > 59 || utc.wMilliseconds > 999) return FALSE;
  leap = utc.wYear % 4 == 0 && (utc.wYear % 100 != 0 || utc.wYear % 400 == 0);
  limit = (DWORD)month_days[utc.wMonth - 1] + (utc.wMonth == 2 && leap ? 1UL : 0UL);
  if (utc.wDay < 1 || (DWORD)utc.wDay > limit) return FALSE;
  year = (ULONGLONG)utc.wYear - 1;
  days = year * 365 + year / 4 - year / 100 + year / 400;
  for (month = 1; month < (DWORD)utc.wMonth; month++) days += (ULONGLONG)month_days[month - 1] + (month == 2 && leap ? 1ULL : 0ULL);
  days += (ULONGLONG)utc.wDay - 1;
  *ticks = (((days * 24 + utc.wHour) * 60 + utc.wMinute) * 60 + utc.wSecond) * 10000000ULL
      + (ULONGLONG)utc.wMilliseconds * 10000 + raw % 10000;
  return TRUE;
}

static napi_value get_process_creation_time_ticks(napi_env env, napi_callback_info info) {
  napi_value argv[2], result = NULL, canonical = NULL;
  size_t argc = 2, length = 0;
  uint32_t pid = 0;
  bool exact = false;
  HANDLE process;
  FILETIME creation, exit_time, kernel_time, user_time;
  ULONGLONG ticks = 0;
  BOOL read, converted, closed;
  napi_status status = napi_generic_failure;
  char digits[20];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1
      || napi_get_value_uint32(env, argv[0], &pid) != napi_ok || pid == 0
      || napi_create_uint32(env, pid, &canonical) != napi_ok
      || napi_strict_equals(env, argv[0], canonical, &exact) != napi_ok
      || !exact) return identity_unavailable(env);
  process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, (DWORD)pid);
  if (process == NULL) return identity_unavailable(env);
  read = GetProcessTimes(process, &creation, &exit_time, &kernel_time, &user_time);
  converted = read && creation_ticks(&creation, &ticks);
  if (converted) {
    do { digits[19 - length++] = (char)('0' + ticks % 10); ticks /= 10; } while (ticks != 0);
    status = napi_create_string_latin1(env, digits + 20 - length, length, &result);
  }
  closed = CloseHandle(process);
  if (!read || !converted || !closed || status != napi_ok) return identity_unavailable(env);
  return result;
}

typedef struct { HANDLE job; HANDLE process; } owned_job;

static napi_value job_error(napi_env env) {
  napi_throw_error(env, "MEDIFLOW_WINDOWS_JOB", "Windows Job operation unconfirmed.");
  return NULL;
}

static void dispose_job(napi_env env, void *data, void *hint) {
  owned_job *state = (owned_job *)data;
  (void)env; (void)hint;
  if (state->job != NULL) CloseHandle(state->job);
  if (state->process != NULL) CloseHandle(state->process);
  HeapFree(GetProcessHeap(), 0, state);
}

static owned_job *job_receiver(napi_env env, napi_callback_info info) {
  napi_value self, argv[1];
  size_t argc = 1;
  void *expected = NULL;
  owned_job *state = NULL;
  if (napi_get_cb_info(env, info, &argc, argv, &self, &expected) != napi_ok || argc != 0
      || napi_unwrap(env, self, (void **)&state) != napi_ok || state == NULL || state != expected) return NULL;
  return state;
}

static napi_value job_active(napi_env env, napi_callback_info info) {
  owned_job *state = job_receiver(env, info);
  JOBOBJECT_BASIC_ACCOUNTING_INFORMATION accounting;
  napi_value result;
  if (state == NULL || state->job == NULL
      || !QueryInformationJobObject(state->job, JobObjectBasicAccountingInformation, &accounting, sizeof(accounting), NULL)
      || napi_create_uint32(env, accounting.ActiveProcesses, &result) != napi_ok) return job_error(env);
  return result;
}

static napi_value job_owner_exited(napi_env env, napi_callback_info info) {
  owned_job *state = job_receiver(env, info);
  DWORD status;
  napi_value result;
  if (state == NULL || state->process == NULL) return job_error(env);
  status = WaitForSingleObject(state->process, 0);
  if ((status != WAIT_OBJECT_0 && status != WAIT_TIMEOUT)
      || napi_get_boolean(env, status == WAIT_OBJECT_0, &result) != napi_ok) return job_error(env);
  return result;
}

static napi_value job_terminate(napi_env env, napi_callback_info info) {
  owned_job *state = job_receiver(env, info);
  napi_value result;
  if (state == NULL || state->job == NULL || !TerminateJobObject(state->job, 0)
      || napi_get_undefined(env, &result) != napi_ok) return job_error(env);
  return result;
}

static napi_value job_close(napi_env env, napi_callback_info info) {
  owned_job *state = job_receiver(env, info);
  napi_value result;
  if (state == NULL) return job_error(env);
  if (state->job != NULL) {
    if (!CloseHandle(state->job)) return job_error(env);
    state->job = NULL;
  }
  if (state->process != NULL) {
    if (!CloseHandle(state->process)) return job_error(env);
    state->process = NULL;
  }
  if (napi_get_undefined(env, &result) != napi_ok) return job_error(env);
  return result;
}

static napi_value create_job_for_process(napi_env env, napi_callback_info info) {
  napi_value argv[3], canonical, actual, result, method;
  size_t argc = 3, length = 0, index;
  uint32_t pid = 0;
  bool exact = false;
  FILETIME creation, exit_time, kernel_time, user_time;
  ULONGLONG ticks = 0;
  char digits[20];
  owned_job *state;
  JOBOBJECT_EXTENDED_LIMIT_INFORMATION *limits;
  napi_property_descriptor methods[] = {
    {"active", NULL, job_active, NULL, NULL, NULL, napi_default, NULL},
    {"ownerExited", NULL, job_owner_exited, NULL, NULL, NULL, napi_default, NULL},
    {"terminate", NULL, job_terminate, NULL, NULL, NULL, napi_default, NULL},
    {"close", NULL, job_close, NULL, NULL, NULL, napi_default, NULL}
  };
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 2
      || napi_get_value_uint32(env, argv[0], &pid) != napi_ok || pid == 0
      || napi_create_uint32(env, pid, &canonical) != napi_ok
      || napi_strict_equals(env, argv[0], canonical, &exact) != napi_ok || !exact) return job_error(env);
  state = (owned_job *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(owned_job));
  if (state == NULL) return job_error(env);
  state->process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SET_QUOTA | PROCESS_TERMINATE | SYNCHRONIZE, FALSE, pid);
  if (state->process == NULL || !GetProcessTimes(state->process, &creation, &exit_time, &kernel_time, &user_time)
      || !creation_ticks(&creation, &ticks)) goto invalid;
  do { digits[19 - length++] = (char)('0' + ticks % 10); ticks /= 10; } while (ticks != 0);
  if (napi_create_string_latin1(env, digits + 20 - length, length, &actual) != napi_ok
      || napi_strict_equals(env, argv[1], actual, &exact) != napi_ok || !exact
      || WaitForSingleObject(state->process, 0) != WAIT_TIMEOUT) goto invalid;
  state->job = CreateJobObjectW(NULL, NULL);
  if (state->job == NULL) goto invalid;
  limits = (JOBOBJECT_EXTENDED_LIMIT_INFORMATION *)HeapAlloc(GetProcessHeap(), HEAP_ZERO_MEMORY, sizeof(*limits));
  if (limits == NULL) goto invalid;
  limits->BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
  exact = SetInformationJobObject(state->job, JobObjectExtendedLimitInformation, limits, sizeof(*limits)) != 0;
  HeapFree(GetProcessHeap(), 0, limits);
  if (!exact || !AssignProcessToJobObject(state->job, state->process)
      || napi_create_object(env, &result) != napi_ok) goto invalid;
  for (index = 0; index < sizeof(methods) / sizeof(methods[0]); index++) methods[index].data = state;
  if (napi_define_properties(env, result, sizeof(methods) / sizeof(methods[0]), methods) != napi_ok) goto invalid;
  for (index = 0; index < sizeof(methods) / sizeof(methods[0]); index++) {
    napi_property_descriptor keepalive = {"owner", NULL, NULL, NULL, NULL, result, napi_default, NULL};
    if (napi_get_named_property(env, result, methods[index].utf8name, &method) != napi_ok
        || napi_define_properties(env, method, 1, &keepalive) != napi_ok) goto invalid;
  }
  if (napi_wrap(env, result, state, dispose_job, NULL, NULL) != napi_ok) goto invalid;
  return result;
invalid:
  dispose_job(env, state, NULL);
  return job_error(env);
}

static BOOL security_property(napi_env env, napi_value object, const char *name, DWORD value) {
  napi_value number;
  return napi_create_uint32(env, value, &number) == napi_ok
      && napi_set_named_property(env, object, name, number) == napi_ok;
}

static BOOL security_boolean(napi_env env, napi_value object, const char *name, BOOL value) {
  napi_value boolean;
  return napi_get_boolean(env, value != FALSE, &boolean) == napi_ok
      && napi_set_named_property(env, object, name, boolean) == napi_ok;
}

static BOOL security_sid(napi_env env, napi_value object, const char *name, PSID sid) {
  LPWSTR text = NULL;
  napi_value value;
  size_t length = 0;
  BOOL ok;
  if (!IsValidSid(sid) || !ConvertSidToStringSidW(sid, &text)) return FALSE;
  while (text[length] != L'\0') length++;
  ok = napi_create_string_utf16(env, (const char16_t *)text, length, &value) == napi_ok
      && napi_set_named_property(env, object, name, value) == napi_ok;
  return LocalFree(text) == NULL && ok;
}

static TOKEN_USER *security_token(void) {
  HANDLE token = NULL;
  TOKEN_USER *user = NULL;
  DWORD size = 0;
  BOOL ok = FALSE;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &token)) return NULL;
  if (!GetTokenInformation(token, TokenUser, NULL, 0, &size)
      && GetLastError() == ERROR_INSUFFICIENT_BUFFER && size <= 65536 && size >= sizeof(TOKEN_USER)) {
    user = (TOKEN_USER *)HeapAlloc(GetProcessHeap(), 0, size);
    if (user != NULL) ok = GetTokenInformation(token, TokenUser, user, size, &size);
  }
  if (!CloseHandle(token)) ok = FALSE;
  if (!ok && user != NULL) { HeapFree(GetProcessHeap(), 0, user); user = NULL; }
  return user;
}

static napi_value directory_security(napi_env env, napi_callback_info info, BOOL restrict_acl) {
  napi_value argv[2], result = NULL, rules = NULL, rule;
  size_t argc = 2, length = 0, copied = 0, i;
  WCHAR *name = NULL;
  WCHAR volume[MAX_PATH];
  HANDLE directory = INVALID_HANDLE_VALUE;
  TOKEN_USER *user = NULL;
  PSECURITY_DESCRIPTOR descriptor = NULL;
  PACL acl = NULL;
  SECURITY_DESCRIPTOR_CONTROL control;
  DWORD revision = 0, filesystem = 0, count, status;
  FILE_ATTRIBUTE_TAG_INFO attributes;
  union { ACL header; BYTE bytes[256]; } private_acl;
  BYTE system_sid[SECURITY_MAX_SID_SIZE];
  DWORD system_size = sizeof(system_sid);
  const char *error = "MEDIFLOW_WINDOWS_DACL_UNAVAILABLE";
  BOOL ok = FALSE;
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1
      || napi_get_value_string_utf16(env, argv[0], NULL, 0, &length) != napi_ok
      || length == 0 || length >= 32768) goto done;
  name = (WCHAR *)HeapAlloc(GetProcessHeap(), 0, (length + 1) * sizeof(WCHAR));
  if (name == NULL || napi_get_value_string_utf16(env, argv[0], (char16_t *)name, length + 1, &copied) != napi_ok
      || copied != length) goto done;
  for (i = 0; i < length; i++) if (name[i] == L'\0') goto done;
  if (!GetVolumePathNameW(name, volume, MAX_PATH)
      || !GetVolumeInformationW(volume, NULL, 0, NULL, NULL, &filesystem, NULL, 0)) goto done;
  if (!(filesystem & FILE_PERSISTENT_ACLS)) { error = "MEDIFLOW_WINDOWS_DACL_FILESYSTEM"; goto done; }
  directory = CreateFileW(name, READ_CONTROL | FILE_READ_ATTRIBUTES | (restrict_acl ? WRITE_DAC : 0),
      FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, NULL, OPEN_EXISTING,
      FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, NULL);
  if (directory == INVALID_HANDLE_VALUE) {
    if (GetLastError() == ERROR_ACCESS_DENIED) error = "MEDIFLOW_WINDOWS_DACL_REJECTED";
    goto done;
  }
  if (!GetFileInformationByHandleEx(directory, FileAttributeTagInfo, &attributes, sizeof(attributes))) goto done;
  if (!(attributes.FileAttributes & FILE_ATTRIBUTE_DIRECTORY)
      || (attributes.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT)) {
    error = "MEDIFLOW_WINDOWS_DACL_REJECTED"; goto done;
  }
  if (!GetVolumeInformationByHandleW(directory, NULL, 0, NULL, NULL, &filesystem, NULL, 0)) goto done;
  if (!(filesystem & FILE_PERSISTENT_ACLS)) { error = "MEDIFLOW_WINDOWS_DACL_FILESYSTEM"; goto done; }
  user = security_token();
  if (user == NULL || !IsValidSid(user->User.Sid)) goto done;
  if (restrict_acl) {
    if (!CreateWellKnownSid(WinLocalSystemSid, NULL, system_sid, &system_size)
        || !InitializeAcl(&private_acl.header, sizeof(private_acl.bytes), ACL_REVISION)
        || !AddAccessAllowedAceEx(&private_acl.header, ACL_REVISION, OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
            FILE_ALL_ACCESS, user->User.Sid)
        || !AddAccessAllowedAceEx(&private_acl.header, ACL_REVISION, OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE,
            FILE_ALL_ACCESS, system_sid)) goto done;
    status = SetSecurityInfo(directory, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
        NULL, NULL, &private_acl.header, NULL);
    if (status != ERROR_SUCCESS) goto done;
  }
  if (GetSecurityInfo(directory, SE_FILE_OBJECT, DACL_SECURITY_INFORMATION, NULL, NULL, &acl, NULL, &descriptor) != ERROR_SUCCESS
      || !GetSecurityDescriptorControl(descriptor, &control, &revision)) goto done;
  count = acl != NULL && IsValidAcl(acl) ? acl->AceCount : 0;
  if (napi_create_object(env, &result) != napi_ok || napi_create_array_with_length(env, count, &rules) != napi_ok
      || !security_sid(env, result, "sid", user->User.Sid)
      || !security_boolean(env, result, "protected", (control & SE_DACL_PROTECTED) != 0)
      || napi_set_named_property(env, result, "rules", rules) != napi_ok) goto done;
  if (count == 2) for (i = 0; i < count; i++) {
    ACE_HEADER *header;
    ACCESS_ALLOWED_ACE *allowed;
    PSID sid;
    DWORD sid_size, offset = (DWORD)FIELD_OFFSET(ACCESS_ALLOWED_ACE, SidStart);
    if (!GetAce(acl, (DWORD)i, (void **)&header) || napi_create_object(env, &rule) != napi_ok
        || !security_property(env, rule, "type", header->AceType)
        || napi_set_element(env, rules, (uint32_t)i, rule) != napi_ok) goto done;
    if (header->AceType != ACCESS_ALLOWED_ACE_TYPE) continue;
    if (header->AceSize < offset + 8) goto done;
    allowed = (ACCESS_ALLOWED_ACE *)header;
    sid = &allowed->SidStart;
    sid_size = 8 + 4 * ((BYTE *)sid)[1];
    if (sid_size > (DWORD)header->AceSize - offset || !IsValidSid(sid)
        || !security_sid(env, rule, "sid", sid)
        || !security_property(env, rule, "rights", allowed->Mask)
        || !security_property(env, rule, "inheritance", header->AceFlags & (OBJECT_INHERIT_ACE | CONTAINER_INHERIT_ACE))
        || !security_property(env, rule, "propagation", header->AceFlags & (NO_PROPAGATE_INHERIT_ACE | INHERIT_ONLY_ACE))
        || !security_boolean(env, rule, "inherited", (header->AceFlags & INHERITED_ACE) != 0)) goto done;
  }
  ok = TRUE;
done:
  if (descriptor != NULL && LocalFree(descriptor) != NULL) ok = FALSE;
  if (user != NULL && !HeapFree(GetProcessHeap(), 0, user)) ok = FALSE;
  if (directory != INVALID_HANDLE_VALUE && !CloseHandle(directory)) ok = FALSE;
  if (name != NULL && !HeapFree(GetProcessHeap(), 0, name)) ok = FALSE;
  if (!ok) { napi_throw_error(env, error, "Windows directory security unavailable."); return NULL; }
  return result;
}

static napi_value get_directory_security(napi_env env, napi_callback_info info) {
  return directory_security(env, info, FALSE);
}

static napi_value restrict_directory_security(napi_env env, napi_callback_info info) {
  return directory_security(env, info, TRUE);
}

static napi_value init(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "createJobForProcess", NAPI_AUTO_LENGTH,
      create_job_for_process, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "createJobForProcess", function) != napi_ok) return fail(env);
  if (napi_create_function(env, "getProcessCreationTimeTicks", NAPI_AUTO_LENGTH,
      get_process_creation_time_ticks, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getProcessCreationTimeTicks", function) != napi_ok) return fail(env);
  if (napi_create_function(env, "getSystemDirectory", NAPI_AUTO_LENGTH,
      get_system_directory, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getSystemDirectory", function) != napi_ok) return fail(env);
  if (napi_create_function(env, "getDirectorySecurity", NAPI_AUTO_LENGTH,
      get_directory_security, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getDirectorySecurity", function) != napi_ok) return fail(env);
  if (napi_create_function(env, "restrictDirectorySecurity", NAPI_AUTO_LENGTH,
      restrict_directory_security, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "restrictDirectorySecurity", function) != napi_ok) return fail(env);
  return exports;
}

NAPI_MODULE(system_directory, init)
