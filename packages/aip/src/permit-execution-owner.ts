/* @Codex */

declare const PERMIT_BRAND: unique symbol;
declare const EXECUTION_BRAND: unique symbol;

export type AipAuthorizationPermitV1 = Readonly<{ [PERMIT_BRAND]: true }>;
export type AipPermitExecutionV1 = Readonly<{ [EXECUTION_BRAND]: true }>;

type PermitRecord<Authority> = {
    authority: Authority;
    current: readonly unknown[];
    claim: readonly unknown[];
    state: 'available' | 'pending' | 'consumed' | 'revoked';
};
type ExecutionRecord<Authority> = {
    permit: PermitRecord<Authority>;
    state: 'active' | 'pending' | 'consumed' | 'revoked';
};
type Sources<Authority, Code extends string> = Readonly<{
    enter: () => void;
    now: () => number;
    parseCurrent: (value: unknown) => readonly unknown[];
    parseClaim: (value: unknown) => readonly unknown[];
    validate: (authority: Authority, current: readonly unknown[], claim: readonly unknown[], timestamp: number) => Code | null;
    error: (code: Code) => Error;
    permitInvalid: Code;
    permitReplay: Code;
    permitRevoked: Code;
}>;

function handle<T>(): T {
    return Object.freeze(Object.create(null)) as T;
}

function same(left: readonly unknown[], right: readonly unknown[]): boolean {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function createAipPermitExecutionOwnerV1<Authority, Code extends string>(sources: Sources<Authority, Code>) {
    const permits = new WeakMap<object, PermitRecord<Authority>>();
    const executions = new WeakMap<object, ExecutionRecord<Authority>>();

    const fail = (permit: PermitRecord<Authority>, code: Code): never => {
        permit.state = 'revoked';
        throw sources.error(code);
    };
    const parseAndValidate = (permit: PermitRecord<Authority>, currentValue: unknown, claimValue: unknown): void => {
        let current: readonly unknown[];
        let claim: readonly unknown[];
        try {
            current = sources.parseCurrent(currentValue);
            claim = sources.parseClaim(claimValue);
        } catch (error) {
            permit.state = 'revoked';
            throw error;
        }
        let timestamp: number;
        try { timestamp = sources.now(); } catch (error) { permit.state = 'revoked'; throw error; }
        const denial = sources.validate(permit.authority, current, claim, timestamp);
        if (denial) fail(permit, denial);
        if (!same(current, permit.current) || !same(claim, permit.claim)) fail(permit, sources.permitRevoked);
    };
    const issue = (authority: Authority, current: readonly unknown[], claim: readonly unknown[]): AipAuthorizationPermitV1 => {
        const permit = handle<AipAuthorizationPermitV1>();
        permits.set(permit, { authority, current, claim, state: 'available' });
        return permit;
    };
    const begin = (permitValue: unknown, currentValue: unknown, claimValue: unknown): AipPermitExecutionV1 => {
        sources.enter();
        if (!permitValue || typeof permitValue !== 'object') throw sources.error(sources.permitInvalid);
        const permit = permits.get(permitValue as object);
        if (!permit) throw sources.error(sources.permitInvalid);
        if (permit.state !== 'available') throw sources.error(
            permit.state === 'revoked' ? sources.permitRevoked : sources.permitReplay);
        permit.state = 'pending';
        parseAndValidate(permit, currentValue, claimValue);
        const execution = handle<AipPermitExecutionV1>();
        executions.set(execution, { permit, state: 'active' });
        return execution;
    };
    const finalize = (executionValue: unknown, currentValue: unknown, claimValue: unknown): true => {
        sources.enter();
        if (!executionValue || typeof executionValue !== 'object') throw sources.error(sources.permitInvalid);
        const execution = executions.get(executionValue as object);
        if (!execution) throw sources.error(sources.permitInvalid);
        if (execution.state !== 'active') throw sources.error(
            execution.state === 'revoked' ? sources.permitRevoked : sources.permitReplay);
        execution.state = 'pending';
        try { parseAndValidate(execution.permit, currentValue, claimValue); } catch (error) {
            execution.state = 'revoked';
            throw error;
        }
        execution.permit.state = 'consumed';
        execution.state = 'consumed';
        return true;
    };
    const deny = (executionValue: unknown): boolean => {
        sources.enter();
        if (!executionValue || typeof executionValue !== 'object') throw sources.error(sources.permitInvalid);
        const execution = executions.get(executionValue as object);
        if (!execution) throw sources.error(sources.permitInvalid);
        if (execution.state === 'consumed' || execution.state === 'revoked') return false;
        execution.permit.state = 'revoked';
        execution.state = 'revoked';
        return true;
    };
    const consume = (permit: unknown, current: unknown, claim: unknown): true => {
        const execution = begin(permit, current, claim);
        return finalize(execution, current, claim);
    };

    return Object.freeze({ issue, begin, finalize, deny, consume });
}
