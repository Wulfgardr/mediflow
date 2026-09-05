/* @Codex */
import type { ServerSession } from '@/lib/security/server-session';
import { isWebAdminSession } from '@/lib/security/server-auth-policy';

// D2 (WAVE 2 security hardening): the settings write routes previously accepted
// arbitrary key/value writes gated only by requireSessionOrLocalToken, which
// mints a synthetic admin session for the local token. A LAN paired client (or
// anything holding the local token) could therefore rewrite operator/safety
// settings. This registry pins every known settings key to the channels allowed
// to write it, so the local token can only touch the keys the paired/native
// bootstrap legitimately needs.

// Channels that may issue a settings write.
//   - 'web-session'  interactive cookie session (any authenticated role)
//   - 'web-admin'    interactive cookie session with the admin role
//   - 'local-token'  system session minted for a valid local API token (paired /
//                    native bootstrap). Never a human.
export type SettingsWriteChannel = 'web-session' | 'web-admin' | 'local-token';

export type SettingsKeyPolicy = {
    /** Channels allowed to write this key. */
    write: readonly SettingsWriteChannel[];
    /** Short human note on why the classification is what it is. */
    note: string;
};

// Every key the app actually reads or writes today. Grep provenance is recorded
// in the notes so the classification can be re-audited when a key moves.
export const SETTINGS_WRITE_REGISTRY: Record<string, SettingsKeyPolicy> = {
    // --- AI model / provider / endpoint config (written from the web settings
    // controller only; treated as operator config because it steers where PHI is
    // sent for inference). ---
    aiProvider: { write: ['web-session'], note: 'AI provider selection (lib/ai-models.ts)' },
    aiUrl: { write: ['web-session'], note: 'AI endpoint URL (lib/ai-service.ts, use-ai-settings-controller)' },
    ollamaUrl: { write: ['web-session'], note: 'legacy AI endpoint URL (lib/ai-service.ts)' },
    aiModel: { write: ['web-session'], note: 'legacy AI model (use-ai-settings-controller)' },
    aiModel_clinical: { write: ['web-session'], note: 'clinical model (use-ai-settings-controller)' },
    aiModel_reasoning: { write: ['web-session'], note: 'reasoning model (use-ai-settings-controller)' },
    aiModel_ocr: { write: [], note: 'retired historical OCR model key; HTTP writes denied' },
    aiModelDefaultVersion: { write: ['web-session'], note: 'text-model migration marker (lib/ai-models.ts)' },
    hardwareProfile: { write: ['web-session'], note: 'AI hardware profile (use-ai-settings-controller, ai-insight-settings)' },
    aiInsightMode: { write: ['web-session'], note: 'AI insight mode (lib/ai-insight-settings.ts)' },
    aiInsightManualConfig: { write: ['web-session'], note: 'AI insight manual config (lib/ai-insight-settings.ts)' },
    documentRouterControlFlow: { write: ['web-session'], note: 'document router control-flow mode (use-ai-settings-controller)' },

    // --- AI kill switches (safety toggles; web session only). ---
    aiPatientInsightKillSwitch: { write: ['web-session'], note: 'kill switch (lib/ai-patient-insight-kill-switch.ts)' },
    aiDocumentSynthesisKillSwitch: { write: ['web-session'], note: 'kill switch (lib/ai-document-synthesis-kill-switch.ts)' },
    aiSmartImportKillSwitch: { write: ['web-session'], note: 'kill switch (lib/ai-smart-import-kill-switch.ts)' },
    aiTreatmentReasoningKillSwitch: { write: ['web-session'], note: 'kill switch (lib/ai-treatment-reasoning-kill-switch.ts)' },
    aiOcrKillSwitch: { write: [], note: 'retired historical OCR toggle; HTTP writes denied' },

    // --- UI / accessibility preferences (per-operator, web session). ---
    uiReduceMotion: { write: ['web-session'], note: 'accessibility pref (components/ui-accessibility-provider.tsx)' },
    uiReduceTransparency: { write: ['web-session'], note: 'accessibility pref (components/ui-accessibility-provider.tsx)' },
    uiStyleMode: { write: ['web-session'], note: 'appearance pref (lib/ui-style-mode.ts)' },

    // --- Terminology registry (web session). ---
    terminologyRegistry: { write: ['web-session'], note: 'terminology registry (lib/terminology-registry.ts)' },

    // --- Clinic identity / network operating mode: written by the web settings
    // UI AND by the paired/native bootstrap (scripts/mobile-home-base-paired-smoke.sh,
    // scripts/network-home-base-*.test.mjs PUT these over the local token to
    // enable home-base). Both channels are legitimate today, so both are allowed. ---
    clinicName: { write: ['web-session', 'local-token'], note: 'clinic identity (app/settings/profilo, network home-base bootstrap)' },
    'network.mode': { write: ['web-session', 'local-token'], note: 'network operating mode (network panel + paired bootstrap)' },

    // --- Server-managed network keys. These are written server-side via direct
    // DB saveSetting (lib/network-home-base-server.ts), NOT through the HTTP
    // settings route, so no channel should be able to set them over HTTP. Listed
    // here so an accidental HTTP write is denied rather than silently allowed. ---
    'network.nodeId': { write: [], note: 'server-managed node id (lib/network-home-base-server.ts)' },
    'network.pairing.state': { write: [], note: 'server-managed pairing state (lib/network-home-base-server.ts)' },

    // --- Backup scheduler: has its own admin route (app/api/system/backup-scheduler).
    // Deny via the generic settings route so it can only move through the
    // web-admin-gated system route. ---
    backupScheduler: { write: [], note: 'backup config (app/api/system/backup-scheduler route, web-admin only)' },
};

/* @Codex */
export function settingsWriteChannelForSession(session: ServerSession): SettingsWriteChannel {
    if (session.authChannel === 'system') return 'local-token';
    if (isWebAdminSession(session)) return 'web-admin';
    return 'web-session';
}

// A web-admin session is a strict superset of web-session for write purposes.
function channelSatisfies(
    granted: SettingsWriteChannel,
    allowed: readonly SettingsWriteChannel[],
): boolean {
    if (allowed.includes(granted)) return true;
    // web-admin can do anything web-session can.
    if (granted === 'web-admin' && allowed.includes('web-session')) return true;
    return false;
}

export type SettingsWriteDecision =
    | { allowed: true; unregistered: boolean }
    | { allowed: false; status: 400 | 403; reason: string };

/* @Codex */
export function evaluateSettingsWrite(
    key: string,
    session: ServerSession,
): SettingsWriteDecision {
    const channel = settingsWriteChannelForSession(session);
    const policy = SETTINGS_WRITE_REGISTRY[key];

    if (!policy) {
        // Unknown key. Reject local-token writers outright (they must only touch
        // the explicitly enumerated bootstrap keys), but allow web sessions so we
        // never brick a legitimate UI flow that predates this registry. The
        // unregistered flag lets the caller log a TODO for follow-up.
        if (channel === 'local-token') {
            return {
                allowed: false,
                status: 400,
                reason: `Chiave impostazione non riconosciuta: ${key}`,
            };
        }
        return { allowed: true, unregistered: true };
    }

    if (channelSatisfies(channel, policy.write)) {
        return { allowed: true, unregistered: false };
    }

    return {
        allowed: false,
        status: 403,
        reason: `Il canale ${channel} non puo scrivere la chiave ${key}`,
    };
}
