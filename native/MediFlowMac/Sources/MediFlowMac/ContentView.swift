// Codex: created 2026-02-01
import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = PatientsViewModel()
    @StateObject private var settings = SettingsStore.shared
    @EnvironmentObject private var security: SecuritySession
    @State private var selectedPatientId: PatientSummary.ID?
    @State private var showingSettings = false
    @State private var showingNewPatient = false
    /* @Codex */
    @State private var patientSearchQuery = ""
    /* @Codex */
    @State private var patientViewMode: PatientListViewMode = .active
    /* @Codex */
    @State private var patientSortMode: PatientListSortMode = .recent
    /* @Codex */
    @State private var editingPatient: PatientDetail?
    /* @Codex */
    @State private var pendingDeletePatient: PatientSummary?
    /* @Codex */
    @State private var isLoadingPatientEditor = false

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
                            .accessibilityIdentifier("patients-ambulatory-picker")

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
                                    Text("Attivi").tag(PatientListViewMode.active)
                                    Text("Archiviati").tag(PatientListViewMode.archived)
                                }
                                .pickerStyle(.segmented)
                                .accessibilityIdentifier("patients-status-filter")

                                HStack(spacing: 10) {
                                    TextField("Cerca nome, cognome o CF", text: $patientSearchQuery)
                                        .textFieldStyle(.roundedBorder)
                                        .accessibilityIdentifier("patients-search-field")

                                    Picker("Ordina", selection: $patientSortMode) {
                                        Text("Recenti").tag(PatientListSortMode.recent)
                                        Text("A-Z").tag(PatientListSortMode.alpha)
                                    }
                                    .pickerStyle(.menu)
                                    .accessibilityIdentifier("patients-sort-picker")
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
                                .accessibilityIdentifier("patient-row-\(patient.id)")
                                .contextMenu {
                                    Button("Modifica") {
                                        Task { await startEditing(patientId: patient.id) }
                                    }

                                    Button(patient.isArchived == true ? "Riattiva" : "Archivia") {
                                        Task {
                                            await setArchive(
                                                for: patient,
                                                isArchived: patient.isArchived != true
                                            )
                                        }
                                    }

                                    Divider()

                                    Button("Elimina", role: .destructive) {
                                        pendingDeletePatient = patient
                                    }
                                }
                            }
                        }
                    }
                    .navigationTitle("MediFlow")
                    .listStyle(.sidebar)
                    .toolbar {
                        Button("Nuovo paziente") {
                            showingNewPatient = true
                        }
                        .accessibilityIdentifier("patients-new-button")
                        Button("Ricarica") {
                            Task { await viewModel.loadInitial() }
                        }
                        .accessibilityIdentifier("patients-refresh-button")
                        Button("Modifica") {
                            guard let selectedPatient else { return }
                            Task { await startEditing(patientId: selectedPatient.id) }
                        }
                        .disabled(selectedPatient == nil || isLoadingPatientEditor)
                        .accessibilityIdentifier("patients-edit-button")
                        Button(selectedPatient?.isArchived == true ? "Riattiva" : "Archivia") {
                            guard let selectedPatient else { return }
                            Task {
                                await setArchive(
                                    for: selectedPatient,
                                    isArchived: selectedPatient.isArchived != true
                                )
                            }
                        }
                        .disabled(selectedPatient == nil)
                        .accessibilityIdentifier("patients-archive-button")
                        Button("Elimina", role: .destructive) {
                            guard let selectedPatient else { return }
                            pendingDeletePatient = selectedPatient
                        }
                        .disabled(selectedPatient == nil)
                        .accessibilityIdentifier("patients-delete-button")
                        Button("Impostazioni") {
                            showingSettings = true
                        }
                        .accessibilityIdentifier("patients-settings-button")
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
        /* @Codex */
        .sheet(item: $editingPatient) { patient in
            GlassPanelWindow(
                title: "Modifica paziente",
                subtitle: "Aggiorna anagrafica e stato cartella",
                minSize: CGSize(width: 620, height: 640),
                expandedSize: CGSize(width: 760, height: 840)
            ) {
                EditPatientView(patient: patient) {
                    Task {
                        await viewModel.loadPatients()
                        syncSelectedPatientIfHidden()
                    }
                }
                .environmentObject(security)
            }
        }
        /* @Codex */
        .alert(
            "Eliminare questo paziente?",
            isPresented: Binding(
                get: { pendingDeletePatient != nil },
                set: { if !$0 { pendingDeletePatient = nil } }
            )
        ) {
            Button("Elimina", role: .destructive) {
                guard let patient = pendingDeletePatient else { return }
                Task { await deletePatient(patient) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("L'operazione è irreversibile e rimuove la cartella clinica.")
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
        PatientsFiltering.apply(
            patients: viewModel.patients,
            query: patientSearchQuery,
            viewMode: patientViewMode,
            sortMode: patientSortMode
        )
    }

    /* @Codex */
    private var selectedPatient: PatientSummary? {
        guard let selectedPatientId else { return nil }
        return viewModel.patients.first(where: { $0.id == selectedPatientId })
    }

    /* @Codex */
    private func syncSelectedPatientIfHidden() {
        guard let selectedPatientId else { return }
        if !filteredPatients.contains(where: { $0.id == selectedPatientId }) {
            self.selectedPatientId = nil
        }
    }

    /* @Codex */
    @MainActor
    private func startEditing(patientId: String) async {
        if isLoadingPatientEditor { return }
        isLoadingPatientEditor = true
        defer { isLoadingPatientEditor = false }

        do {
            editingPatient = try await LocalAPIClient.shared.fetchPatient(id: patientId)
            viewModel.errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                viewModel.errorMessage = localError.localizedDescription
            } else {
                viewModel.errorMessage = "Impossibile aprire la scheda paziente."
            }
        }
    }

    /* @Codex */
    @MainActor
    private func setArchive(for patient: PatientSummary, isArchived: Bool) async {
        do {
            try await LocalAPIClient.shared.updatePatient(
                id: patient.id,
                payload: UpdatePatientPayload(
                    firstName: nil,
                    lastName: nil,
                    taxCode: nil,
                    birthDate: nil,
                    address: nil,
                    phone: nil,
                    caregiver: nil,
                    exemptions: nil,
                    notes: nil,
                    aiSummary: nil,
                    documentInsights: nil,
                    isAdi: nil,
                    isArchived: isArchived,
                    ambulatoryId: nil
                )
            )
            await viewModel.loadPatients()
            syncSelectedPatientIfHidden()
            viewModel.errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                viewModel.errorMessage = localError.localizedDescription
            } else {
                viewModel.errorMessage = "Aggiornamento stato paziente fallito."
            }
        }
    }

    /* @Codex */
    @MainActor
    private func deletePatient(_ patient: PatientSummary) async {
        pendingDeletePatient = nil
        do {
            try await LocalAPIClient.shared.deletePatient(id: patient.id)
            await viewModel.loadPatients()
            if selectedPatientId == patient.id {
                selectedPatientId = nil
            }
            syncSelectedPatientIfHidden()
            viewModel.errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                viewModel.errorMessage = localError.localizedDescription
            } else {
                viewModel.errorMessage = "Eliminazione paziente fallita."
            }
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
