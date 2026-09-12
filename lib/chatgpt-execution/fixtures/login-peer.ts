/* @Codex — Synthetic login-only unit peer. NO product/session/consent authority, OS
 * observation or network. Separate from the parent-only product fixture. */
import type { ExecutionCode, ExecutionMethod, ExecutionTransport } from '../execution-contract';
import { expectedExecutionConfig, expectedExecutionEnvironment } from '../execution-login.ts';
export class SyntheticLoginTransport implements ExecutionTransport {
    readonly calls: { method: ExecutionMethod; params: Record<string, unknown> }[] = [];
    private readonly listeners = new Set<{ notify(method: string, params: unknown): void; fail(code: ExecutionCode): void }>();
    connected = false;
    identity = 'synthetic-login@example.invalid';
    plan = 'plus';
    initializedCalls = 0;
    closed = false;
    override?: (method: ExecutionMethod, params: Record<string, unknown>) => unknown;
    constructor(readonly cwd: string) {}
    initialized() { this.initializedCalls++; }
    subscribe(notify: (method: string, params: unknown) => void, fail: (code: ExecutionCode) => void) {
        const listener = { notify, fail }; this.listeners.add(listener);
        return () => { this.listeners.delete(listener); };
    }
    emit(method: string, params: unknown) { for (const listener of [...this.listeners]) listener.notify(method, params); }
    login(loginId = 'fixture-login', success = true) {
        this.connected = success;
        this.emit('account/login/completed', { loginId, success, error: null });
    }
    async request(method: ExecutionMethod, params?: unknown): Promise<unknown> {
        if (this.closed) throw new Error('Test peer closed');
        const data = (params ?? {}) as Record<string, unknown>;
        this.calls.push({ method, params: data });
        const custom = this.override?.(method, data);
        if (custom !== undefined) return custom;
        switch (method) {
            case 'initialize': return { ...expectedExecutionEnvironment(this.cwd), userAgent: 'fixture_codex/0.153.4 (SYNTHETIC)' };
            case 'config/read': return { config: expectedExecutionConfig(), origins: {}, layers: null };
            case 'account/read': return { requiresOpenaiAuth: true, account: this.connected ? {
                type: 'chatgpt', email: this.identity, planType: this.plan,
            } : null };
            case 'account/login/start': return { type: 'chatgptDeviceCode', loginId: 'fixture-login',
                userCode: 'FAKE-TEST', verificationUrl: 'https://auth.openai.com/fixture' };
            case 'account/login/cancel': return { status: 'canceled' };
            default: throw new Error(`Unexpected synthetic login RPC ${method}`);
        }
    }
    async close() { this.closed = true; return true; }
}
