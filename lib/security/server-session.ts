/* @Codex: stateless adapter; native/system state lives in the single physical owner. */
import 'server-only';
import { serverSessions } from './web-auth-lifecycle-owner-adapter';
export type {
    ServerSessionDisposalReason,
    ServerSessionResourceDisposer,
    ServerSessionCleanupOutcome,
    WebServerSessionRetirementReason,
    WebServerSessionRetirementCleanupOutcome,
    WebServerSessionRetirementCleanupReceipt,
    ServerSession,
    NativeServerSessionBinding,
    NativeSystemAdminResetCapability,
    NativeLegacyUserRetirementCapability,
    NativeLoginSessionFence,
    NativeSystemSessionOperationReceipt,
    StagedWebServerSession,
    PreparedWebServerSession,
    ArmedWebServerSessionPort,
    ActiveWebSessionResourcePort,
    ActiveWebSessionResourceUse,
    ActiveWebSessionPrivateResourceRegistration,
    ActiveWebSessionPrivateResourceDisposer
} from './web-auth-lifecycle-owner-adapter';
export const SESSION_COOKIE_NAME = serverSessions.SESSION_COOKIE_NAME;
export const registerServerSessionResource = serverSessions.registerServerSessionResource;
export const createSession = serverSessions.createSession;
export const captureNativeLoginSessionFence = serverSessions.captureNativeLoginSessionFence;
export const createNativeServerSession = serverSessions.createNativeServerSession;
export const isPairedNativeServerSession = serverSessions.isPairedNativeServerSession;
export const stageWebServerSession = serverSessions.stageWebServerSession;
export const prepareStagedWebServerSession = serverSessions.prepareStagedWebServerSession;
export const getPreparedWebServerSessionId = serverSessions.getPreparedWebServerSessionId;
export const armPreparedWebServerSession = serverSessions.armPreparedWebServerSession;
export const getArmedWebServerSessionId = serverSessions.getArmedWebServerSessionId;
export const tombstoneArmedWebServerSession = serverSessions.tombstoneArmedWebServerSession;
export const activateArmedWebServerSession = serverSessions.activateArmedWebServerSession;
export const retireActiveWebServerSession = serverSessions.retireActiveWebServerSession;
export const commitPreparedWebServerSession = serverSessions.commitPreparedWebServerSession;
export const abortPreparedWebServerSession = serverSessions.abortPreparedWebServerSession;
export const activateStagedWebServerSession = serverSessions.activateStagedWebServerSession;
export const abortStagedWebServerSession = serverSessions.abortStagedWebServerSession;
export const resolveActiveWebServerSession = serverSessions.resolveActiveWebServerSession;
export const mintActiveWebSessionResourcePort = serverSessions.mintActiveWebSessionResourcePort;
export const releaseActiveWebSessionResourcePort = serverSessions.releaseActiveWebSessionResourcePort;
export const beginActiveWebSessionResourceUse = serverSessions.beginActiveWebSessionResourceUse;
export const commitActiveWebSessionResourceUse = serverSessions.commitActiveWebSessionResourceUse;
export const abortActiveWebSessionResourceUse = serverSessions.abortActiveWebSessionResourceUse;
export const registerActiveWebSessionPrivateResource = serverSessions.registerActiveWebSessionPrivateResource;
export const unregisterActiveWebSessionPrivateResource = serverSessions.unregisterActiveWebSessionPrivateResource;
export const getSession = serverSessions.getSession;
export const peekSession = serverSessions.peekSession;
export const deleteSession = serverSessions.deleteSession;
export const invalidateServerSessionForApplicationLock = serverSessions.invalidateServerSessionForApplicationLock;
export const invalidateSessionsForUser = serverSessions.invalidateSessionsForUser;
export const prepareNativeSystemAdminReset = serverSessions.prepareNativeSystemAdminReset;
export const commitNativeSystemAdminReset = serverSessions.commitNativeSystemAdminReset;
export const abortNativeSystemAdminReset = serverSessions.abortNativeSystemAdminReset;
export const prepareNativeLegacyUserRetirement = serverSessions.prepareNativeLegacyUserRetirement;
export const preparePairedNativePinRetirement = serverSessions.preparePairedNativePinRetirement;
export const commitNativeLegacyUserRetirement = serverSessions.commitNativeLegacyUserRetirement;
export const abortNativeLegacyUserRetirement = serverSessions.abortNativeLegacyUserRetirement;
export const clearAllSessions = serverSessions.clearAllSessions;
export const retireServerSessionForLogout = serverSessions.retireServerSessionForLogout;
export const retireServerSessionForApplicationLock = serverSessions.retireServerSessionForApplicationLock;
export const retireExpiredServerSession = serverSessions.retireExpiredServerSession;
export const retireServerSessionsForUser = serverSessions.retireServerSessionsForUser;
export const retireWebP3SessionsForUser = serverSessions.retireWebP3SessionsForUser;
export const cleanupRetiredWebServerSession = serverSessions.cleanupRetiredWebServerSession;
export const dispatchActiveWebServerSessionRetirement = serverSessions.dispatchActiveWebServerSessionRetirement;
