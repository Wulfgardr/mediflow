// Codex: created 2026-02-01
import SwiftUI

struct ContentView: View {
    @StateObject private var viewModel = PatientsViewModel()
    @StateObject private var settings = SettingsStore.shared
    @EnvironmentObject private var security: SecuritySession
    @State private var selectedPatientId: PatientSummary.ID?
    @State private var showingSettings = false
    @State private var showingNewPatient = false

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
                            if viewModel.isLoadingPatients {
                                ProgressView("Caricamento...")
                            }

                            ForEach(viewModel.patients) { patient in
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
            SettingsView(settings: settings)
                .environmentObject(security)
        }
        .sheet(isPresented: $showingNewPatient) {
            NewPatientView(ambulatoryId: viewModel.selectedAmbulatoryId) {
                Task { await viewModel.loadInitial() }
            }
            .environmentObject(security)
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
        .onChange(of: viewModel.selectedAmbulatoryId) { _ in
            selectedPatientId = nil
            Task { await viewModel.loadPatients() }
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
