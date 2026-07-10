import SwiftUI
import MediFlowCore

@MainActor
final class SettingsAccessModel: ObservableObject {
    @Published private(set) var message: String?
    @Published private(set) var isWorking = false

    func isAvailable(using workspaceModel: PairedPatientsWorkspaceModel) -> Bool {
        guard let connection = workspaceModel.clinicalWorkspaceConnection else { return false }
        return connection.masterKey != nil
    }

    func unavailableMessage(using workspaceModel: PairedPatientsWorkspaceModel) -> String {
        if workspaceModel.connectionState == .pairedOnline {
            return "Accedi con il PIN operatore per sbloccare la cifratura prima di modificare l'accesso."
        }
        return "Collega l'home-base e accedi con il PIN operatore per gestire l'accesso."
    }

    func changePin(
        currentPin: String,
        newPin: String,
        confirmation: String,
        using workspaceModel: PairedPatientsWorkspaceModel
    ) async {
        guard newPin == confirmation else {
            message = "La conferma del nuovo PIN non corrisponde."
            return
        }
        isWorking = true
        message = nil
        await workspaceModel.changePin(currentPin: currentPin, newPin: newPin)
        isWorking = false
        message = workspaceModel.errorMessage ?? workspaceModel.statusMessage
    }

    func lockSession(using workspaceModel: PairedPatientsWorkspaceModel) async {
        isWorking = true
        message = nil
        await workspaceModel.lockSessionNow()
        isWorking = false
        message = workspaceModel.statusMessage
    }
}

@MainActor
final class SettingsProfileModel: ObservableObject {
    @Published var displayName = ""
    @Published var ambulatoryName = ""
    @Published private(set) var message: String?
    @Published private(set) var isWorking = false

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private let profileUpdated: (String?, String?) -> Void
    private let sessionExpired: () async -> Void
    private var loadedUserId: String?

    init(
        connectionProvider: @escaping () -> ClinicalWorkspaceConnection?,
        profileUpdated: @escaping (String?, String?) -> Void,
        sessionExpired: @escaping () async -> Void
    ) {
        self.connectionProvider = connectionProvider
        self.profileUpdated = profileUpdated
        self.sessionExpired = sessionExpired
    }

    func sync(from identity: PairedPatientsWorkspaceModel.OperatorIdentity?) {
        guard let identity else {
            loadedUserId = nil
            displayName = ""
            ambulatoryName = ""
            return
        }
        guard loadedUserId != identity.userId else { return }
        loadedUserId = identity.userId
        displayName = identity.displayName ?? ""
        ambulatoryName = identity.ambulatoryName ?? ""
        message = nil
    }

    func save(identity: PairedPatientsWorkspaceModel.OperatorIdentity?) async {
        guard let identity else {
            message = "Accedi con il PIN operatore prima di aggiornare il profilo."
            return
        }
        guard let connection = connectionProvider() else {
            message = "Collega l'home-base e accedi con il PIN operatore prima di aggiornare il profilo."
            return
        }
        let displayName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let ambulatoryName = ambulatoryName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !displayName.isEmpty, !ambulatoryName.isEmpty else {
            message = "Inserisci nome visualizzato e nome dell'ambulatorio."
            return
        }

        isWorking = true
        message = nil
        do {
            let acknowledgement = try await connection.dataSource.updateProfile(
                userId: identity.userId,
                displayName: displayName,
                ambulatoryName: ambulatoryName,
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard acknowledgement.success else { throw HomeBaseClientError.contract }
            profileUpdated(displayName, ambulatoryName)
            message = "Profilo aggiornato."
        } catch {
            await present(error)
        }
        isWorking = false
    }

    private func present(_ error: Error) async {
        if case HomeBaseClientError.httpStatus(let status, _) = error {
            switch status {
            case 401:
                await sessionExpired()
                message = "La sessione è scaduta. Accedi di nuovo prima di aggiornare il profilo."
                return
            case 403:
                message = "Non hai l'autorizzazione per aggiornare il profilo."
                return
            default:
                break
            }
        }
        message = "Impossibile aggiornare il profilo: \(error.localizedDescription)"
    }
}

@MainActor
final class SettingsAmbulatoriesModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var ambulatories: [NetworkAmbulatorySummary] = []
    @Published var newName = ""
    @Published var newType = "live"
    @Published var editingName = ""
    @Published private(set) var editingId: String?
    @Published private(set) var message: String?
    @Published private(set) var isWorking = false

    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    private let sessionExpired: () async -> Void

    init(
        connectionProvider: @escaping () -> ClinicalWorkspaceConnection?,
        sessionExpired: @escaping () async -> Void
    ) {
        self.connectionProvider = connectionProvider
        self.sessionExpired = sessionExpired
    }

    func load() async {
        guard let connection = connectionProvider() else {
            state = .unavailable("Collega l'home-base e accedi con il PIN operatore per gestire gli ambulatori.")
            return
        }
        state = .loading
        do {
            ambulatories = try await connection.dataSource.fetchNetworkAmbulatories(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId
            )
            state = .loaded
        } catch {
            await presentLoad(error)
        }
    }

    func create() async {
        let name = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            message = "Inserisci il nome del nuovo ambulatorio."
            return
        }
        await mutate {
            let connection = try self.connection()
            let response = try await connection.dataSource.createAmbulatory(
                payload: HomeBaseAmbulatoryCreatePayload(name: name, type: self.newType),
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard response.success else { throw HomeBaseClientError.contract }
            self.newName = ""
            self.newType = "live"
            self.message = "Ambulatorio creato."
        }
    }

    func beginRenaming(_ ambulatory: NetworkAmbulatorySummary) {
        editingId = ambulatory.id
        editingName = ambulatory.name
        message = nil
    }

    func cancelRenaming() {
        editingId = nil
        editingName = ""
    }

    func rename(_ ambulatory: NetworkAmbulatorySummary) async {
        let name = editingName.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else {
            message = "Inserisci il nuovo nome dell'ambulatorio."
            return
        }
        await mutate {
            let connection = try self.connection()
            let response = try await connection.dataSource.updateAmbulatory(
                id: ambulatory.id,
                payload: HomeBaseAmbulatoryUpdatePayload(expectedVersion: ambulatory.version, name: name),
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard response.success else { throw HomeBaseClientError.contract }
            self.cancelRenaming()
            self.message = "Ambulatorio rinominato."
        }
    }

    func makeDefault(_ ambulatory: NetworkAmbulatorySummary) async {
        await mutate {
            let connection = try self.connection()
            let response = try await connection.dataSource.updateAmbulatory(
                id: ambulatory.id,
                payload: HomeBaseAmbulatoryUpdatePayload(expectedVersion: ambulatory.version, isDefault: true),
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard response.success else { throw HomeBaseClientError.contract }
            self.message = "Ambulatorio predefinito aggiornato."
        }
    }

    func delete(_ ambulatory: NetworkAmbulatorySummary) async {
        await mutate {
            let connection = try self.connection()
            let response = try await connection.dataSource.deleteAmbulatory(
                id: ambulatory.id,
                expectedVersion: ambulatory.version,
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard response.success else { throw HomeBaseClientError.contract }
            self.message = "Ambulatorio eliminato."
        }
    }

    func clearTestAmbulatory(_ ambulatory: NetworkAmbulatorySummary) async {
        guard ambulatory.type == "test" else {
            message = "Puoi svuotare solo un ambulatorio di test."
            return
        }
        await mutate {
            let connection = try self.connection()
            let response = try await connection.dataSource.clearAmbulatory(
                id: ambulatory.id,
                expectedVersion: ambulatory.version,
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie
            )
            guard response.success else { throw HomeBaseClientError.contract }
            self.message = "Dati di test rimossi dall'ambulatorio."
        }
    }

    private func connection() throws -> ClinicalWorkspaceConnection {
        guard let connection = connectionProvider() else {
            throw HomeBaseClientError.missingSessionCookie
        }
        return connection
    }

    private func mutate(_ operation: @escaping () async throws -> Void) async {
        isWorking = true
        message = nil
        do {
            try await operation()
            await load()
        } catch {
            if await refreshAfterConflict(error) {
                isWorking = false
                return
            }
            await presentMutation(error)
        }
        isWorking = false
    }

    private func refreshAfterConflict(_ error: Error) async -> Bool {
        let isConflict: Bool
        switch error {
        case HomeBaseClientError.versionConflict:
            isConflict = true
        case HomeBaseClientError.httpStatus(let status, _):
            isConflict = status == 409
        default:
            isConflict = false
        }
        guard isConflict else { return false }
        await load()
        message = "I dati sono cambiati sull'host. La lista è stata aggiornata."
        return true
    }

    private func presentLoad(_ error: Error) async {
        if await handleAuthentication(error) { return }
        state = .failed("Impossibile caricare gli ambulatori: \(error.localizedDescription)")
    }

    private func presentMutation(_ error: Error) async {
        if await handleAuthentication(error) { return }
        message = "Impossibile aggiornare gli ambulatori: \(error.localizedDescription)"
    }

    private func handleAuthentication(_ error: Error) async -> Bool {
        guard case HomeBaseClientError.httpStatus(let status, _) = error else { return false }
        switch status {
        case 401:
            await sessionExpired()
            state = .unavailable("La sessione è scaduta. Accedi di nuovo per gestire gli ambulatori.")
            return true
        case 403:
            message = "Non hai l'autorizzazione per gestire gli ambulatori."
            return true
        default:
            return false
        }
    }
}

@MainActor
final class SettingsAiFunctionsModel: ObservableObject {
    @Published private(set) var state: ClinicalWorkspaceLoadState = .idle
    @Published private(set) var runtime: HomeBaseNetworkAiRuntimeSummary?

    private let connectionProvider: () -> ClinicalWorkspaceConnection?

    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?) {
        self.connectionProvider = connectionProvider
    }

    func load() async {
        guard let connection = connectionProvider() else {
            runtime = nil
            state = .unavailable("Collega l'home-base e accedi con il PIN operatore per consultare le funzioni AI.")
            return
        }

        state = .loading
        do {
            runtime = try await connection.dataSource.fetchAiRuntimeStatus(
                credentials: connection.credentials,
                sessionCookie: connection.sessionCookie,
                ambulatoryId: connection.ambulatoryId
            )
            state = .loaded
        } catch {
            runtime = nil
            state = .failed("Stato non disponibile.")
        }
    }
}

struct SettingsWorkspaceView: View {
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @ObservedObject var appearance: AppleAppearanceStore
    @StateObject private var accessModel = SettingsAccessModel()
    @StateObject private var profileModel: SettingsProfileModel
    @StateObject private var ambulatoriesModel: SettingsAmbulatoriesModel
    @StateObject private var aiFunctionsModel: SettingsAiFunctionsModel
    @State private var currentPin = ""
    @State private var newPin = ""
    @State private var newPinConfirmation = ""
    @State private var pendingDeletion: NetworkAmbulatorySummary?
    @State private var pendingClear: NetworkAmbulatorySummary?
    @State private var showsDeletionConfirmation = false
    @State private var showsClearConfirmation = false

    init(
        capabilities: ClinicalWorkspaceCapabilitiesStore,
        workspaceModel: PairedPatientsWorkspaceModel,
        appearance: AppleAppearanceStore
    ) {
        self.capabilities = capabilities
        self.workspaceModel = workspaceModel
        self.appearance = appearance
        _profileModel = StateObject(wrappedValue: SettingsProfileModel(
            connectionProvider: { workspaceModel.clinicalWorkspaceConnection },
            profileUpdated: { displayName, ambulatoryName in
                workspaceModel.noteProfileUpdated(displayName: displayName, ambulatoryName: ambulatoryName)
            },
            sessionExpired: { await workspaceModel.lockSessionNow() }
        ))
        _ambulatoriesModel = StateObject(wrappedValue: SettingsAmbulatoriesModel(
            connectionProvider: { workspaceModel.clinicalWorkspaceConnection },
            sessionExpired: { await workspaceModel.lockSessionNow() }
        ))
        _aiFunctionsModel = StateObject(wrappedValue: SettingsAiFunctionsModel(
            connectionProvider: { workspaceModel.clinicalWorkspaceConnection }
        ))
    }

    var body: some View {
        List {
            Section("Accesso") { accessContent }
            Section("Profilo") { profileContent }
            Section("Ambulatori") { ambulatoryContent }
            Section("Funzioni AI") { aiFunctionsContent }
            Section("Aspetto") { appearanceContent }
            Section("Privacy") { privacyContent }
        }
        .navigationTitle("Impostazioni")
        .task(id: workspaceModel.operatorIdentity) {
            profileModel.sync(from: workspaceModel.operatorIdentity)
        }
        .task(id: workspaceModel.connectionState) {
            guard capabilities.hasCapability("network.ambulatories.write") else { return }
            await ambulatoriesModel.load()
        }
        .task(id: workspaceModel.connectionState) {
            await aiFunctionsModel.load()
        }
        .confirmationDialog("Eliminare questo ambulatorio?", isPresented: $showsDeletionConfirmation, titleVisibility: .visible) {
            Button("Elimina", role: .destructive) {
                guard let ambulatory = pendingDeletion else { return }
                Task { await ambulatoriesModel.delete(ambulatory) }
            }
        } message: {
            Text("L'operazione non può essere annullata.")
        }
        .confirmationDialog("Svuotare i dati di test?", isPresented: $showsClearConfirmation, titleVisibility: .visible) {
            Button("Svuota", role: .destructive) {
                guard let ambulatory = pendingClear else { return }
                Task { await ambulatoriesModel.clearTestAmbulatory(ambulatory) }
            }
        } message: {
            Text(pendingClear.map { "I dati di test di \($0.name) verranno rimossi." } ?? "I dati di test verranno rimossi.")
        }
    }

    @ViewBuilder
    private var accessContent: some View {
        if accessModel.isAvailable(using: workspaceModel) {
            SecureField("PIN attuale", text: $currentPin)
                .textContentType(.password)
            SecureField("Nuovo PIN", text: $newPin)
            SecureField("Conferma nuovo PIN", text: $newPinConfirmation)
            Button("Aggiorna PIN") {
                Task {
                    await accessModel.changePin(
                        currentPin: currentPin,
                        newPin: newPin,
                        confirmation: newPinConfirmation,
                        using: workspaceModel
                    )
                    if workspaceModel.errorMessage == nil {
                        currentPin = ""
                        newPin = ""
                        newPinConfirmation = ""
                    }
                }
            }
            .disabled(accessModel.isWorking || currentPin.isEmpty || newPin.isEmpty || newPinConfirmation.isEmpty)
            Button("Blocca sessione adesso", role: .destructive) {
                Task { await accessModel.lockSession(using: workspaceModel) }
            }
            .disabled(accessModel.isWorking)
            if let message = accessModel.message { settingsMessage(message) }
        } else {
            settingsMessage(accessModel.unavailableMessage(using: workspaceModel))
        }
    }

    @ViewBuilder
    private var profileContent: some View {
        if workspaceModel.operatorIdentity != nil, workspaceModel.clinicalWorkspaceConnection != nil {
            TextField("Nome visualizzato", text: $profileModel.displayName)
            TextField("Nome ambulatorio", text: $profileModel.ambulatoryName)
            Button("Salva profilo") {
                Task { await profileModel.save(identity: workspaceModel.operatorIdentity) }
            }
            .disabled(profileModel.isWorking)
            if let message = profileModel.message { settingsMessage(message) }
        } else {
            settingsMessage("Collega l'home-base e accedi con il PIN operatore per aggiornare il profilo.")
        }
    }

    @ViewBuilder
    private var ambulatoryContent: some View {
        if capabilities.hasCapability("network.ambulatories.write") {
            TextField("Nome nuovo ambulatorio", text: $ambulatoriesModel.newName)
            Picker("Tipo", selection: $ambulatoriesModel.newType) {
                Text("Operativo").tag("live")
                Text("Test").tag("test")
            }
            Button("Crea ambulatorio") { Task { await ambulatoriesModel.create() } }
                .disabled(ambulatoriesModel.isWorking || ambulatoriesModel.newName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

            if ambulatoriesModel.state == .loading {
                ProgressView()
            } else if case .unavailable(let message) = ambulatoriesModel.state {
                settingsMessage(message)
            } else if case .failed(let message) = ambulatoriesModel.state {
                settingsMessage(message)
            } else if ambulatoriesModel.ambulatories.isEmpty {
                settingsMessage("Nessun ambulatorio disponibile.")
            } else {
                ForEach(ambulatoriesModel.ambulatories) { ambulatory in
                    ambulatoryRow(ambulatory)
                }
            }
            if let message = ambulatoriesModel.message { settingsMessage(message) }
        } else {
            ClinicalCapabilityGateView(store: capabilities, capability: "network.ambulatories.write")
                .frame(minHeight: 160)
        }
    }

    @ViewBuilder
    private var appearanceContent: some View {
        Picker("Tema", selection: $appearance.theme) {
            ForEach(AppleAppearanceTheme.allCases) { theme in
                Text(theme.title).tag(theme)
            }
        }
        Toggle("Riduci movimento", isOn: $appearance.reduceMotionOverride)
        Text("Riduce gli effetti visivi anche se il dispositivo non li limita.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private var aiFunctionsContent: some View {
        Text("Sola lettura. Modifica sul nodo home base.")
            .font(.subheadline)
            .foregroundStyle(.secondary)

        if aiFunctionsModel.state == .loading {
            ProgressView()
        } else if let runtime = aiFunctionsModel.runtime, aiFunctionsModel.state == .loaded {
            settingsStatusRow("Patient Insight", value: aiFunctionState(runtime.killSwitches.patientInsight))
            settingsStatusRow("Document Synthesis", value: aiFunctionState(runtime.killSwitches.documentSynthesis))
            settingsStatusRow("Smart Import", value: aiFunctionState(runtime.killSwitches.smartImport))
            settingsStatusRow("Treatment Reasoning", value: aiFunctionState(runtime.killSwitches.treatmentReasoning))
            settingsStatusRow("Piano AI", value: runtime.plane)
            settingsStatusRow("Modalità", value: runtime.mode)
            settingsStatusRow("Runtime locale", value: "\(runtime.localRuntime.state), \(runtime.localRuntime.provider)")
            settingsStatusRow("Runtime centrale", value: runtime.centralRuntime.state)
            settingsStatusRow("Superfici", value: runtime.surfaces.isEmpty ? "Nessuna" : runtime.surfaces.joined(separator: ", "))
        } else if case .unavailable(let message) = aiFunctionsModel.state {
            settingsMessage(message)
        } else if case .failed(let message) = aiFunctionsModel.state {
            settingsMessage(message)
        } else {
            settingsMessage("Stato non disponibile.")
        }
    }

    @ViewBuilder
    private var privacyContent: some View {
        Toggle("Oscura contenuti clinici", isOn: $appearance.privacyShieldEnabled)
        Text("Quando è attivo, MediFlow mantiene coperti i contenuti clinici anche mentre l'app è aperta.")
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    @ViewBuilder
    private func ambulatoryRow(_ ambulatory: NetworkAmbulatorySummary) -> some View {
        if ambulatoriesModel.editingId == ambulatory.id {
            TextField("Nome ambulatorio", text: $ambulatoriesModel.editingName)
            HStack {
                Button("Annulla") { ambulatoriesModel.cancelRenaming() }
                Button("Salva") { Task { await ambulatoriesModel.rename(ambulatory) } }
                    .disabled(ambulatoriesModel.isWorking)
            }
        } else {
            VStack(alignment: .leading, spacing: 5) {
                HStack {
                    Text(ambulatory.name)
                        .font(.headline)
                    if ambulatory.isDefault == true {
                        Text("Predefinito")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
                if let address = ambulatory.address, !address.isEmpty {
                    Text(address).font(.subheadline).foregroundStyle(.secondary)
                }
                HStack {
                    Button("Rinomina") { ambulatoriesModel.beginRenaming(ambulatory) }
                    if ambulatory.isDefault != true {
                        Button("Rendi predefinito") { Task { await ambulatoriesModel.makeDefault(ambulatory) } }
                    }
                    if ambulatory.type == "test" {
                        Button("Svuota", role: .destructive) {
                            pendingClear = ambulatory
                            showsClearConfirmation = true
                        }
                    }
                    Button("Elimina", role: .destructive) {
                        pendingDeletion = ambulatory
                        showsDeletionConfirmation = true
                    }
                }
                .buttonStyle(.borderless)
                .disabled(ambulatoriesModel.isWorking)
            }
        }
    }

    private func settingsMessage(_ message: String) -> some View {
        Text(message)
            .font(.subheadline)
            .foregroundStyle(.secondary)
    }

    private func settingsStatusRow(_ label: String, value: String) -> some View {
        LabeledContent(label) {
            Text(value)
                .foregroundStyle(.secondary)
        }
    }

    private func aiFunctionState(_ state: HomeBaseNetworkAiKillSwitchState) -> String {
        switch state {
        case .enabled:
            return "Attivo"
        case .disabled:
            return "Disattivato"
        }
    }
}
