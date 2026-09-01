#if os(macOS)
import AppKit
import SwiftUI
import UniformTypeIdentifiers

/// State for the host administration surface.
///
/// Loads each panel independently: a host whose audit log fails to read still has
/// a version, a network mode and a runtime worth showing. One failed request
/// blanking the whole page would hide exactly the information an operator opens
/// this surface to find.
@MainActor
final class HostAdminStore: ObservableObject {
    @Published private(set) var updateAwareness: HostUpdateAwareness?
    @Published private(set) var networkOverview: HostNetworkOverview?
    @Published private(set) var aiModels: HostAIModels?
    @Published private(set) var auditSummary: HostAuditSummary?
    @Published private(set) var backupScheduler: HostBackupScheduler?
    @Published private(set) var exportMessage: String?

    @Published private(set) var failures: [String: String] = [:]
    @Published private(set) var isLoading = false
    @Published private(set) var lastRefresh: Date?

    func refresh(connection: ClinicalWorkspaceConnection?, serverURL: String, tlsPin: String) async {
        guard let connection else {
            failures = ["connessione": "Collega l'home-base per leggere lo stato dell'host."]
            return
        }
        guard HostAdminAvailability.isLocalHost(serverURLString: serverURL) else {
            failures = ["ambito": HostAdminError.notLocalHost.errorDescription ?? ""]
            return
        }

        isLoading = true
        defer { isLoading = false }
        failures = [:]

        let client = HomeBaseHostAdminClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: serverURL, tlsPin: tlsPin)
        )
        let cookie = connection.sessionCookie

        // Sequential rather than a task group: these are four small requests to a
        // loopback runtime, and staying on the main actor keeps the published
        // state assignments straightforward.
        updateAwareness = await attempt("versione") { try await client.updateAwareness(sessionCookie: cookie) }
        networkOverview = await attempt("rete") { try await client.networkOverview(sessionCookie: cookie) }
        aiModels = await attempt("modelli AI") { try await client.aiModels(sessionCookie: cookie) }
        auditSummary = await attempt("audit") { try await client.auditSummary(sessionCookie: cookie) }
        backupScheduler = await attempt("backup") { try await client.backupScheduler(sessionCookie: cookie) }

        lastRefresh = Date()
    }

    /// Writes the archive only where the operator pointed. No default location,
    /// no silent write: the artifact is the entire clinical archive in one file.
    func exportArchive(connection: ClinicalWorkspaceConnection?, serverURL: String, tlsPin: String, to destination: URL) async {
        guard let connection else { return }
        exportMessage = nil
        let client = HomeBaseHostAdminClient(
            configuration: HomeBaseConnectionConfiguration(serverURLString: serverURL, tlsPin: tlsPin)
        )
        do {
            let data = try await client.exportBackupArtifact(sessionCookie: connection.sessionCookie)
            try data.write(to: destination, options: [.atomic])
            let size = ByteCountFormatter.string(fromByteCount: Int64(data.count), countStyle: .file)
            exportMessage = "Archivio esportato in \(destination.path) (\(size))."
        } catch {
            exportMessage = (error as? HostAdminError)?.errorDescription ?? error.localizedDescription
        }
    }

    /// Records the failure against its panel name and returns nil, so one
    /// unreadable panel never takes the others down with it.
    private func attempt<T>(_ label: String, _ operation: () async throws -> T) async -> T? {
        do {
            return try await operation()
        } catch {
            failures[label] = (error as? HostAdminError)?.errorDescription ?? error.localizedDescription
            return nil
        }
    }
}

/// The host's own state: version, network mode, runtime paths, paired devices and
/// AI models. Read-only in this pass — the destructive host operations (backup and
/// restore, database repair, orphan fixing) are deliberately not wired to a button
/// until each one carries its own confirmation and its own evidence.
struct HostAdminWorkspaceView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var store = HostAdminStore()
    @State private var confirmsExport = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !store.failures.isEmpty {
                    failureSection
                }
                versionSection
                auditSection
                backupSection
                networkSection
                runtimeSection
                aiSection
                pendingSection
            }
            .padding(20)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .task(id: workspaceModel.clinicalWorkspaceConnection?.identity) {
            await refresh()
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    Task { await refresh() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .disabled(store.isLoading)
                .accessibilityIdentifier("host-admin-refresh")
            }
        }
        .confirmationDialog(
            "Esportare l'intero archivio clinico?",
            isPresented: $confirmsExport,
            titleVisibility: .visible
        ) {
            Button("Scegli destinazione ed esporta") { presentSavePanel() }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Il file conterrà tutti i pazienti e i loro dati clinici in un unico documento. Resta sul tuo disco e non viene inviato a nessuno, ma da quel momento vive fuori dall'archivio protetto: scegli una destinazione che tratteresti come i dati stessi.")
        }
        .accessibilityIdentifier("clinical-workspace-host-view")
    }

    /// A save panel, so the destination is always a deliberate choice.
    private func presentSavePanel() {
        let panel = NSSavePanel()
        panel.title = "Esporta archivio MediFlow"
        panel.nameFieldStringValue = "mediflow-archivio.json"
        panel.allowedContentTypes = [.json]
        panel.isExtensionHidden = false
        guard panel.runModal() == .OK, let url = panel.url else { return }
        Task {
            await store.exportArchive(
                connection: workspaceModel.clinicalWorkspaceConnection,
                serverURL: workspaceModel.serverURL,
                tlsPin: workspaceModel.tlsPin,
                to: url
            )
        }
    }

    private func refresh() async {
        await store.refresh(
            connection: workspaceModel.clinicalWorkspaceConnection,
            serverURL: workspaceModel.serverURL,
            tlsPin: workspaceModel.tlsPin
        )
    }

    // MARK: - Sections

    private var failureSection: some View {
        section("Non leggibile", systemImage: "exclamationmark.triangle") {
            ForEach(store.failures.sorted(by: { $0.key < $1.key }), id: \.key) { label, message in
                InfoRow(label.capitalized, message)
            }
        }
    }

    @ViewBuilder
    private var versionSection: some View {
        if let update = store.updateAwareness {
            section("Versione", systemImage: "shippingbox") {
                if let value = update.currentVersion { InfoRow("Installata", value) }
                if let value = update.latestVersion { InfoRow("Disponibile", value) }
                if let value = update.branch { InfoRow("Ramo", value) }
                if let value = update.revision { InfoRow("Revisione", value) }
                if let available = update.updateAvailable {
                    InfoRow("Aggiornamento", available ? "Disponibile" : "Nessuno")
                }
            }
        }
    }

    /// Labelled for what the numbers actually are. The host computes them over at
    /// most 200 records regardless of the window, so calling `totalEvents`
    /// "eventi nel periodo" would overstate a partial count as a total.
    @ViewBuilder
    private var auditSection: some View {
        if let audit = store.auditSummary {
            section("Audit operativo", systemImage: "checkmark.shield") {
                InfoRow("Finestra", "\(audit.days ?? 30) giorni")
                InfoRow("Eventi esaminati", String(audit.totalEvents ?? 0))
                InfoRow("Operatori distinti", String(audit.distinctActors ?? 0))
                if let outcomes = audit.outcomes {
                    InfoRow(
                        "Esiti",
                        "\(outcomes.success ?? 0) riusciti · \(outcomes.failure ?? 0) falliti · \(outcomes.denied ?? 0) negati"
                    )
                }
                if let surfaces = audit.sourceSurfaces {
                    InfoRow(
                        "Origine",
                        "web \(surfaces.web ?? 0) · nativo \(surfaces.native ?? 0) · api \(surfaces.api ?? 0) · job \(surfaces.job ?? 0)"
                    )
                }
                ForEach(audit.topEventTypes ?? []) { entry in
                    InfoRow(entry.eventType ?? "Evento", String(entry.count ?? 0))
                }
                if audit.reachedRecordCap {
                    Text("L'host limita questa lettura a 200 eventi: i conteggi qui sopra descrivono gli ultimi 200, non l'intero periodo.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    @ViewBuilder
    private var backupSection: some View {
        if let backup = store.backupScheduler {
            section("Backup", systemImage: "externaldrive.badge.timemachine") {
                InfoRow("Pianificazione", (backup.supported ?? false) ? "Supportata su questo host" : "Non supportata su questo host")
                InfoRow("Installata", (backup.installed ?? false) ? "Sì" : "No")
                if let kind = backup.scheduleKind { InfoRow("Tipo", kind) }
                if let path = backup.schedulePath { InfoRow("Percorso", path) }
                if let state = backup.state {
                    if let enabled = state.enabled { InfoRow("Attiva", enabled ? "Sì" : "No") }
                    if let hour = state.hour, let minute = state.minute {
                        InfoRow("Orario", String(format: "%02d:%02d", hour, minute))
                    }
                    if let retention = state.retentionDays { InfoRow("Conservazione", "\(retention) giorni") }
                    if let destination = state.destination { InfoRow("Destinazione", destination) }
                    InfoRow("Ultima esecuzione", state.lastRunAt ?? "Mai")
                    if let result = state.lastResult { InfoRow("Ultimo esito", result) }
                }

                Divider().padding(.vertical, 2)

                Button {
                    confirmsExport = true
                } label: {
                    Label("Esporta archivio…", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("host-backup-export")

                if let message = store.exportMessage {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Text("Ripristino, riparazione del database, correzione orfani e migrazione restano fuori da questa app. Il ripristino sovrascrive l'archivio e la riparazione elimina il file ritirato dopo il rimpiazzo: sono operazioni senza ritorno, e finché non portano qui una conferma e una prova di esito proprie si eseguono da localhost.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private var networkSection: some View {
        if let overview = store.networkOverview {
            if let node = overview.node {
                section("Nodo", systemImage: "network") {
                    if let value = node.displayName { InfoRow("Nome", value) }
                    if let value = node.operatingMode { InfoRow("Modalità", value) }
                    if let value = node.role { InfoRow("Ruolo", value) }
                    if let value = node.protocolVersion { InfoRow("Protocollo", value) }
                    if let value = node.nodeId { InfoRow("Identificativo", value) }
                    if let port = node.transport?.localTlsPort { InfoRow("Porta TLS", String(port)) }
                }
            }
            if let session = overview.session {
                section("Sessione e replica", systemImage: "arrow.triangle.2.circlepath") {
                    if let value = session.sessionState { InfoRow("Stato", value) }
                    if let value = session.pairingState { InfoRow("Abbinamento", value) }
                    if let value = session.authMode { InfoRow("Autenticazione", value) }
                    if let trusted = session.trustedSession { InfoRow("Sessione fidata", trusted ? "Sì" : "No") }
                    if let reason = session.degradedReason { InfoRow("Degrado", reason) }
                    if let replica = session.replica {
                        if let value = replica.state { InfoRow("Replica", value) }
                        if let value = replica.authority { InfoRow("Autorità", value) }
                        if let value = replica.pendingAction { InfoRow("Azione in attesa", value) }
                        InfoRow("Ultimo snapshot", replica.lastSnapshotAt ?? "Mai")
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var runtimeSection: some View {
        if let runtime = store.networkOverview?.aiRuntime {
            section("Runtime AI", systemImage: "cpu") {
                if let value = runtime.mode { InfoRow("Modalità", value) }
                if let local = runtime.localRuntime {
                    if let value = local.provider { InfoRow("Provider", value) }
                    if let value = local.state { InfoRow("Stato", value) }
                    if let value = local.targetPolicy { InfoRow("Politica di rete", value) }
                    if let value = local.hardwareProfile { InfoRow("Profilo hardware", value) }
                    InfoRow("Modello clinico", local.clinicalModel ?? "Non impostato")
                    InfoRow("Modello ragionamento", local.reasoningModel ?? "Non impostato")
                    InfoRow("OCR", "Non disponibile nella 0.8.5")
                }
            }
        }
    }

    @ViewBuilder
    private var aiSection: some View {
        if let ai = store.aiModels {
            section("Modelli installati", systemImage: "shippingbox.and.arrow.backward") {
                if let runtime = ai.runtime { InfoRow("Runtime", runtime) }
                let models = ai.models ?? []
                if models.isEmpty {
                    InfoRow("Modelli", "Nessun modello installato")
                } else {
                    ForEach(models) { model in
                        InfoRow(model.name ?? "Modello", model.status ?? "installato")
                    }
                }
            }
        }
    }

    /// States what is not here yet, by name. A host page that silently omits
    /// backup and database repair reads as if this host had neither.
    private var pendingSection: some View {
        section("Non ancora in questa app", systemImage: "ellipsis.circle") {
            Text("Backup e ripristino, riparazione database, correzione orfani, migrazione many-to-many, import repertori AIFA ed esenzioni, conversazioni AI e Smart Import esistono sull'host e si usano da localhost. Sono operazioni che modificano o esportano l'archivio clinico: qui arrivano con conferma esplicita e prova di esito, non prima.")
                .font(.callout)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private func section<Content: View>(
        _ title: String,
        systemImage: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: systemImage)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .accessibilityHeading(.h2)
            content()
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lumeSurface(zone: .field)
    }
}
#endif
