/* @Codex */
import 'server-only';

import { types } from 'node:util';

import { admitDocumentSynthesisFabric, beginDocumentSynthesisFabricExecution, disposeDocumentSynthesisFabricAdmission } from './document-synthesis-fabric-admission';
import { disposeDocumentSynthesisFabricPreparedExecution, finalizeDocumentSynthesisFabricPreparedExecution, prepareDocumentSynthesisFabricExecution } from './document-synthesis-fabric-execution-prepare';
import { bindDocumentSynthesisProvider, type DocumentSynthesisProviderBindingResult } from './document-synthesis-provider-binding';
import { resolveDocumentSynthesisSourceSetExecutionInputAccessor } from './document-synthesis-source-set-currentness-owner';
import { isServerSessionProjectionOwner } from '../../security/server-session-projection-owner';

type Publication = ReturnType<typeof finalizeDocumentSynthesisFabricPreparedExecution>;
type Binding = () => Promise<DocumentSynthesisProviderBindingResult>;
type Configuration = Readonly<{ owner: object; session: object; capsule: object }>;
export type DocumentSynthesisFabricProductionComposition = Readonly<{ execute(): Promise<Publication> }>;

const OBJECT = Object.prototype; const ObjectAssign = Object.assign; const ObjectCreate = Object.create; const ObjectFreeze = Object.freeze; const ObjectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor; const ObjectGetPrototypeOf = Object.getPrototypeOf; const ObjectHasOwn = Object.hasOwn; const ObjectIsFrozen = Object.isFrozen; const ReflectOwnKeys = Reflect.ownKeys; const IsProxy = types.isProxy;

function frozen<T extends Record<string, unknown>>(value: T): Readonly<T> { return ObjectFreeze(ObjectAssign(ObjectCreate(null) as T, value)); }
function configuration(value: unknown): Configuration | null {
    try { if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== 3) return null; const copied = ObjectCreate(null) as Record<string, unknown>; for (const key of ['owner', 'session', 'capsule']) { const descriptor = ObjectGetOwnPropertyDescriptor(value, key); if (!descriptor || !descriptor.enumerable || !ObjectHasOwn(descriptor, 'value')) return null; copied[key] = descriptor.value; } const owner = copied.owner; const session = copied.session; const capsule = copied.capsule; return typeof owner === 'object' && owner !== null && typeof session === 'object' && session !== null && typeof capsule === 'object' && capsule !== null && isServerSessionProjectionOwner(owner) && resolveDocumentSynthesisSourceSetExecutionInputAccessor(capsule, owner, session) ? frozen({ owner, session, capsule }) : null; } catch { return null; }
}
function testBinding(value: unknown): Binding | null { try { if (typeof value !== 'object' || value === null || IsProxy(value) || !ObjectIsFrozen(value) || ObjectGetPrototypeOf(value) !== OBJECT || ReflectOwnKeys(value).length !== 1) return null; const descriptor = ObjectGetOwnPropertyDescriptor(value, 'bind'); return descriptor && descriptor.enumerable && ObjectHasOwn(descriptor, 'value') && typeof descriptor.value === 'function' && !IsProxy(descriptor.value) ? descriptor.value as Binding : null; } catch { return null; } }
function create(configurationValue: unknown, bind: Binding): DocumentSynthesisFabricProductionComposition | null {
    const input = configuration(configurationValue); if (!input) return null;
    let state: 'ready' | 'running' | 'terminal' = 'ready';
    return frozen({ async execute(): Promise<Publication> {
        if (state !== 'ready') return null; state = 'running';
        let binding: DocumentSynthesisProviderBindingResult; try { binding = await bind(); } catch { state = 'terminal'; return null; }
        if (binding.status !== 'available') { state = 'terminal'; return null; }
        const admitted = admitDocumentSynthesisFabric(ObjectFreeze({ owner: input.owner, session: input.session, capsule: input.capsule, providerToken: binding.token }));
        if (admitted.status !== 'available' || !admitted.token) { state = 'terminal'; return null; }
        const handoff = beginDocumentSynthesisFabricExecution(admitted.token);
        if (!handoff) { disposeDocumentSynthesisFabricAdmission(admitted.token); state = 'terminal'; return null; }
        const prepared = await prepareDocumentSynthesisFabricExecution(handoff);
        if (prepared.status !== 'available') { disposeDocumentSynthesisFabricAdmission(admitted.token); state = 'terminal'; return null; }
        state = 'terminal';
        return finalizeDocumentSynthesisFabricPreparedExecution(prepared.preparedToken);
    } }) as DocumentSynthesisFabricProductionComposition;
}

/** Production-only factory: host identity is the sole caller input and provider selection is fixed. */
export const createDocumentSynthesisFabricProductionComposition = (value: unknown): DocumentSynthesisFabricProductionComposition | null => create(value, bindDocumentSynthesisProvider);

/** Test-only dependency seam; production cannot supply provider, endpoint, prompt, or execution options. */
export function createDocumentSynthesisFabricProductionCompositionForTest(value: unknown, dependencies: unknown): DocumentSynthesisFabricProductionComposition | null { const bind = testBinding(dependencies); return bind ? create(value, bind) : null; }
