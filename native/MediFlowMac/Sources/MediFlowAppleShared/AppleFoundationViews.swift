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
    @State private var confirmsDeletingEntry = false
    @State private var deletionCandidateId: String?
    @State private var confirmsDeletingTherapy = false
    @State private var therapyDeletionCandidateId: String?
    @State private var confirmsDeletingCheckup = false
    @State private var checkupDeletionCandidateId: String?
    @State private var confirmsDeletingObservation = false
    @State private var observationDeletionCandidateId: String?
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
        .confirmationDialog(
            "Annullare questa voce diario?",
            isPresented: $confirmsDeletingEntry,
            titleVisibility: .visible
        ) {
            Button("Annulla voce", role: .destructive) {
                guard let deletionCandidateId else { return }
                self.deletionCandidateId = nil
                Task { await model.softDeleteEntry(id: deletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("La voce resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questa terapia?",
            isPresented: $confirmsDeletingTherapy,
            titleVisibility: .visible
        ) {
            Button("Annulla terapia", role: .destructive) {
                guard let therapyDeletionCandidateId else { return }
                self.therapyDeletionCandidateId = nil
                Task { await model.softDeleteTherapy(id: therapyDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("La terapia resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questo controllo?",
            isPresented: $confirmsDeletingCheckup,
            titleVisibility: .visible
        ) {
            Button("Annulla controllo", role: .destructive) {
                guard let checkupDeletionCandidateId else { return }
                self.checkupDeletionCandidateId = nil
                Task { await model.softDeleteCheckup(id: checkupDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("Il controllo resta nello storico come annullato. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questa osservazione?",
            isPresented: $confirmsDeletingObservation,
            titleVisibility: .visible
        ) {
            Button("Annulla osservazione", role: .destructive) {
                guard let observationDeletionCandidateId else { return }
                self.observationDeletionCandidateId = nil
                Task { await model.softDeleteObservation(id: observationDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("L'osservazione resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
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
                VStack(alignment: .leading, spacing: 10) {
                    patientDetailSection(detail)
                    diarySection
                    therapiesSection
                    checkupsSection
                    observationsSection
                }
            }
        }
        .cardStyle()
    }

    private func patientDetailSection(_ detail: HomeBasePatientDetail) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Anagrafica in sola lettura", systemImage: "lock")
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

    private var diarySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Diario clinico", systemImage: "list.bullet.clipboard")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime 20 voci")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Task { await model.loadSelectedPatientEntries() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .font(.caption)
                .disabled(model.isWorking || model.selectedPatient == nil)
                .accessibilityIdentifier("homebase-refresh-entries-button")
            }

            if model.entries.isEmpty {
                Text("Nessuna voce diario caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.entries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(entry.title)
                                .font(.caption.weight(.semibold))
                            Spacer(minLength: 8)
                            Text(Self.entryDateFormatter.string(from: entry.date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(entry.content)
                            .font(.caption)
                            .foregroundStyle(entry.deletedAt == nil ? .primary : .secondary)
                            .lineLimit(4)
                        if entry.deletedAt != nil {
                            Text("Voce annullata")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.orange)
                        } else if model.canMutateEntry(entry) {
                            HStack(spacing: 8) {
                                Button {
                                    model.startEditingEntry(entry)
                                } label: {
                                    Label("Modifica", systemImage: "pencil")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("homebase-edit-entry-button-\(entry.id)")

                                Button(role: .destructive) {
                                    deletionCandidateId = entry.id
                                    confirmsDeletingEntry = true
                                } label: {
                                    Label("Annulla", systemImage: "xmark.circle")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("homebase-delete-entry-button-\(entry.id)")
                            }
                        }
                    }
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }

            if model.isEditingEntry {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Label("Modifica voce online", systemImage: "pencil")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextField("Titolo", text: $model.editEntryTitle)
                        .accessibilityIdentifier("homebase-edit-entry-title-field")
                    Picker("Tipo", selection: $model.editEntryType) {
                        ForEach(PairedDiaryEntryType.allCases) { type in
                            Text(type.title).tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("homebase-edit-entry-type-picker")
                    TextEditor(text: $model.editEntryContent)
                        .frame(minHeight: 90)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(PlatformColors.separator, lineWidth: 1)
                        )
                        .accessibilityIdentifier("homebase-edit-entry-content-field")
                    HStack(spacing: 8) {
                        Text("\(model.editEntryContent.count)/2000")
                            .font(.caption2)
                            .foregroundStyle(model.editEntryContent.count <= 2000 ? Color.secondary : Color.red)
                        Spacer(minLength: 8)
                        Button("Annulla") {
                            model.cancelEditingEntry()
                        }
                        .font(.caption)
                        .accessibilityIdentifier("homebase-cancel-edit-entry-button")
                        Button {
                            Task { await model.updateEditingEntry() }
                        } label: {
                            Label("Salva modifiche", systemImage: "checkmark.circle")
                        }
                        .font(.caption)
                        .disabled(!model.canUpdateEditingEntry)
                        .accessibilityIdentifier("homebase-update-entry-button")
                    }
                    Text("Disponibile solo online. Se la versione non coincide, ricarica il diario prima di riprovare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Label("Nuova voce online", systemImage: "square.and.pencil")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                TextField("Titolo (opzionale)", text: $model.newEntryTitle)
                    .accessibilityIdentifier("homebase-new-entry-title-field")
                Picker("Tipo", selection: $model.newEntryType) {
                    ForEach(PairedDiaryEntryType.allCases) { type in
                        Text(type.title).tag(type)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("homebase-new-entry-type-picker")
                TextEditor(text: $model.newEntryContent)
                    .frame(minHeight: 90)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(PlatformColors.separator, lineWidth: 1)
                    )
                    .accessibilityIdentifier("homebase-new-entry-content-field")
                Text("\(model.newEntryContent.count)/2000")
                    .font(.caption2)
                    .foregroundStyle(model.newEntryContent.count <= 2000 ? Color.secondary : Color.red)
                Button {
                    Task { await model.createEntryForSelectedPatient() }
                } label: {
                    Label("Salva voce", systemImage: "checkmark.circle")
                }
                .disabled(!model.canCreateEntry)
                .accessibilityIdentifier("homebase-create-entry-button")
                Text("Disponibile solo online: se il Mac non risponde, la voce non viene accodata.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /* @Codex */
    private var therapiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Terapie", systemImage: "pills")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime 20 terapie")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Task { await model.loadSelectedPatientTherapies() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .font(.caption)
                .disabled(model.isWorking || model.selectedPatient == nil)
                .accessibilityIdentifier("homebase-refresh-therapies-button")
            }

            if model.therapies.isEmpty {
                Text("Nessuna terapia caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(model.therapies), id: \.id) { therapy in
                    therapyRow(therapy)
                }
            }

            if model.isEditingTherapy {
                Divider()
                therapyForm(
                    title: "Modifica terapia online",
                    drugName: $model.editTherapyDrugName,
                    activePrinciple: $model.editTherapyActivePrinciple,
                    dosage: $model.editTherapyDosage,
                    motivation: $model.editTherapyMotivation,
                    status: $model.editTherapyStatus,
                    startDate: $model.editTherapyStartDate,
                    hasEndDate: $model.editTherapyHasEndDate,
                    endDate: $model.editTherapyEndDate,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-therapy-button",
                    canSubmit: model.canUpdateEditingTherapy,
                    onCancel: { model.cancelEditingTherapy() },
                    onSubmit: { Task { await model.updateEditingTherapy() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le terapie prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            therapyForm(
                title: "Nuova terapia online",
                drugName: $model.newTherapyDrugName,
                activePrinciple: $model.newTherapyActivePrinciple,
                dosage: $model.newTherapyDosage,
                motivation: $model.newTherapyMotivation,
                status: $model.newTherapyStatus,
                startDate: $model.newTherapyStartDate,
                hasEndDate: $model.newTherapyHasEndDate,
                endDate: $model.newTherapyEndDate,
                primaryLabel: "Salva terapia",
                primaryIdentifier: "homebase-create-therapy-button",
                canSubmit: model.canCreateTherapy,
                onCancel: nil,
                onSubmit: { Task { await model.createTherapyForSelectedPatient() } }
            )
            Text("Solo campi non-AI. Nessuna prescrizione SISS nativa o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private func therapyRow(_ therapy: HomeBaseTherapySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(therapy.drugName)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(PairedTherapyStatus(rawValue: therapy.status)?.title ?? therapy.status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(therapy.deletedAt == nil ? Color.secondary : Color.orange)
            }
            Text(therapy.dosage)
                .font(.caption)
                .foregroundStyle(therapy.deletedAt == nil ? .primary : .secondary)
                .lineLimit(2)
            if let activePrinciple = therapy.activePrinciple, !activePrinciple.isEmpty {
                Text(activePrinciple)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let motivation = therapy.motivation, !motivation.isEmpty {
                Text(motivation)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(Self.therapyDateLine(for: therapy))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if therapy.deletedAt != nil {
                Text("Terapia annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateTherapy(therapy) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingTherapy(therapy)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-therapy-button-\(therapy.id)")

                    Button(role: .destructive) {
                        therapyDeletionCandidateId = therapy.id
                        confirmsDeletingTherapy = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-therapy-button-\(therapy.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func therapyForm(
        title: String,
        drugName: Binding<String>,
        activePrinciple: Binding<String>,
        dosage: Binding<String>,
        motivation: Binding<String>,
        status: Binding<PairedTherapyStatus>,
        startDate: Binding<Date>,
        hasEndDate: Binding<Bool>,
        endDate: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "pills")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Farmaco", text: drugName)
                .accessibilityIdentifier("\(primaryIdentifier)-drug-name")
            TextField("Principio attivo (opzionale)", text: activePrinciple)
                .accessibilityIdentifier("\(primaryIdentifier)-active-principle")
            TextField("Posologia", text: dosage)
                .accessibilityIdentifier("\(primaryIdentifier)-dosage")
            TextField("Motivazione (opzionale)", text: motivation)
                .accessibilityIdentifier("\(primaryIdentifier)-motivation")
            Picker("Stato", selection: status) {
                ForEach(PairedTherapyStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Inizio", selection: startDate, displayedComponents: .date)
                .accessibilityIdentifier("\(primaryIdentifier)-start-date")
            Toggle("Fine terapia", isOn: hasEndDate)
                .accessibilityIdentifier("\(primaryIdentifier)-has-end-date")
            if hasEndDate.wrappedValue {
                DatePicker("Fine", selection: endDate, displayedComponents: .date)
                    .accessibilityIdentifier("\(primaryIdentifier)-end-date")
            }
            HStack(spacing: 8) {
                if let onCancel {
                    Button("Annulla") {
                        onCancel()
                    }
                    .font(.caption)
                }
                Button {
                    onSubmit()
                } label: {
                    Label(primaryLabel, systemImage: "checkmark.circle")
                }
                .font(.caption)
                .disabled(!canSubmit)
                .accessibilityIdentifier(primaryIdentifier)
            }
        }
    }

    /* @Codex */
    private var checkupsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Controlli",
                subtitle: "Ultimi 20 controlli",
                systemImage: "calendar.badge.clock",
                refreshIdentifier: "homebase-refresh-checkups-button"
            ) {
                Task { await model.loadSelectedPatientCheckups() }
            }

            if model.checkups.isEmpty {
                Text("Nessun controllo caricato.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.checkups) { checkup in
                    checkupRow(checkup)
                }
            }

            if model.isEditingCheckup {
                Divider()
                checkupForm(
                    title: "Modifica controllo online",
                    checkupTitle: $model.editCheckupTitle,
                    notes: $model.editCheckupNotes,
                    status: $model.editCheckupStatus,
                    date: $model.editCheckupDate,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-checkup-button",
                    canSubmit: model.canUpdateEditingCheckup,
                    onCancel: { model.cancelEditingCheckup() },
                    onSubmit: { Task { await model.updateEditingCheckup() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica i controlli prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            checkupForm(
                title: "Nuovo controllo online",
                checkupTitle: $model.newCheckupTitle,
                notes: $model.newCheckupNotes,
                status: $model.newCheckupStatus,
                date: $model.newCheckupDate,
                primaryLabel: "Salva controllo",
                primaryIdentifier: "homebase-create-checkup-button",
                canSubmit: model.canCreateCheckup,
                onCancel: nil,
                onSubmit: { Task { await model.createCheckupForSelectedPatient() } }
            )
            Text("Solo campi manuali non-AI. Nessuna coda offline o import documentale.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var observationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Osservazioni",
                subtitle: "Ultime 20 osservazioni",
                systemImage: "waveform.path.ecg",
                refreshIdentifier: "homebase-refresh-observations-button"
            ) {
                Task { await model.loadSelectedPatientObservations() }
            }

            if model.observations.isEmpty {
                Text("Nessuna osservazione caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.observations) { observation in
                    observationRow(observation)
                }
            }

            if model.isEditingObservation {
                Divider()
                observationForm(
                    title: "Modifica osservazione online",
                    display: $model.editObservationDisplay,
                    code: $model.editObservationCode,
                    value: $model.editObservationValue,
                    unitCode: $model.editObservationUnitCode,
                    notes: $model.editObservationNotes,
                    observedAt: $model.editObservationObservedAt,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-observation-button",
                    canSubmit: model.canUpdateEditingObservation,
                    onCancel: { model.cancelEditingObservation() },
                    onSubmit: { Task { await model.updateEditingObservation() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le osservazioni prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            observationForm(
                title: "Nuova osservazione online",
                display: $model.newObservationDisplay,
                code: $model.newObservationCode,
                value: $model.newObservationValue,
                unitCode: $model.newObservationUnitCode,
                notes: $model.newObservationNotes,
                observedAt: $model.newObservationObservedAt,
                primaryLabel: "Salva osservazione",
                primaryIdentifier: "homebase-create-observation-button",
                canSubmit: model.canCreateObservation,
                onCancel: nil,
                onSubmit: { Task { await model.createObservationForSelectedPatient() } }
            )
            Text("LOINC + UCUM manuali. Nessun AI plane remoto, OCR o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private func pairedSectionHeader(
        title: String,
        subtitle: String,
        systemImage: String,
        refreshIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Label(title, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button(action: action) {
                Label("Aggiorna", systemImage: "arrow.clockwise")
            }
            .font(.caption)
            .disabled(model.isWorking || model.selectedPatient == nil)
            .accessibilityIdentifier(refreshIdentifier)
        }
    }

    /* @Codex */
    private func checkupRow(_ checkup: HomeBaseCheckupSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(checkup.title)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(PairedCheckupStatus(rawValue: checkup.status)?.title ?? checkup.status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(checkup.deletedAt == nil ? Color.secondary : Color.orange)
            }
            Text(Self.entryDateFormatter.string(from: checkup.date))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let notes = checkup.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(checkup.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if checkup.deletedAt != nil {
                Text("Controllo annullato")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateCheckup(checkup) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingCheckup(checkup)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-checkup-button-\(checkup.id)")

                    Button(role: .destructive) {
                        checkupDeletionCandidateId = checkup.id
                        confirmsDeletingCheckup = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-checkup-button-\(checkup.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func observationRow(_ observation: HomeBaseObservationSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(observation.display)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text("\(observation.value) \(observation.unitCode)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(observation.deletedAt == nil ? Color.primary : Color.secondary)
            }
            Text("\(observation.codeSystem) \(observation.code) - \(Self.entryDateFormatter.string(from: observation.observedAt))")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let notes = observation.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(observation.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if observation.deletedAt != nil {
                Text("Osservazione annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateObservation(observation) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingObservation(observation)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-observation-button-\(observation.id)")

                    Button(role: .destructive) {
                        observationDeletionCandidateId = observation.id
                        confirmsDeletingObservation = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-observation-button-\(observation.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func checkupForm(
        title: String,
        checkupTitle: Binding<String>,
        notes: Binding<String>,
        status: Binding<PairedCheckupStatus>,
        date: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "calendar.badge.clock")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Titolo", text: checkupTitle)
                .accessibilityIdentifier("\(primaryIdentifier)-title")
            Picker("Stato", selection: status) {
                ForEach(PairedCheckupStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Data", selection: date, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-date")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            pairedFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    private func observationForm(
        title: String,
        display: Binding<String>,
        code: Binding<String>,
        value: Binding<String>,
        unitCode: Binding<String>,
        notes: Binding<String>,
        observedAt: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "waveform.path.ecg")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Parametro LOINC", text: display)
                .accessibilityIdentifier("\(primaryIdentifier)-display")
            TextField("Codice LOINC", text: code)
                .accessibilityIdentifier("\(primaryIdentifier)-code")
            HStack(spacing: 8) {
                TextField("Valore", text: value)
                    .accessibilityIdentifier("\(primaryIdentifier)-value")
                TextField("Unita UCUM", text: unitCode)
                    .accessibilityIdentifier("\(primaryIdentifier)-unit-code")
            }
            DatePicker("Rilevata", selection: observedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-observed-at")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            pairedFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    private func pairedFormButtons(
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            if let onCancel {
                Button("Annulla") {
                    onCancel()
                }
                .font(.caption)
            }
            Button {
                onSubmit()
            } label: {
                Label(primaryLabel, systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!canSubmit)
            .accessibilityIdentifier(primaryIdentifier)
        }
    }

    private static let entryDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    /* @Codex */
    private static let therapyDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter
    }()

    /* @Codex */
    private static func therapyDateLine(for therapy: HomeBaseTherapySummary) -> String {
        let start = therapyDayFormatter.string(from: therapy.startDate)
        guard let endDate = therapy.endDate else { return "Dal \(start)" }
        return "Dal \(start) al \(therapyDayFormatter.string(from: endDate))"
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
    @Published private(set) var entries: [HomeBaseEntrySummary] = []
    @Published private(set) var therapies: [HomeBaseTherapySummary] = []
    @Published private(set) var checkups: [HomeBaseCheckupSummary] = []
    @Published private(set) var observations: [HomeBaseObservationSummary] = []
    @Published var newEntryTitle = ""
    @Published var newEntryType: PairedDiaryEntryType = .note
    @Published var newEntryContent = ""
    @Published private(set) var editingEntryId: String?
    @Published private(set) var editingEntryVersion: Int?
    @Published var editEntryTitle = ""
    @Published var editEntryType: PairedDiaryEntryType = .note
    @Published var editEntryContent = ""
    @Published var newTherapyDrugName = ""
    @Published var newTherapyActivePrinciple = ""
    @Published var newTherapyDosage = ""
    @Published var newTherapyMotivation = ""
    @Published var newTherapyStatus: PairedTherapyStatus = .active
    @Published var newTherapyStartDate = Date()
    @Published var newTherapyHasEndDate = false
    @Published var newTherapyEndDate = Date()
    @Published private(set) var editingTherapyId: String?
    @Published private(set) var editingTherapyVersion: Int?
    @Published var editTherapyDrugName = ""
    @Published var editTherapyActivePrinciple = ""
    @Published var editTherapyDosage = ""
    @Published var editTherapyMotivation = ""
    @Published var editTherapyStatus: PairedTherapyStatus = .active
    @Published var editTherapyStartDate = Date()
    @Published var editTherapyHasEndDate = false
    @Published var editTherapyEndDate = Date()
    @Published var newCheckupTitle = ""
    @Published var newCheckupNotes = ""
    @Published var newCheckupStatus: PairedCheckupStatus = .pending
    @Published var newCheckupDate = Date()
    @Published private(set) var editingCheckupId: String?
    @Published private(set) var editingCheckupVersion: Int?
    @Published var editCheckupTitle = ""
    @Published var editCheckupNotes = ""
    @Published var editCheckupStatus: PairedCheckupStatus = .pending
    @Published var editCheckupDate = Date()
    @Published var newObservationDisplay = ""
    @Published var newObservationCode = ""
    @Published var newObservationValue = ""
    @Published var newObservationUnitCode = ""
    @Published var newObservationNotes = ""
    @Published var newObservationObservedAt = Date()
    @Published private(set) var editingObservationId: String?
    @Published private(set) var editingObservationVersion: Int?
    @Published var editObservationDisplay = ""
    @Published var editObservationCode = ""
    @Published var editObservationValue = ""
    @Published var editObservationUnitCode = ""
    @Published var editObservationNotes = ""
    @Published var editObservationObservedAt = Date()
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
    private var newEntryDraftId = UUID().uuidString

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
            self.entries = []
            self.therapies = []
            self.checkups = []
            self.observations = []
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
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
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patient.id,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingEntry()
            self.cancelEditingTherapy()
            self.cancelEditingCheckup()
            self.cancelEditingObservation()
            self.statusMessage = "Dettaglio \(patient.lastName) aperto in sola lettura."
        }
    }

    /* @Codex */
    func loadSelectedPatientEntries() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingEntry()
            self.statusMessage = "\(self.entries.count) voci diario caricate."
        }
    }

    /* @Codex */
    func createEntryForSelectedPatient() async {
        guard canCreateEntry else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = newEntryTitle.trimmedOrNil
        let type = newEntryType.rawValue
        let content = newEntryContent.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            _ = try await self.makeClient().createEntry(
                patientId: patientId,
                payload: HomeBaseEntryCreatePayload(
                    id: self.newEntryDraftId,
                    type: type,
                    title: title,
                    date: Date(),
                    content: content
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.newEntryTitle = ""
            self.newEntryType = .note
            self.newEntryContent = ""
            self.newEntryDraftId = UUID().uuidString
            self.statusMessage = "Voce diario inviata all'home-base."
            do {
                self.entries = try await self.makeClient().fetchEntries(
                    patientId: patientId,
                    credentials: credentials,
                    sessionCookie: sessionCookie,
                    ambulatoryId: self.ambulatoryId.trimmedOrNil
                )
            } catch {
                self.errorMessage = "Voce inviata, ma aggiornamento diario non riuscito: \(error.localizedDescription)"
            }
        }
    }

    /* @Codex */
    func startEditingEntry(_ entry: HomeBaseEntrySummary) {
        guard canMutateEntry(entry) else { return }
        editingEntryId = entry.id
        editingEntryVersion = entry.version
        editEntryTitle = entry.title
        editEntryType = PairedDiaryEntryType(rawValue: entry.type) ?? .note
        editEntryContent = entry.content
        statusMessage = "Modifica voce diario pronta."
    }

    /* @Codex */
    func cancelEditingEntry() {
        editingEntryId = nil
        editingEntryVersion = nil
        editEntryTitle = ""
        editEntryType = .note
        editEntryContent = ""
    }

    /* @Codex */
    func updateEditingEntry() async {
        guard canUpdateEditingEntry else { return }
        guard let patientId = selectedPatient?.id,
              let entryId = editingEntryId,
              let version = editingEntryVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = editEntryTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let content = editEntryContent.trimmingCharacters(in: .whitespacesAndNewlines)
        let type = editEntryType.rawValue
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entryId,
                payload: HomeBaseEntryUpdatePayload(
                    version: version,
                    type: type,
                    title: title,
                    content: content
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingEntry()
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteEntry(id entryId: String) async {
        guard let entry = entries.first(where: { $0.id == entryId }),
              canMutateEntry(entry) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateEntry(
                patientId: patientId,
                entryId: entry.id,
                payload: HomeBaseEntryUpdatePayload(
                    version: entry.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingEntryId == entry.id {
                self.cancelEditingEntry()
            }
            self.entries = try await self.makeClient().fetchEntries(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Voce diario annullata sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientTherapies() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingTherapy()
            self.statusMessage = "\(self.therapies.count) terapie caricate."
        }
    }

    /* @Codex */
    func createTherapyForSelectedPatient() async {
        guard canCreateTherapy else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let drugName = newTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let activePrinciple = newTherapyActivePrinciple.trimmedOrNil
        let dosage = newTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = newTherapyMotivation.trimmedOrNil
        let endDate = newTherapyHasEndDate ? newTherapyEndDate : nil
        await runTask {
            _ = try await self.makeClient().createTherapy(
                patientId: patientId,
                payload: HomeBaseTherapyCreatePayload(
                    drugName: drugName,
                    activePrinciple: activePrinciple,
                    dosage: dosage,
                    status: self.newTherapyStatus.rawValue,
                    startDate: self.newTherapyStartDate,
                    endDate: endDate,
                    motivation: motivation
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewTherapyForm()
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia inviata all'home-base."
        }
    }

    /* @Codex */
    func startEditingTherapy(_ therapy: HomeBaseTherapySummary) {
        guard canMutateTherapy(therapy) else { return }
        editingTherapyId = therapy.id
        editingTherapyVersion = therapy.version
        editTherapyDrugName = therapy.drugName
        editTherapyActivePrinciple = therapy.activePrinciple ?? ""
        editTherapyDosage = therapy.dosage
        editTherapyMotivation = therapy.motivation ?? ""
        editTherapyStatus = PairedTherapyStatus(rawValue: therapy.status) ?? .active
        editTherapyStartDate = therapy.startDate
        editTherapyHasEndDate = therapy.endDate != nil
        editTherapyEndDate = therapy.endDate ?? Date()
        statusMessage = "Modifica terapia pronta."
    }

    /* @Codex */
    func cancelEditingTherapy() {
        editingTherapyId = nil
        editingTherapyVersion = nil
        editTherapyDrugName = ""
        editTherapyActivePrinciple = ""
        editTherapyDosage = ""
        editTherapyMotivation = ""
        editTherapyStatus = .active
        editTherapyStartDate = Date()
        editTherapyHasEndDate = false
        editTherapyEndDate = Date()
    }

    /* @Codex */
    func updateEditingTherapy() async {
        guard canUpdateEditingTherapy else { return }
        guard let patientId = selectedPatient?.id,
              let therapyId = editingTherapyId,
              let version = editingTherapyVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let drugName = editTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let activePrinciple = editTherapyActivePrinciple.trimmingCharacters(in: .whitespacesAndNewlines)
        let dosage = editTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines)
        let motivation = editTherapyMotivation.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateTherapy(
                patientId: patientId,
                therapyId: therapyId,
                payload: HomeBaseTherapyUpdatePayload(
                    version: version,
                    drugName: drugName,
                    activePrinciple: activePrinciple,
                    dosage: dosage,
                    status: self.editTherapyStatus.rawValue,
                    startDate: self.editTherapyStartDate,
                    endDate: self.editTherapyHasEndDate ? self.editTherapyEndDate : nil,
                    shouldEncodeEndDate: true,
                    motivation: motivation
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingTherapy()
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteTherapy(id therapyId: String) async {
        guard let therapy = therapies.first(where: { $0.id == therapyId }),
              canMutateTherapy(therapy) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateTherapy(
                patientId: patientId,
                therapyId: therapy.id,
                payload: HomeBaseTherapyUpdatePayload(
                    version: therapy.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingTherapyId == therapy.id {
                self.cancelEditingTherapy()
            }
            self.therapies = try await self.makeClient().fetchTherapies(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Terapia annullata sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientCheckups() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingCheckup()
            self.statusMessage = "\(self.checkups.count) controlli caricati."
        }
    }

    /* @Codex */
    func createCheckupForSelectedPatient() async {
        guard canCreateCheckup else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = newCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = newCheckupNotes.trimmedOrNil
        await runTask {
            _ = try await self.makeClient().createCheckup(
                patientId: patientId,
                payload: HomeBaseCheckupCreatePayload(
                    date: self.newCheckupDate,
                    title: title,
                    status: self.newCheckupStatus.rawValue,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewCheckupForm()
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo inviato all'home-base."
        }
    }

    /* @Codex */
    func startEditingCheckup(_ checkup: HomeBaseCheckupSummary) {
        guard canMutateCheckup(checkup) else { return }
        editingCheckupId = checkup.id
        editingCheckupVersion = checkup.version
        editCheckupTitle = checkup.title
        editCheckupNotes = checkup.notes ?? ""
        editCheckupStatus = PairedCheckupStatus(rawValue: checkup.status) ?? .pending
        editCheckupDate = checkup.date
        statusMessage = "Modifica controllo pronta."
    }

    /* @Codex */
    func cancelEditingCheckup() {
        editingCheckupId = nil
        editingCheckupVersion = nil
        editCheckupTitle = ""
        editCheckupNotes = ""
        editCheckupStatus = .pending
        editCheckupDate = Date()
    }

    /* @Codex */
    func updateEditingCheckup() async {
        guard canUpdateEditingCheckup else { return }
        guard let patientId = selectedPatient?.id,
              let checkupId = editingCheckupId,
              let version = editingCheckupVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let title = editCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = editCheckupNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateCheckup(
                patientId: patientId,
                checkupId: checkupId,
                payload: HomeBaseCheckupUpdatePayload(
                    version: version,
                    date: self.editCheckupDate,
                    title: title,
                    status: self.editCheckupStatus.rawValue,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingCheckup()
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo aggiornato sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteCheckup(id checkupId: String) async {
        guard let checkup = checkups.first(where: { $0.id == checkupId }),
              canMutateCheckup(checkup) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateCheckup(
                patientId: patientId,
                checkupId: checkup.id,
                payload: HomeBaseCheckupUpdatePayload(
                    version: checkup.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingCheckupId == checkup.id {
                self.cancelEditingCheckup()
            }
            self.checkups = try await self.makeClient().fetchCheckups(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Controllo annullato sull'home-base."
        }
    }

    /* @Codex */
    func loadSelectedPatientObservations() async {
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.cancelEditingObservation()
            self.statusMessage = "\(self.observations.count) osservazioni caricate."
        }
    }

    /* @Codex */
    func createObservationForSelectedPatient() async {
        guard canCreateObservation else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let display = newObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = newObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = newObservationValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let unitCode = newObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = newObservationNotes.trimmedOrNil
        await runTask {
            _ = try await self.makeClient().createObservation(
                patientId: patientId,
                payload: HomeBaseObservationCreatePayload(
                    code: code,
                    display: display,
                    unitCode: unitCode,
                    value: value,
                    observedAt: self.newObservationObservedAt,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.resetNewObservationForm()
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione inviata all'home-base."
        }
    }

    /* @Codex */
    func startEditingObservation(_ observation: HomeBaseObservationSummary) {
        guard canMutateObservation(observation) else { return }
        editingObservationId = observation.id
        editingObservationVersion = observation.version
        editObservationDisplay = observation.display
        editObservationCode = observation.code
        editObservationValue = observation.value
        editObservationUnitCode = observation.unitCode
        editObservationNotes = observation.notes ?? ""
        editObservationObservedAt = observation.observedAt
        statusMessage = "Modifica osservazione pronta."
    }

    /* @Codex */
    func cancelEditingObservation() {
        editingObservationId = nil
        editingObservationVersion = nil
        editObservationDisplay = ""
        editObservationCode = ""
        editObservationValue = ""
        editObservationUnitCode = ""
        editObservationNotes = ""
        editObservationObservedAt = Date()
    }

    /* @Codex */
    func updateEditingObservation() async {
        guard canUpdateEditingObservation else { return }
        guard let patientId = selectedPatient?.id,
              let observationId = editingObservationId,
              let version = editingObservationVersion,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        let display = editObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines)
        let code = editObservationCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let value = editObservationValue.trimmingCharacters(in: .whitespacesAndNewlines)
        let unitCode = editObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines)
        let notes = editObservationNotes.trimmingCharacters(in: .whitespacesAndNewlines)
        await runTask {
            let acknowledgement = try await self.makeClient().updateObservation(
                patientId: patientId,
                observationId: observationId,
                payload: HomeBaseObservationUpdatePayload(
                    version: version,
                    code: code,
                    display: display,
                    unitCode: unitCode,
                    value: value,
                    observedAt: self.editObservationObservedAt,
                    notes: notes
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            self.cancelEditingObservation()
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione aggiornata sull'home-base."
        }
    }

    /* @Codex */
    func softDeleteObservation(id observationId: String) async {
        guard let observation = observations.first(where: { $0.id == observationId }),
              canMutateObservation(observation) else { return }
        guard let patientId = selectedPatient?.id,
              let sessionCookie,
              let credentials = pairedCredentials else {
            errorMessage = "Apri prima un paziente con sessione paired online."
            return
        }
        await runTask {
            let acknowledgement = try await self.makeClient().updateObservation(
                patientId: patientId,
                observationId: observation.id,
                payload: HomeBaseObservationUpdatePayload(
                    version: observation.version,
                    deletedAt: Date(),
                    deletionReason: "mobile-paired-operator-cancelled"
                ),
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            if self.editingObservationId == observation.id {
                self.cancelEditingObservation()
            }
            self.observations = try await self.makeClient().fetchObservations(
                patientId: patientId,
                credentials: credentials,
                sessionCookie: sessionCookie,
                ambulatoryId: self.ambulatoryId.trimmedOrNil
            )
            self.statusMessage = "Osservazione annullata sull'home-base."
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
            entries = []
            therapies = []
            checkups = []
            observations = []
            newEntryTitle = ""
            newEntryType = .note
            newEntryContent = ""
            newEntryDraftId = UUID().uuidString
            cancelEditingEntry()
            resetNewTherapyForm()
            cancelEditingTherapy()
            resetNewCheckupForm()
            cancelEditingCheckup()
            resetNewObservationForm()
            cancelEditingObservation()
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
            entries = []
            therapies = []
            checkups = []
            observations = []
            cancelEditingEntry()
            cancelEditingTherapy()
            cancelEditingCheckup()
            cancelEditingObservation()
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
            if case HomeBaseClientError.httpStatus(let status, _) = error,
               status == 401 {
                connectionState = .sessionExpired
                sessionCookie = nil
                statusMessage = "Sessione operatore scaduta. Accedi di nuovo per scrivere sul Mac."
            } else if case HomeBaseClientError.httpStatus(let status, _) = error,
                      status == 403 {
                statusMessage = "Operazione non autorizzata nello scope paired corrente."
            } else if case HomeBaseClientError.httpStatus(let status, _) = error,
                      status == 409 {
                statusMessage = "Conflitto versione: ricarica il modulo e confronta la voce prima di salvare."
                errorMessage = nil
                return
            }
            errorMessage = error.localizedDescription
        }
    }

    /* @Codex */
    private func resetNewTherapyForm() {
        newTherapyDrugName = ""
        newTherapyActivePrinciple = ""
        newTherapyDosage = ""
        newTherapyMotivation = ""
        newTherapyStatus = .active
        newTherapyStartDate = Date()
        newTherapyHasEndDate = false
        newTherapyEndDate = Date()
    }

    /* @Codex */
    private func resetNewCheckupForm() {
        newCheckupTitle = ""
        newCheckupNotes = ""
        newCheckupStatus = .pending
        newCheckupDate = Date()
    }

    /* @Codex */
    private func resetNewObservationForm() {
        newObservationDisplay = ""
        newObservationCode = ""
        newObservationValue = ""
        newObservationUnitCode = ""
        newObservationNotes = ""
        newObservationObservedAt = Date()
    }

    /* @Codex */
    var isEditingEntry: Bool {
        editingEntryId != nil
    }

    var canCreateEntry: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newEntryContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && newEntryContent.count <= 2000
            && !isWorking
    }

    /* @Codex */
    var isEditingTherapy: Bool {
        editingTherapyId != nil
    }

    /* @Codex */
    var canCreateTherapy: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingTherapy: Bool {
        editingTherapyId != nil
            && editingTherapyVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editTherapyDrugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editTherapyDosage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingEntry: Bool {
        editingEntryId != nil
            && editingEntryVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editEntryTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editEntryContent.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && editEntryContent.count <= 2000
            && !isWorking
    }

    /* @Codex */
    var isEditingCheckup: Bool {
        editingCheckupId != nil
    }

    /* @Codex */
    var canCreateCheckup: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingCheckup: Bool {
        editingCheckupId != nil
            && editingCheckupVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editCheckupTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var isEditingObservation: Bool {
        editingObservationId != nil
    }

    /* @Codex */
    var canCreateObservation: Bool {
        selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !newObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !newObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    var canUpdateEditingObservation: Bool {
        editingObservationId != nil
            && editingObservationVersion != nil
            && selectedPatient != nil
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !editObservationDisplay.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !editObservationUnitCode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !isWorking
    }

    /* @Codex */
    func canMutateEntry(_ entry: HomeBaseEntrySummary) -> Bool {
        entry.deletedAt == nil
            && selectedPatient?.id == entry.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateTherapy(_ therapy: HomeBaseTherapySummary) -> Bool {
        therapy.deletedAt == nil
            && selectedPatient?.id == therapy.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateCheckup(_ checkup: HomeBaseCheckupSummary) -> Bool {
        checkup.deletedAt == nil
            && selectedPatient?.id == checkup.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }

    /* @Codex */
    func canMutateObservation(_ observation: HomeBaseObservationSummary) -> Bool {
        observation.deletedAt == nil
            && selectedPatient?.id == observation.patientId
            && sessionCookie != nil
            && pairedCredentials != nil
            && connectionState == .pairedOnline
            && !isWorking
    }
}

/* @Codex */
private enum PairedDiaryEntryType: String, CaseIterable, Identifiable {
    case note
    case visit
    case phone
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .note:
            return "Nota"
        case .visit:
            return "Visita"
        case .phone:
            return "Telefono"
        case .other:
            return "Altro"
        }
    }
}

/* @Codex */
private enum PairedTherapyStatus: String, CaseIterable, Identifiable {
    case active
    case suspended
    case completed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .active:
            return "Attiva"
        case .suspended:
            return "Sospesa"
        case .completed:
            return "Conclusa"
        }
    }
}

/* @Codex */
private enum PairedCheckupStatus: String, CaseIterable, Identifiable {
    case pending
    case completed
    case cancelled

    var id: String { rawValue }

    var title: String {
        switch self {
        case .pending:
            return "Da fare"
        case .completed:
            return "Completato"
        case .cancelled:
            return "Annullato"
        }
    }
}

private enum PairedPatientsConnectionState {
    case notLoaded
    case cached
    case pairedOnline
    case pairedOfflineDegraded
    case sessionExpired

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
        case .sessionExpired:
            return "Sessione scaduta"
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
        case .sessionExpired:
            return "person.crop.circle.badge.exclamationmark"
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
        case .sessionExpired:
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

    static var separator: Color {
        #if os(macOS)
        return Color(nsColor: .separatorColor)
        #else
        return Color(uiColor: .separator)
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
