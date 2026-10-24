#define WIN32_LEAN_AND_MEAN
#define NAPI_VERSION 1
#include <windows.h>
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
  napi_value argv[2], result;
  size_t argc = 2, length = 0;
  double input;
  DWORD pid;
  HANDLE process;
  FILETIME creation, exit_time, kernel_time, user_time;
  ULONGLONG ticks = 0;
  BOOL read, converted, closed;
  napi_status status = napi_generic_failure;
  char digits[20];
  if (napi_get_cb_info(env, info, &argc, argv, NULL, NULL) != napi_ok || argc != 1
      || napi_get_value_double(env, argv[0], &input) != napi_ok
      || !(input >= 1 && input <= 4294967295.0)) return identity_unavailable(env);
  pid = (DWORD)input;
  if ((double)pid != input) return identity_unavailable(env);
  process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
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

static napi_value init(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "getProcessCreationTimeTicks", NAPI_AUTO_LENGTH,
      get_process_creation_time_ticks, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getProcessCreationTimeTicks", function) != napi_ok) return fail(env);
  if (napi_create_function(env, "getSystemDirectory", NAPI_AUTO_LENGTH,
      get_system_directory, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getSystemDirectory", function) != napi_ok) return fail(env);
  return exports;
}

NAPI_MODULE(system_directory, init)
