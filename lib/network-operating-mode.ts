/* @Codex */
import type {
    NetworkCapabilitiesResponse,
    NetworkAiRuntimeSummary,
    NetworkCapabilityStatus,
    NetworkIdentitySummary,
    NetworkNodeSummary,
    NetworkReplicaSummary,
    NetworkSessionSummary,
} from '@/lib/api/v1/types';

export type NetworkOverviewPayload = {
    node: NetworkNodeSummary;
    session: NetworkSessionSummary;
    aiRuntime: NetworkAiRuntimeSummary;
    identity: NetworkIdentitySummary;
    capabilities: NetworkCapabilitiesResponse['capabilities'];
    activationReason: 'default-local' | 'manual' | 'fallback-preview';
    lastContactAt: string | null;
    lastSyncAt: string | null;
};

export type NetworkOperatingStateCode =
    | 'local'
    | 'network-available-not-active'
    | 'network-active'
    | 'offline-fallback';

export type NetworkOperatingStateView = {
    code: NetworkOperatingStateCode;
    label: string;
    title: string;
    description: string;
    preview: boolean;
    badge: 'Reale' | 'Anteprima';
};

export type NetworkReplicaStateView = {
    code: NetworkReplicaSummary['state'];
    label: string;
    title: string;
    description: string;
    preview: boolean;
    badge: 'Reale' | 'Anteprima';
};

export type NetworkOperatingModeViewModel = {
    currentState: NetworkOperatingStateView;
    stateCatalog: NetworkOperatingStateView[];
    currentReplicaState: NetworkReplicaStateView;
    replicaStateCatalog: NetworkReplicaStateView[];
    activationReasonLabel: string;
    nodeStatusLabel: string;
    pairingLabel: string;
    aiRuntimeLabel: string;
    aiRuntimeDescription: string;
    aiLocalRuntimeLabel: string;
    aiFallbackLabel: string;
    aiRolloutGateLabel: string;
    aiCapabilityStatus: NetworkCapabilityStatus;
    aiSurfaceLabels: string[];
    aiGuardrails: string[];
    replicaAuthorityLabel: string;
    replicaPendingActionLabel: string;
    replicaConflictModelLabel: string;
    backupBoundaryLabel: string;
    identityCredentialLabel: string;
    identityLoginModeLabel: string;
    identityOperatorLabel: string;
    identityScopeLabel: string;
    identityScopeSourceLabel: string;
    identityAuditLabel: string;
    identityPairingBoundaryLabel: string;
    identityLimitations: string[];
    lastContactLabel: string;
    lastSyncLabel: string;
};

function buildStateCatalog(): NetworkOperatingStateView[] {
    return [
        {
            code: 'local',
            label: 'Locale',
            title: 'Lavoro locale attivo',
            description: 'Il default resta local-first: dati e operativita vivono sul computer corrente senza dipendere dal nodo centrale.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'network-available-not-active',
            label: 'Rete disponibile',
            title: 'Mac principale pronto, associazione non completata',
            description: 'Il nodo e preparato per la rete locale, ma associazione e accesso da altri dispositivi devono ancora essere completati.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'network-active',
            label: 'Rete attiva',
            title: 'Mac associato online',
            description: 'Il nodo espone il primo canale dati in sola lettura ai dispositivi autorizzati con sessione operatore valida.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'offline-fallback',
            label: 'Fallback locale',
            title: 'Nodo non raggiungibile, cache locale degradata',
            description: 'Stato previsto per il fallback locale in sola lettura dopo associazione, con riallineamento successivo ancora fuori scope.',
            preview: true,
            badge: 'Anteprima',
        },
    ];
}

function buildReplicaStateCatalog(): NetworkReplicaStateView[] {
    return [
        {
            code: 'local-only',
            label: 'Backup locale',
            title: 'Nessun mirror attivo',
            description: 'Fuori dalla modalita rete il dato resta locale e il backup v1 non viene trattato come replica.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'unpaired',
            label: 'Pairing richiesto',
            title: 'Mirror pronto, associazione mancante',
            description: 'La modalita rete e attiva, ma finche non esiste una associazione non parte alcun riallineamento snapshot.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'online',
            label: 'Mirror online',
            title: 'Nodo associato pronto al riallineamento',
            description: 'Associazione attiva: il nodo puo gia servire il primo canale dati in sola lettura; sync e snapshot restano lavori separati.',
            preview: false,
            badge: 'Reale',
        },
        {
            code: 'offline-deferred',
            label: 'Riallineamento in attesa',
            title: 'Rete assente, mirror in coda',
            description: 'Il lavoro continua in locale, ma il riallineamento verso il nodo resta in coda e richiede un passaggio esplicito successivo.',
            preview: true,
            badge: 'Anteprima',
        },
        {
            code: 'conflict-review',
            label: 'Review manuale',
            title: 'Delta non promuovibile automaticamente',
            description: 'Il riallineamento incontra un conflitto o uno stato ambiguo e viene fermato in review, senza merge impliciti.',
            preview: true,
            badge: 'Anteprima',
        },
    ];
}

function currentStateCode(session: NetworkSessionSummary): NetworkOperatingStateCode {
    switch (session.sessionState) {
        case 'network-paired-online':
            return 'network-active';
        case 'network-paired-offline-degraded':
            return 'offline-fallback';
        case 'network-unpaired':
            return 'network-available-not-active';
        case 'local-only':
        default:
            return 'local';
    }
}

function lookupState(code: NetworkOperatingStateCode): NetworkOperatingStateView {
    return buildStateCatalog().find((item) => item.code === code) ?? buildStateCatalog()[0];
}

function lookupReplicaState(code: NetworkReplicaSummary['state']): NetworkReplicaStateView {
    return buildReplicaStateCatalog().find((item) => item.code === code) ?? buildReplicaStateCatalog()[0];
}

function activationReasonLabel(reason: NetworkOverviewPayload['activationReason']): string {
    switch (reason) {
        case 'manual':
            return 'Manuale';
        case 'fallback-preview':
            return 'Fallback';
        case 'default-local':
        default:
            return 'Default locale';
    }
}

function nodeStatusLabel(session: NetworkSessionSummary): string {
    switch (session.sessionState) {
        case 'network-paired-online':
            return 'Online';
        case 'network-paired-offline-degraded':
            return 'Offline';
        case 'network-unpaired':
            return 'Disponibile';
        case 'local-only':
        default:
            return 'Locale';
    }
}

function pairingLabel(session: NetworkSessionSummary): string {
    switch (session.pairingState) {
        case 'paired':
            return 'Completato';
        case 'required':
            return 'Richiesto';
        case 'disabled':
        default:
            return 'Disabilitato';
    }
}

function aiRuntimeLabel(aiRuntime: NetworkAiRuntimeSummary): string {
    switch (aiRuntime.mode) {
        case 'centralized-available':
            return 'AI centralizzata disponibile';
        case 'centralized-unavailable':
            return 'AI centralizzata non disponibile';
        case 'local-ai':
        default:
            return 'AI locale';
    }
}

function aiRuntimeDescription(aiRuntime: NetworkAiRuntimeSummary): string {
    switch (aiRuntime.mode) {
        case 'centralized-available':
            return 'Il nodo puo esporre il proprio runtime AI locale ai dispositivi associati senza spostare i dati clinici.';
        case 'centralized-unavailable':
            return 'La modalita rete e attiva, ma il runtime locale del nodo non e pronto per i dispositivi associati.';
        case 'local-ai':
        default:
            return 'Il nodo usa il runtime AI solo in locale e non promette inferenza remota o pairing AI.';
    }
}

function aiLocalRuntimeLabel(aiRuntime: NetworkAiRuntimeSummary): string {
    const hardwareProfile = aiRuntime.localRuntime.hardwareProfile === 'unknown'
        ? 'profilo non dichiarato'
        : `profilo ${aiRuntime.localRuntime.hardwareProfile}`;
    if (aiRuntime.localRuntime.state === 'misconfigured') {
        return `Ollama locale non valido, ${hardwareProfile}`;
    }
    return `Ollama locale pronto, ${hardwareProfile}`;
}

function aiFallbackLabel(aiRuntime: NetworkAiRuntimeSummary): string {
    switch (aiRuntime.fallbackPolicy) {
        case 'client-local-runtime-else-ai-unavailable':
        default:
            return aiRuntime.localRuntime.state === 'configured'
                ? 'Fallback: runtime locale del client se presente, altrimenti AI non disponibile'
                : 'Fallback: AI non disponibile finche il runtime locale non torna valido';
    }
}

function aiRolloutGateLabel(aiRuntime: NetworkAiRuntimeSummary): string {
    switch (aiRuntime.rolloutGate) {
        case 'lane-benchmarks-and-rollout-governance-required':
        default:
            return 'Benchmark per area AI e governance prima dell attivazione reale';
    }
}

function aiSurfaceLabel(surface: NetworkAiRuntimeSummary['surfaces'][number]): string {
    switch (surface) {
        case 'patient-insight':
            return 'Patient Insight';
        case 'smart-import':
            return 'Smart Import';
        case 'document-synthesis':
        default:
            return 'Document Synthesis';
    }
}

function replicaAuthorityLabel(replica: NetworkReplicaSummary): string {
    switch (replica.authority) {
        case 'paired-home-base':
            return 'Nodo associato';
        case 'local-device':
        default:
            return 'Dispositivo locale';
    }
}

function replicaPendingActionLabel(replica: NetworkReplicaSummary): string {
    switch (replica.pendingAction) {
        case 'pairing-required':
            return 'Serve pairing';
        case 'queue-snapshot':
            return 'Riallinea snapshot';
        case 'manual-review':
            return 'Apri review';
        case 'none':
        default:
            return 'Nessuna';
    }
}

function replicaConflictModelLabel(replica: NetworkReplicaSummary): string {
    switch (replica.conflictMode) {
        case 'restore-preflight-plus-version-check':
        default:
            return 'Preflight restore + version check';
    }
}

function backupBoundaryLabel(replica: NetworkReplicaSummary): string {
    switch (replica.backupBoundary) {
        case 'artifact-v1-remains-backup-only':
        default:
            return 'Il backup v1 resta separato dal mirror di rete';
    }
}

function identityCredentialLabel(identity: NetworkIdentitySummary): string {
    switch (identity.credentialState) {
        case 'session-bound':
            return 'Sessione operatore attiva';
        case 'node-credentials-required':
        default:
            return 'Credenziali nodo richieste';
    }
}

function identityLoginModeLabel(identity: NetworkIdentitySummary): string {
    switch (identity.loginMode) {
        case 'single-local-user-default':
            return 'PIN-only se esiste un solo account locale';
        case 'explicit-username-required':
        default:
            return 'Username + PIN quando gli account locali sono multipli';
    }
}

function identityOperatorLabel(identity: NetworkIdentitySummary): string {
    if (identity.operator.displayName) return identity.operator.displayName;
    if (identity.displayNameHint) return identity.displayNameHint;
    if (identity.operator.username) return identity.operator.username;
    if (identity.usernameHint) return identity.usernameHint;
    return 'Operatore non ancora legato al nodo';
}

function identityScopeLabel(identity: NetworkIdentitySummary): string {
    return identity.scope.effectiveAmbulatoryName ?? 'Nessun ambulatorio effettivo';
}

function identityScopeSourceLabel(identity: NetworkIdentitySummary): string {
    switch (identity.scope.source) {
        case 'session-context':
            return 'Contesto sessione';
        case 'node-default':
            return 'Default nodo';
        case 'none':
        default:
            return 'Nessuna risoluzione';
    }
}

function identityAuditLabel(identity: NetworkIdentitySummary): string {
    return identity.audit.actorBinding === 'session-user'
        ? 'Audit legato alla sessione utente'
        : 'Solo token di trasporto, non identita operatore';
}

function identityPairingBoundaryLabel(identity: NetworkIdentitySummary): string {
    switch (identity.pairingBoundary) {
        case 'device-pairing-separate-from-operator-login':
        default:
            return 'Il pairing del device non sostituisce il login operatore';
    }
}

function timestampLabel(value: string | null, emptyLabel: string): string {
    if (!value) return emptyLabel;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return emptyLabel;
    return date.toLocaleString('it-IT', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    });
}

export function deriveNetworkOperatingModeViewModel(
    overview: NetworkOverviewPayload
): NetworkOperatingModeViewModel {
    const stateCatalog = buildStateCatalog();
    const replicaStateCatalog = buildReplicaStateCatalog();
    const code = currentStateCode(overview.session);
    const aiStatus = overview.aiRuntime.centralRuntime.capabilityStatus;
    const lastSnapshotAt = overview.session.replica.lastSnapshotAt ?? overview.lastContactAt;
    const lastReconciledAt = overview.session.replica.lastReconciledAt ?? overview.lastSyncAt;

    return {
        currentState: stateCatalog.find((item) => item.code === code) ?? lookupState('local'),
        stateCatalog,
        currentReplicaState: replicaStateCatalog.find((item) => item.code === overview.session.replica.state)
            ?? lookupReplicaState('local-only'),
        replicaStateCatalog,
        activationReasonLabel: activationReasonLabel(overview.activationReason),
        nodeStatusLabel: nodeStatusLabel(overview.session),
        pairingLabel: pairingLabel(overview.session),
        aiRuntimeLabel: aiRuntimeLabel(overview.aiRuntime),
        aiRuntimeDescription: aiRuntimeDescription(overview.aiRuntime),
        aiLocalRuntimeLabel: aiLocalRuntimeLabel(overview.aiRuntime),
        aiFallbackLabel: aiFallbackLabel(overview.aiRuntime),
        aiRolloutGateLabel: aiRolloutGateLabel(overview.aiRuntime),
        aiCapabilityStatus: aiStatus,
        aiSurfaceLabels: overview.aiRuntime.surfaces.map((surface) => aiSurfaceLabel(surface)),
        aiGuardrails: overview.aiRuntime.guardrails,
        replicaAuthorityLabel: replicaAuthorityLabel(overview.session.replica),
        replicaPendingActionLabel: replicaPendingActionLabel(overview.session.replica),
        replicaConflictModelLabel: replicaConflictModelLabel(overview.session.replica),
        backupBoundaryLabel: backupBoundaryLabel(overview.session.replica),
        identityCredentialLabel: identityCredentialLabel(overview.identity),
        identityLoginModeLabel: identityLoginModeLabel(overview.identity),
        identityOperatorLabel: identityOperatorLabel(overview.identity),
        identityScopeLabel: identityScopeLabel(overview.identity),
        identityScopeSourceLabel: identityScopeSourceLabel(overview.identity),
        identityAuditLabel: identityAuditLabel(overview.identity),
        identityPairingBoundaryLabel: identityPairingBoundaryLabel(overview.identity),
        identityLimitations: overview.identity.limitations,
        lastContactLabel: timestampLabel(lastSnapshotAt, 'Non ancora disponibile'),
        lastSyncLabel: timestampLabel(lastReconciledAt, 'Non ancora disponibile'),
    };
}
