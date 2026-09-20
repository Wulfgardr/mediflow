/* @Codex: browser-safe DTO; account presence never grants execution. */
export type AccountState = 'unavailable' | 'disconnected' | 'starting' | 'awaiting_login' | 'verifying' | 'connected' | 'error';
export type AccountNotice = 'host_unavailable' | 'timeout' | 'protocol_error' | 'process_exited' | 'login_failed' | 'login_expired' | 'canceled' | 'logout_unconfirmed' | 'busy' | 'session_expired' | 'invalid_state' | null;
export type AccountAction = 'connect' | 'cancel_login' | 'complete_login' | 'refresh_account' | 'read_models' | 'read_rate_limits' | 'logout' | 'configure_host';
export type AccountStatus = Readonly<{
    state: AccountState;
    notice: AccountNotice;
    plan: string | null;
    loginExpiresAt: number | null;
    actions: readonly AccountAction[];
    inferenceEnabled: false;
    executionBlock: 'data_boundary_unqualified';
}>;
export type AccountLoginStart = Readonly<{ status: AccountStatus; authUrl: string }>;
export type AccountModel = Readonly<{ id: string; model: string; isDefault: boolean }>;
export type AccountModels = Readonly<{ status: AccountStatus; models: readonly AccountModel[] }>;
export type AccountLimitWindow = Readonly<{ usedPercent: number; windowDurationMins: number | null; resetsAt: number | null }>;
export type AccountRateLimits = Readonly<{
    status: AccountStatus;
    primary: AccountLimitWindow | null;
    secondary: AccountLimitWindow | null;
}>;
export type AccountOperation = 'login/start' | 'login/cancel' | 'login/complete' | 'read' | 'models' | 'rate-limits' | 'logout';
export type AccountResult = AccountStatus | AccountLoginStart | AccountModels | AccountRateLimits;

export type AccountHttpError = Readonly<{
    error: Exclude<AccountNotice, null> | 'unauthorized' | 'forbidden' | 'invalid_request' | 'method_not_allowed';
    inferenceEnabled: false;
    executionBlock: 'data_boundary_unqualified';
}>;
