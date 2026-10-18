import 'server-only';

import { ProfileQueryError, assertProfileResultBudget } from '../patient-profile-scoped-contract';
import { isCurrentPatientProfileQueryResult, type PatientProfileQueryHostPort } from './patient-profile-query-host-port';
import { PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, decodePatientProfileQueryIpcFrameV1,
    encodePatientProfileQueryIpcFrameV1 } from '../../packages/aip/src/patient-profile-query-ipc';

type Sources = Readonly<{
    readPort(): PatientProfileQueryHostPort | null;
    send(frame: string): void;
    onProtocolFailure(): void;
}>;

export function createPatientProfileQueryWebDispatcher(sources: Sources) {
    const seen = new Set<string>();
    let busy = false, terminal = false;
    const fail = () => { terminal = true; sources.onProtocolFailure(); };
    return Object.freeze({
        async accept(frame: unknown): Promise<boolean> {
            if (typeof frame !== 'string' || !frame.startsWith(`{"schemaVersion":"${PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1}"`)) return false;
            if (terminal) return true;
            let request;
            try { request = decodePatientProfileQueryIpcFrameV1(frame); } catch { fail(); return true; }
            if (request.type !== 'query' || seen.has(request.requestRef) || seen.size >= 256 || busy) { fail(); return true; }
            seen.add(request.requestRef); busy = true;
            const base = { schemaVersion: PATIENT_PROFILE_QUERY_IPC_SCHEMA_V1, type: 'query_result',
                requestRef: request.requestRef, operationId: request.operationId };
            try {
                const port = sources.readPort();
                if (!port) throw new ProfileQueryError('scope_denied');
                const result = await port.executeProfileQuery(request.input);
                if (terminal || sources.readPort() !== port || !isCurrentPatientProfileQueryResult(port, result)) throw new ProfileQueryError('handle_unavailable');
                assertProfileResultBudget(result);
                sources.send(encodePatientProfileQueryIpcFrameV1({ ...base, outcome: 'completed', result }));
            } catch (error) {
                if (!terminal) {
                    const denialCode = error instanceof ProfileQueryError ? error.code : 'query_unavailable';
                    try { sources.send(encodePatientProfileQueryIpcFrameV1({ ...base, outcome: 'denied', denialCode })); }
                    catch { fail(); }
                }
            } finally { busy = false; }
            return true;
        },
    });
}
