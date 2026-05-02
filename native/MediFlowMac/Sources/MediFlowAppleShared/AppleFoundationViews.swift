// Codex: created 2026-04-17
// @Codex
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public struct AppleFoundationWindowContent: View {
    public let snapshot: AppleFoundationSnapshot

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
    }

    public var body: some View {
        AppleFoundationOverviewView(snapshot: snapshot)
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(PlatformColors.groupedBackground)
    }
}

public struct AppleFoundationOverviewView: View {
    public let snapshot: AppleFoundationSnapshot

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                safetyNotes
                HomeBaseRuntimeStatusView()
                lanes
                milestones
            }
            .padding(.vertical, 2)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(snapshot.title)
                .font(.largeTitle.weight(.semibold))
            Text(snapshot.summary)
                .font(.body)
                .foregroundStyle(.secondary)
            Text(snapshot.statusLine)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .padding(.top, 2)
        }
    }

    private var safetyNotes: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Guardrail")
                .font(.headline)
            ForEach(snapshot.safetyNotes, id: \.self) { note in
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "checkmark.shield")
                        .foregroundStyle(.green)
                        .font(.body)
                    Text(note)
                        .font(.subheadline)
                        .foregroundStyle(.primary)
                }
            }
        }
        .cardStyle()
    }

    private var lanes: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Ambiti")
                .font(.headline)
            ForEach(snapshot.lanes) { lane in
                AppleCapabilityLaneCard(lane: lane)
            }
        }
    }

    private var milestones: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Sequenza")
                .font(.headline)
            ForEach(snapshot.milestones) { milestone in
                AppleMilestoneCard(milestone: milestone)
            }
        }
    }
}

public struct AppleCapabilityLaneCard: View {
    public let lane: AppleCapabilityLane

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(lane: AppleCapabilityLane) {
        self.lane = lane
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Text(lane.title)
                    .font(.headline)
                Text(lane.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Label(lane.sourceOfTruth, systemImage: "doc.text")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if usesStackedPlatformLayout {
                VStack(alignment: .leading, spacing: 10) {
                    platformStatusSection("macOS", status: lane.macOS)
                    platformStatusSection("iPhone", status: lane.iPhone)
                    platformStatusSection("iPad", status: lane.iPad)
                }
            } else {
                Grid(alignment: .leading, horizontalSpacing: 16, verticalSpacing: 10) {
                    GridRow {
                        platformHeader("macOS")
                        platformHeader("iPhone")
                        platformHeader("iPad")
                    }
                    GridRow {
                        platformStatus(lane.macOS)
                        platformStatus(lane.iPhone)
                        platformStatus(lane.iPad)
                    }
                }
            }

            Label("Next: \(lane.nextIssue)", systemImage: "arrowshape.right")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
        }
        .cardStyle()
    }

    private func platformHeader(_ title: String) -> some View {
        Text(title)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func platformStatusSection(_ title: String, status: ApplePlatformStatus) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            platformHeader(title)
            platformStatus(status)
        }
    }

    private func platformStatus(_ status: ApplePlatformStatus) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: status.phase.symbolName)
                    .foregroundStyle(status.phase.tintColor)
                Text(status.phase.title)
                    .font(.caption.weight(.semibold))
            }
            Text(status.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var usesStackedPlatformLayout: Bool {
        #if os(macOS)
        return false
        #else
        return horizontalSizeClass == .compact
        #endif
    }
}

public struct AppleFoundationMobileRootView: View {
    public let snapshot: AppleFoundationSnapshot

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif
    @State private var section: AppleFoundationSection

    public init(snapshot: AppleFoundationSnapshot) {
        self.snapshot = snapshot
        let launchOverrides = AppleFoundationLaunchOverrides.load()
        _section = State(initialValue: launchOverrides.initialSection ?? .overview)
    }

    public var body: some View {
        Group {
            if usesSplitLayout {
                NavigationSplitView {
                    List {
                        ForEach(AppleFoundationSection.allCases) { item in
                            Button {
                                section = item
                            } label: {
                                HStack {
                                    Label(item.title, systemImage: item.symbolName)
                                    Spacer(minLength: 12)
                                    if item == section {
                                        Image(systemName: "checkmark")
                                            .foregroundStyle(.tint)
                                    }
                                }
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("apple-foundation-section-\(item.rawValue)-button")
                        }
                    }
                    .navigationTitle("MediFlow")
                } detail: {
                    detailView(for: section)
                        .navigationTitle(section.title)
                }
            } else {
                TabView(selection: $section) {
                    NavigationStack {
                        detailView(for: .overview)
                            .navigationTitle(AppleFoundationSection.overview.title)
                    }
                    .tag(AppleFoundationSection.overview)
                    .tabItem {
                        Label(AppleFoundationSection.overview.title, systemImage: AppleFoundationSection.overview.symbolName)
                    }

                    NavigationStack {
                        detailView(for: .modules)
                            .navigationTitle(AppleFoundationSection.modules.title)
                    }
                    .tag(AppleFoundationSection.modules)
                    .tabItem {
                        Label(AppleFoundationSection.modules.title, systemImage: AppleFoundationSection.modules.symbolName)
                    }

                    NavigationStack {
                        detailView(for: .milestones)
                            .navigationTitle(AppleFoundationSection.milestones.title)
                    }
                    .tag(AppleFoundationSection.milestones)
                    .tabItem {
                        Label(AppleFoundationSection.milestones.title, systemImage: AppleFoundationSection.milestones.symbolName)
                    }
                }
            }
        }
    }

    private var usesSplitLayout: Bool {
        #if os(macOS)
        return true
        #else
        return horizontalSizeClass == .regular
        #endif
    }

    @ViewBuilder
    private func detailView(for section: AppleFoundationSection) -> some View {
        switch section {
        case .overview:
            AppleFoundationOverviewView(snapshot: snapshot)
                .padding(20)
                .background(PlatformColors.groupedBackground)
                .accessibilityIdentifier("apple-foundation-overview-view")
        case .runtime:
            ScrollView {
                HomeBaseRuntimeStatusView()
                    .padding(20)
            }
            .background(PlatformColors.groupedBackground)
            .accessibilityIdentifier("apple-foundation-runtime-view")
        case .modules:
            PairedPatientsWorkspaceView()
                .accessibilityIdentifier("apple-foundation-modules-view")
        case .milestones:
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    ForEach(snapshot.milestones) { milestone in
                        AppleMilestoneCard(milestone: milestone)
                    }
                }
                .padding(20)
            }
            .background(PlatformColors.groupedBackground)
            .accessibilityIdentifier("apple-foundation-milestones-view")
        }
    }
}

public struct HomeBaseRuntimeStatusView: View {
    @State private var snapshot = HomeBaseRuntimeStatusLoader.load()
    @State private var optionalServices = HomeBaseOptionalServicesSnapshot.initial
    @StateObject private var supervisor = HomeBaseRuntimeSupervisor()

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Runtime home-base")
                        .font(.headline)
                    Text(snapshot.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Button {
                    snapshot = HomeBaseRuntimeStatusLoader.load()
                    Task { await refreshOptionalServices() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("homebase-runtime-refresh-button")
            }

            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                runtimeRow("Server", value: snapshot.baseURL ?? "Non configurato")
                runtimeRow("Modalita rete", value: snapshot.networkMode ?? "Non registrata")
                runtimeRow("Ultimo setup", value: snapshot.generatedAt ?? "Non registrato")
                runtimeRow("Cartella dati", value: snapshot.dataDirectory)
            }

            #if os(macOS)
            HStack(spacing: 10) {
                Button {
                    Task { await startBackend() }
                } label: {
                    Label("Avvia backend", systemImage: "play.rectangle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-start-backend-button")

                Button {
                    Task { await stopBackend() }
                } label: {
                    Label("Arresta backend", systemImage: "stop.rectangle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-stop-backend-button")
            }

            HStack(spacing: 10) {
                Button {
                    Task { await startProxy() }
                } label: {
                    Label("Avvia proxy TLS", systemImage: "play.circle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-start-proxy-button")

                Button {
                    Task { await stopProxy() }
                } label: {
                    Label("Arresta proxy TLS", systemImage: "stop.circle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-stop-proxy-button")
            }

            if let statusMessage = supervisor.statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-runtime-supervisor-status")
            }

            if let errorMessage = supervisor.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("homebase-runtime-supervisor-error")
            }
            #endif

            VStack(alignment: .leading, spacing: 8) {
                ForEach(snapshot.components) { component in
                    runtimeComponentRow(
                        title: component.title,
                        detail: component.detail,
                        state: component.state,
                        accessibilityIdentifier: "homebase-runtime-component-\(component.id)"
                    )
                }
            }

            Divider()

            optionalServicesSection

            Text("Backend web e proxy TLS sono gli unici servizi gestiti dalla app. Ollama e Docker/ICD sono mostrati a scopo diagnostico e non vengono mai installati o avviati automaticamente.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
        .accessibilityIdentifier("homebase-runtime-status-card")
        .task {
            await refreshOptionalServices()
        }
    }

    private func runtimeRow(_ title: String, value: String) -> some View {
        GridRow {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
    }

    #if os(macOS)
    private func startProxy() async {
        await supervisor.startProxy(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func stopProxy() async {
        await supervisor.stopProxy(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func startBackend() async {
        await supervisor.startBackend(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func stopBackend() async {
        await supervisor.stopBackend(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }
    #endif

    private var optionalServicesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Servizi opzionali")
                    .font(.subheadline.weight(.semibold))
                Text("Rilevati solo se gia attivi. La app non li installa, avvia o arresta.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(optionalServices.services) { service in
                runtimeComponentRow(
                    title: service.title,
                    detail: service.detail,
                    state: service.state,
                    accessibilityIdentifier: accessibilityIdentifier(for: service)
                )
            }
        }
        .padding(.top, 4)
        .accessibilityIdentifier("homebase-runtime-optional-section")
    }

    private func runtimeComponentRow(
        title: String,
        detail: String,
        state: HomeBaseRuntimeComponentState,
        accessibilityIdentifier: String
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbolName(for: state))
                .foregroundStyle(tintColor(for: state))
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            Text(state.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tintColor(for: state))
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func accessibilityIdentifier(for service: HomeBaseOptionalServiceStatus) -> String {
        switch service.id {
        case "optional-ollama":
            return "homebase-runtime-optional-ollama"
        case "optional-docker-icd":
            return "homebase-runtime-optional-docker"
        default:
            return "homebase-runtime-\(service.id)"
        }
    }

    private func refreshOptionalServices() async {
        optionalServices = await HomeBaseOptionalServicesProbe.probe()
    }

    private func symbolName(for state: HomeBaseRuntimeComponentState) -> String {
        switch state {
        case .ready:
            return "checkmark.circle.fill"
        case .missing:
            return "xmark.circle.fill"
        case .mismatch:
            return "exclamationmark.triangle.fill"
        case .unknown:
            return "questionmark.circle.fill"
        }
    }

    private func tintColor(for state: HomeBaseRuntimeComponentState) -> Color {
        switch state {
        case .ready:
            return .green
        case .missing:
            return .red
        case .mismatch:
            return .orange
        case .unknown:
            return .secondary
        }
    }
}

private struct PairedPatientsWorkspaceView: View {
    @StateObject private var model = PairedPatientsWorkspaceModel()
    @State private var confirmsClearingPairing = false
    private let actionColumns = [GridItem(.adaptive(minimum: 150), spacing: 8)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                credentialsCard
                patientsCard
            }
            .padding(20)
        }
        .background(PlatformColors.groupedBackground)
        .task {
            await model.performAutomaticActionsIfNeeded()
        }
    }

    private var credentialsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Home-base paired")
                .font(.headline)
            Text("Usa credenziali paired generate dal Mac e una login operatore separata.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("Server HTTPS", text: $model.serverURL)
                .accessibilityIdentifier("homebase-server-url-field")
            TextField("Fingerprint SHA256 (opzionale)", text: $model.tlsPin)
                .accessibilityIdentifier("homebase-tls-pin-field")
            Button("Scopri in LAN") {
                Task { await model.discoverHomeBase() }
            }
            .accessibilityIdentifier("homebase-discover-button")
            .disabled(model.isWorking)
            .frame(maxWidth: .infinity, alignment: .leading)
            TextField("Paired client ID", text: $model.pairedClientId)
                .accessibilityIdentifier("homebase-paired-client-id-field")
            SecureField("Paired client token", text: $model.pairedClientToken)
                .accessibilityIdentifier("homebase-paired-client-token-field")
            TextField("Username (opzionale se utente unico)", text: $model.username)
                .accessibilityIdentifier("homebase-username-field")
            SecureField("PIN operatore", text: $model.password)
                .accessibilityIdentifier("homebase-password-field")
            TextField("Ambulatorio attivo (opzionale)", text: $model.ambulatoryId)
                .accessibilityIdentifier("homebase-ambulatory-field")
            LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                Button("Accedi operatore") {
                    Task { await model.login() }
                }
                .accessibilityIdentifier("homebase-login-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Carica pazienti") {
                    Task { await model.loadPatients() }
                }
                .accessibilityIdentifier("homebase-load-patients-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Salva dispositivo") {
                    Task { await model.savePairing() }
                }
                .accessibilityIdentifier("homebase-save-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Dissocia") {
                    confirmsClearingPairing = true
                }
                .tint(.red)
                .accessibilityIdentifier("homebase-clear-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("PIN operatore e sessione restano locali e vengono richiesti a ogni riapertura.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let message = model.discoveryMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-discovery-message")
            }
            if let message = model.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-status-message")
            }
            if let error = model.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("homebase-error-message")
            }
        }
        .cardStyle()
        .confirmationDialog(
            "Dissociare questo dispositivo?",
            isPresented: $confirmsClearingPairing,
            titleVisibility: .visible
        ) {
            Button("Dissocia dispositivo", role: .destructive) {
                Task { await model.clearPairing() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Rimuove credenziali paired e snapshot locale da questo dispositivo.")
        }
    }

    private var patientsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("Consultazione mobile")
                    .font(.headline)
                Spacer(minLength: 8)
                Label(model.connectionState.title, systemImage: model.connectionState.symbolName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(model.connectionState.tintColor)
                    .accessibilityIdentifier("homebase-connection-state")
            }
            Text(model.reconciliationLine)
                .font(.caption)
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("homebase-reconciliation-state")
            if model.isWorking && model.patients.isEmpty {
                ProgressView()
            } else if model.patients.isEmpty {
                Text("Nessun paziente caricato.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.patients) { patient in
                    Button {
                        Task { await model.loadPatient(patient) }
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("\(patient.lastName) \(patient.firstName)")
                                .font(.subheadline.weight(.semibold))
                            Text(patient.taxCode)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                }
            }
            if let detail = model.selectedPatient {
                Divider()
                VStack(alignment: .leading, spacing: 6) {
                    Label("Sola lettura", systemImage: "lock")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text("\(detail.lastName) \(detail.firstName)")
                        .font(.subheadline.weight(.semibold))
                    Text(detail.taxCode)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let monitoringProfile = detail.monitoringProfile, !monitoringProfile.isEmpty {
                        Text(monitoringProfile)
                            .font(.subheadline)
                    }
                    if let statusReason = detail.statusReason, !statusReason.isEmpty {
                        Text(statusReason)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    if let notes = detail.notes, !notes.isEmpty {
                        Text(notes)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
        .cardStyle()
    }
}

@MainActor
private final class PairedPatientsWorkspaceModel: ObservableObject {
    @Published var serverURL = HomeBasePairedSettings.defaultServerURL
    @Published var tlsPin = ""
    @Published var pairedClientId = ""
    @Published var pairedClientToken = ""
    @Published var username = ""
    @Published var password = ""
    @Published var ambulatoryId = ""
    @Published private(set) var patients: [HomeBasePatientSummary] = []
    @Published private(set) var selectedPatient: HomeBasePatientDetail?
    @Published private(set) var discoveryMessage: String?
    @Published private(set) var statusMessage: String?
    @Published private(set) var errorMessage: String?
    @Published private(set) var connectionState: PairedPatientsConnectionState = .notLoaded
    @Published private(set) var reconciliationLine = "Sola lettura mobile. Nessuna scrittura offline disponibile."
    @Published private(set) var isWorking = false

    private let pairedStore: HomeBasePairedStore
    private let cacheStore: HomeBasePatientCacheStore
    private let automaticActions: AppleFoundationLaunchOverrides.AutomaticActions
    private var didPerformAutomaticActions = false
    private var sessionCookie: String?

    init(
        pairedStore: HomeBasePairedStore = .shared,
        cacheStore: HomeBasePatientCacheStore = .shared
    ) {
        self.pairedStore = pairedStore
        self.cacheStore = cacheStore
        let launchOverrides = AppleFoundationLaunchOverrides.load()
        self.automaticActions = launchOverrides.automaticActions
        do {
            let snapshot = try pairedStore.loadSnapshot()
            self.serverURL = snapshot.settings.serverURL
            self.tlsPin = snapshot.settings.tlsPin
            self.pairedClientId = snapshot.settings.pairedClientId
            self.pairedClientToken = snapshot.pairedClientToken
            self.username = snapshot.settings.username
            self.ambulatoryId = snapshot.settings.ambulatoryId
        } catch {
            let settings = pairedStore.loadSettings()
            self.serverURL = settings.serverURL
            self.tlsPin = settings.tlsPin
            self.pairedClientId = settings.pairedClientId
            self.username = settings.username
            self.ambulatoryId = settings.ambulatoryId
            self.errorMessage = error.localizedDescription
        }
        applyLaunchOverrides(launchOverrides)
        restoreCachedPatientList()
    }

    func performAutomaticActionsIfNeeded() async {
        guard !didPerformAutomaticActions else { return }
        didPerformAutomaticActions = true

        if automaticActions.autoDiscover {
            await discoverHomeBase()
        }

        if automaticActions.autoLogin {
            guard errorMessage == nil else { return }
            await login()
        }

        if automaticActions.shouldAutoLoadPatients(hasActiveSession: sessionCookie != nil) {
            await loadPatients()
        }
    }

    func discoverHomeBase() async {
        await runTask {
            let candidate = try await HomeBaseBonjourDiscovery().discoverFirst()
            self.serverURL = candidate.serverURLString
            if let tlsPin = candidate.tlsPin {
                self.tlsPin = tlsPin
            }
            self.discoveryMessage = candidate.reviewLine
            self.statusMessage = "Home-base trovato in LAN."
        }
    }

    func login() async {
        guard !password.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            errorMessage = "Inserisci il PIN operatore."
            return
        }
        await runTask {
            self.sessionCookie = try await self.makeClient().login(
                username: self.username.trimmedOrNil,
                password: self.password
            )
            self.statusMessage = "Sessione operatore attiva."
        }
    }

    func loadPatients() async {
        guard let sessionCookie else {
            errorMessage = "Esegui prima la login operatore."
            return
        }
        guard let credentials = pairedCredentials else {
            errorMessage = "Inserisci le credenziali paired rilasciate dal Mac."
            return
        }
        await runTask {
            do {
                self.patients = try await self.makeClient().fetchPatients(
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                if self.restoreCachedPatientList(markOffline: true) {
                    self.errorMessage = error.localizedDescription
                    return
                }
                throw error
            }
            self.selectedPatient = nil
            do {
                try self.persistPairing()
                try self.cacheStore.savePatientList(
                    self.patients,
                    serverURL: self.serverURL,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                self.errorMessage = "Pazienti caricati, ma il salvataggio locale non e riuscito: \(error.localizedDescription)"
            }
            self.connectionState = .pairedOnline
            self.reconciliationLine = "Snapshot locale aggiornato. Sola lettura mobile."
            self.statusMessage = self.patients.isEmpty
                ? "Nessun paziente nello scope corrente."
                : "\(self.patients.count) pazienti caricati in lettura."
        }
    }

    func loadPatient(_ patient: HomeBasePatientSummary) async {
        guard let sessionCookie, let credentials = pairedCredentials else { return }
        await runTask {
            self.selectedPatient = try await self.makeClient().fetchPatient(
                id: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Dettaglio \(patient.lastName) aperto in sola lettura."
        }
    }

    func savePairing() async {
        guard pairedCredentials != nil else {
            errorMessage = "Inserisci le credenziali paired rilasciate dal Mac."
            return
        }
        errorMessage = nil
        do {
            try persistPairing()
            statusMessage = "Credenziali paired salvate sul dispositivo."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func clearPairing() async {
        errorMessage = nil
        do {
            try pairedStore.clear()
            serverURL = HomeBasePairedSettings.defaultServerURL
            tlsPin = ""
            pairedClientId = ""
            pairedClientToken = ""
            username = ""
            password = ""
            ambulatoryId = ""
            patients = []
            selectedPatient = nil
            connectionState = .notLoaded
            reconciliationLine = "Sola lettura mobile. Nessuna scrittura offline disponibile."
            discoveryMessage = nil
            sessionCookie = nil
            try cacheStore.clear()
            statusMessage = "Configurazione paired rimossa da questo dispositivo."
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private var pairedCredentials: HomeBasePairedCredentials? {
        let clientId = pairedClientId.trimmingCharacters(in: .whitespacesAndNewlines)
        let clientToken = pairedClientToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clientId.isEmpty, !clientToken.isEmpty else { return nil }
        return HomeBasePairedCredentials(clientId: clientId, clientToken: clientToken)
    }

    private func makeClient() -> HomeBasePatientsClient {
        HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: serverURL, tlsPin: tlsPin))
    }

    private func applyLaunchOverrides(_ launchOverrides: AppleFoundationLaunchOverrides) {
        if let serverURL = launchOverrides.serverURL {
            self.serverURL = serverURL
        }
        if let tlsPin = launchOverrides.tlsPin {
            self.tlsPin = tlsPin
        }
        if let pairedClientId = launchOverrides.pairedClientId {
            self.pairedClientId = pairedClientId
        }
        if let pairedClientToken = launchOverrides.pairedClientToken {
            self.pairedClientToken = pairedClientToken
        }
        if let username = launchOverrides.username {
            self.username = username
        }
        if let password = launchOverrides.password {
            self.password = password
        }
        if let ambulatoryId = launchOverrides.ambulatoryId {
            self.ambulatoryId = ambulatoryId
        }
    }

    private func persistPairing() throws {
        try pairedStore.save(
            settings: HomeBasePairedSettings(
                serverURL: serverURL,
                tlsPin: tlsPin,
                pairedClientId: pairedClientId,
                username: username,
                ambulatoryId: ambulatoryId
            ),
            pairedClientToken: pairedClientToken
        )
    }

    @discardableResult
    private func restoreCachedPatientList(markOffline: Bool = false) -> Bool {
        do {
            guard let snapshot = try cacheStore.loadPatientList(
                serverURL: serverURL,
                ambulatoryId: ambulatoryId.trimmedOrNil
            ) else {
                return false
            }
            patients = snapshot.patients
            selectedPatient = nil
            connectionState = markOffline ? .pairedOfflineDegraded : .cached
            statusMessage = markOffline ? "\(snapshot.reviewLine) Home-base non raggiungibile." : snapshot.reviewLine
            reconciliationLine = markOffline
                ? "Offline degradato: sola consultazione locale. Nessuna scrittura mobile disponibile."
                : "Snapshot locale pronto. Sola lettura mobile."
            return true
        } catch {
            errorMessage = "Cache locale non leggibile: \(error.localizedDescription)"
            return false
        }
    }

    private func runTask(_ operation: @escaping () async throws -> Void) async {
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await operation()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private enum PairedPatientsConnectionState {
    case notLoaded
    case cached
    case pairedOnline
    case pairedOfflineDegraded

    var title: String {
        switch self {
        case .notLoaded:
            return "Non caricato"
        case .cached:
            return "Cache locale"
        case .pairedOnline:
            return "Paired online"
        case .pairedOfflineDegraded:
            return "Offline degradato"
        }
    }

    var symbolName: String {
        switch self {
        case .notLoaded:
            return "circle"
        case .cached:
            return "clock.arrow.circlepath"
        case .pairedOnline:
            return "checkmark.circle.fill"
        case .pairedOfflineDegraded:
            return "exclamationmark.triangle.fill"
        }
    }

    var tintColor: Color {
        switch self {
        case .notLoaded:
            return .secondary
        case .cached:
            return .secondary
        case .pairedOnline:
            return .green
        case .pairedOfflineDegraded:
            return .orange
        }
    }
}

private extension String {
    var trimmedOrNil: String? {
        let trimmed = trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

struct AppleFoundationLaunchOverrides: Equatable {
    struct AutomaticActions: Equatable {
        var autoDiscover = false
        var autoLogin = false
        var autoLoadPatients = false

        func shouldAutoLoadPatients(hasActiveSession: Bool) -> Bool {
            guard autoLoadPatients else { return false }
            return !autoLogin || hasActiveSession
        }
    }

    var initialSection: AppleFoundationSection?
    var serverURL: String?
    var tlsPin: String?
    var pairedClientId: String?
    var pairedClientToken: String?
    var username: String?
    var password: String?
    var ambulatoryId: String?
    var automaticActions = AutomaticActions()

    static func load(processInfo: ProcessInfo = .processInfo) -> AppleFoundationLaunchOverrides {
        load(environment: processInfo.environment)
    }

    static func load(environment: [String: String]) -> AppleFoundationLaunchOverrides {
        AppleFoundationLaunchOverrides(
            initialSection: normalizedSection(environment["MEDIFLOW_APPLE_INITIAL_SECTION"]),
            serverURL: normalized(environment["MEDIFLOW_HOMEBASE_SERVER_URL"]),
            tlsPin: normalized(environment["MEDIFLOW_HOMEBASE_TLS_PIN"]),
            pairedClientId: normalized(environment["MEDIFLOW_HOMEBASE_PAIRED_CLIENT_ID"]),
            pairedClientToken: normalized(environment["MEDIFLOW_HOMEBASE_PAIRED_CLIENT_TOKEN"]),
            username: normalized(environment["MEDIFLOW_HOMEBASE_USERNAME"]),
            password: normalized(environment["MEDIFLOW_HOMEBASE_OPERATOR_PIN"]),
            ambulatoryId: normalized(environment["MEDIFLOW_HOMEBASE_AMBULATORY_ID"]),
            automaticActions: AutomaticActions(
                autoDiscover: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTODISCOVER"]),
                autoLogin: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTOLOGIN"]),
                autoLoadPatients: normalizedFlag(environment["MEDIFLOW_HOMEBASE_AUTOLOAD_PATIENTS"])
            )
        )
    }

    private static func normalized(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func normalizedSection(_ value: String?) -> AppleFoundationSection? {
        guard let normalized = normalized(value)?.lowercased() else { return nil }
        return AppleFoundationSection(rawValue: normalized)
    }

    private static func normalizedFlag(_ value: String?) -> Bool {
        guard let normalized = normalized(value)?.lowercased() else { return false }
        return ["1", "true", "yes", "on"].contains(normalized)
    }
}

public struct AppleMilestoneCard: View {
    public let milestone: AppleMilestone

    public init(milestone: AppleMilestone) {
        self.milestone = milestone
    }

    public var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: milestone.phase.symbolName)
                .foregroundStyle(milestone.phase.tintColor)
                .font(.title3)
                .frame(width: 28)
            VStack(alignment: .leading, spacing: 4) {
                Text(milestone.title)
                    .font(.subheadline.weight(.semibold))
                Text(milestone.summary)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Text(milestone.issue)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .cardStyle()
    }
}

private struct CardStyleModifier: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(PlatformColors.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(Color.primary.opacity(0.06), lineWidth: 1)
            )
    }
}

private extension View {
    func cardStyle() -> some View {
        modifier(CardStyleModifier())
    }
}

private enum PlatformColors {
    static var groupedBackground: Color {
        #if os(macOS)
        return Color(nsColor: .windowBackgroundColor)
        #else
        return Color(uiColor: .systemGroupedBackground)
        #endif
    }

    static var cardBackground: Color {
        #if os(macOS)
        return Color(nsColor: .controlBackgroundColor)
        #else
        return Color(uiColor: .secondarySystemBackground)
        #endif
    }
}

private extension AppleDeliveryPhase {
    var tintColor: Color {
        switch self {
        case .shipping:
            return .green
        case .foundation:
            return .teal
        case .next:
            return .orange
        case .blocked:
            return .red
        }
    }
}
