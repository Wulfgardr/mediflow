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

static napi_value init(napi_env env, napi_value exports) {
  napi_value function;
  if (napi_create_function(env, "getSystemDirectory", NAPI_AUTO_LENGTH,
      get_system_directory, NULL, &function) != napi_ok) return fail(env);
  if (napi_set_named_property(env, exports, "getSystemDirectory", function) != napi_ok) return fail(env);
  return exports;
}

NAPI_MODULE(system_directory, init)
