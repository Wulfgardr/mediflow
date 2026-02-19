// Codex: created 2026-02-01
import SwiftUI

struct ContentView: View {
    private enum PatientViewMode: String, CaseIterable {
        case active
        case archived
    }

    private enum PatientSortMode: String, CaseIterable {
        case recent
        case alpha
    }

    @StateObject private var viewModel = PatientsViewModel()
    @StateObject private var settings = SettingsStore.shared
    @EnvironmentObject private var security: SecuritySession
    @State private var selectedPatientId: PatientSummary.ID?
    @State private var showingSettings = false
    @State private var showingNewPatient = false
    /* @Codex */
    @State private var patientSearchQuery = ""
    /* @Codex */
    @State private var patientViewMode: PatientViewMode = .active
    /* @Codex */
    @State private var patientSortMode: PatientSortMode = .recent

    var body: some View {
        Group {
            if security.isUnlocked {
                NavigationSplitView {
                    List(selection: $selectedPatientId) {
                        Section("Ambulatorio") {
                            if viewModel.isLoadingAmbulatories {
                                ProgressView("Caricamento ambulatori...")
                            }

                            Picker("Ambulatorio", selection: $viewModel.selectedAmbulatoryId) {
                                Text("Tutti").tag(String?.none)
                                ForEach(viewModel.ambulatories) { ambulatory in
                                    Text(label(for: ambulatory))
                                        .tag(Optional(ambulatory.id))
                                }
                            }
                            .labelsHidden()

                            if let message = viewModel.ambulatoriesErrorMessage {
                                Text(message)
                                    .font(.caption)
                                    .foregroundStyle(.red)
                            }
                        }

                        Section("Pazienti") {
                            /* @Codex */
                            VStack(alignment: .leading, spacing: 8) {
                                Picker("Stato pazienti", selection: $patientViewMode) {
                                    Text("Attivi").tag(PatientViewMode.active)
                                    Text("Archiviati").tag(PatientViewMode.archived)
                                }
                                .pickerStyle(.segmented)

                                HStack(spacing: 10) {
                                    TextField("Cerca nome, cognome o CF", text: $patientSearchQuery)
                                        .textFieldStyle(.roundedBorder)

                                    Picker("Ordina", selection: $patientSortMode) {
                                        Text("Recenti").tag(PatientSortMode.recent)
                                        Text("A-Z").tag(PatientSortMode.alpha)
                                    }
                                    .pickerStyle(.menu)
                                }
                            }

                            if viewModel.isLoadingPatients {
                                ProgressView("Caricamento...")
                            }

                            /* @Codex */
                            if !viewModel.isLoadingPatients && filteredPatients.isEmpty {
                                Text("Nessun paziente corrispondente ai filtri.")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }

                            /* @Codex */
                            ForEach(filteredPatients) { patient in
                                HStack(alignment: .top, spacing: 12) {
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text("\(patient.lastName) \(patient.firstName)")
                                            .font(.headline)

                                        HStack(spacing: 6) {
                                            Text(birthLine(for: patient))
                                            if let updatedAt = patient.updatedAt {
                                                Text("• Agg. \(relativeUpdate(from: updatedAt))")
                                                    .foregroundStyle(updateTone(for: updatedAt))
                                            }
                                        }
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    HStack(spacing: 6) {
                                        if patient.isAdi == true {
                                            TagView(text: "ADI", tone: .accentColor)
                                        }
                                        if patient.isArchived == true {
                                            TagView(text: "Archiviato", tone: .orange)
                                        }
                                    }
                                }
                                .opacity(patient.isArchived == true ? 0.6 : 1)
                            }
                        }
                    }
                    .navigationTitle("MediFlow")
                    .listStyle(.sidebar)
                    .toolbar {
                        Button("Nuovo paziente") {
                            showingNewPatient = true
                        }
                        Button("Ricarica") {
                            Task { await viewModel.loadInitial() }
                        }
                        Button("Impostazioni") {
                            showingSettings = true
                        }
                    }
                    .overlay(alignment: .bottom) {
                        if let errorMessage = viewModel.errorMessage {
                            Text(errorMessage)
                                .font(.caption)
                                .foregroundStyle(.red)
                                .padding(8)
                        }
                    }
                } detail: {
                    if let patientId = selectedPatientId {
                        PatientDetailView(patientId: patientId)
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "person")
                                .font(.largeTitle)
                                .foregroundStyle(.secondary)
                            Text("Seleziona un paziente")
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            } else {
                LockScreenView()
            }
        }
        .sheet(isPresented: $showingSettings) {
            GlassPanelWindow(
                title: "Impostazioni MediFlow",
                subtitle: "Configurazione app, AI stack e diagnostica",
                minSize: CGSize(width: 980, height: 700),
                expandedSize: CGSize(width: 1220, height: 860)
            ) {
                SettingsView(settings: settings)
                    .environmentObject(security)
            }
        }
        .sheet(isPresented: $showingNewPatient) {
            GlassPanelWindow(
                title: "Nuovo paziente",
                subtitle: "Scheda anagrafica e contatti",
                minSize: CGSize(width: 620, height: 640),
                expandedSize: CGSize(width: 760, height: 820)
            ) {
                NewPatientView(ambulatoryId: viewModel.selectedAmbulatoryId) {
                    Task { await viewModel.loadInitial() }
                }
                .environmentObject(security)
            }
        }
        .task {
            if security.isUnlocked {
                await viewModel.loadInitial()
            }
        }
        .onChange(of: security.isUnlocked) { unlocked in
            if unlocked {
                Task { await viewModel.loadInitial() }
            }
        }
        /* @Codex */
        .onChange(of: patientSearchQuery) { _ in
            syncSelectedPatientIfHidden()
        }
        /* @Codex */
        .onChange(of: patientViewMode) { _ in
            syncSelectedPatientIfHidden()
        }
        /* @Codex */
        .onChange(of: patientSortMode) { _ in
            syncSelectedPatientIfHidden()
        }
        .onChange(of: viewModel.selectedAmbulatoryId) { _ in
            selectedPatientId = nil
            Task { await viewModel.loadPatients() }
        }
    }

    /* @Codex */
    private var filteredPatients: [PatientSummary] {
        let query = patientSearchQuery
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
        let terms = query.split(whereSeparator: { $0.isWhitespace }).map(String.init)

        let statusFiltered = viewModel.patients.filter { patient in
            switch patientViewMode {
            case .active:
                return patient.isArchived != true
            case .archived:
                return patient.isArchived == true
            }
        }

        let searchFiltered = statusFiltered.filter { patient in
            guard !terms.isEmpty else { return true }
            let searchableText = "\(patient.lastName) \(patient.firstName) \(patient.taxCode)".lowercased()
            return terms.allSatisfy { searchableText.contains($0) }
        }

        switch patientSortMode {
        case .alpha:
            return searchFiltered.sorted { lhs, rhs in
                let lastNameOrder = lhs.lastName.localizedCaseInsensitiveCompare(rhs.lastName)
                if lastNameOrder != .orderedSame { return lastNameOrder == .orderedAscending }
                let firstNameOrder = lhs.firstName.localizedCaseInsensitiveCompare(rhs.firstName)
                if firstNameOrder != .orderedSame { return firstNameOrder == .orderedAscending }
                return lhs.taxCode.localizedCaseInsensitiveCompare(rhs.taxCode) == .orderedAscending
            }
        case .recent:
            return searchFiltered.sorted { lhs, rhs in
                let lhsDate = lhs.updatedAt ?? Date.distantPast
                let rhsDate = rhs.updatedAt ?? Date.distantPast
                if lhsDate != rhsDate { return lhsDate > rhsDate }
                let lastNameOrder = lhs.lastName.localizedCaseInsensitiveCompare(rhs.lastName)
                if lastNameOrder != .orderedSame { return lastNameOrder == .orderedAscending }
                return lhs.firstName.localizedCaseInsensitiveCompare(rhs.firstName) == .orderedAscending
            }
        }
    }

    /* @Codex */
    private func syncSelectedPatientIfHidden() {
        guard let selectedPatientId else { return }
        if !filteredPatients.contains(where: { $0.id == selectedPatientId }) {
            self.selectedPatientId = nil
        }
    }

    private func label(for ambulatory: AmbulatorySummary) -> String {
        if ambulatory.isDefault == true {
            return "\(ambulatory.name) (default)"
        }
        return ambulatory.name
    }

    private func birthLine(for patient: PatientSummary) -> String {
        guard let birthDate = patient.birthDate else { return "Data di nascita n/d" }
        let years = Calendar.current.dateComponents([.year], from: birthDate, to: Date()).year ?? 0
        let safeYears = max(years, 0)
        return "\(Self.dateFormatter.string(from: birthDate)) • \(safeYears)a"
    }

    private func relativeUpdate(from date: Date) -> String {
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        if days < 0 { return "oggi" }
        if days <= 0 { return "oggi" }
        if days == 1 { return "1g fa" }
        return "\(days)g fa"
    }

    private func updateTone(for date: Date) -> Color {
        let days = Calendar.current.dateComponents([.day], from: date, to: Date()).day ?? 0
        if days < 0 { return .secondary }
        if days >= 180 { return .red }
        if days >= 90 { return .orange }
        return .secondary
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()
}

@MainActor
final class PatientsViewModel: ObservableObject {
    @Published var patients: [PatientSummary] = []
    @Published var ambulatories: [AmbulatorySummary] = []
    @Published var selectedAmbulatoryId: String? {
        didSet {
            LocalAPISettings.saveSelectedAmbulatoryId(selectedAmbulatoryId)
        }
    }
    @Published var isLoadingPatients = false
    @Published var isLoadingAmbulatories = false
    @Published var errorMessage: String?
    @Published var ambulatoriesErrorMessage: String?

    init() {
        self.selectedAmbulatoryId = LocalAPISettings.loadSelectedAmbulatoryId()
    }

    func loadInitial() async {
        await loadAmbulatories()
        await loadPatients()
    }

    func loadAmbulatories() async {
        if isLoadingAmbulatories { return }
        isLoadingAmbulatories = true
        defer { isLoadingAmbulatories = false }

        do {
            let result = try await LocalAPIClient.shared.fetchAmbulatories()
            ambulatories = result
            ambulatoriesErrorMessage = nil

            if let selectedAmbulatoryId, result.contains(where: { $0.id == selectedAmbulatoryId }) {
                return
            }

            if let defaultAmbulatory = result.first(where: { $0.isDefault == true }) {
                selectedAmbulatoryId = defaultAmbulatory.id
            } else {
                selectedAmbulatoryId = nil
            }
        } catch {
            if let localError = error as? LocalAPIError {
                ambulatoriesErrorMessage = localError.localizedDescription
            } else {
                ambulatoriesErrorMessage = "Impossibile caricare gli ambulatori."
            }
        }
    }

    func loadPatients() async {
        if isLoadingPatients { return }
        isLoadingPatients = true
        defer { isLoadingPatients = false }

        do {
            let result = try await LocalAPIClient.shared.fetchPatients(ambulatoryId: selectedAmbulatoryId)
            patients = result
            errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                errorMessage = localError.localizedDescription
            } else {
                errorMessage = "Impossibile caricare i pazienti."
            }
        }
    }
}
