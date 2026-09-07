/* @Codex */
import SwiftUI
import MediFlowCore

@MainActor
final class NativeAIConfigurationModel: ObservableObject {
    @Published private(set) var snapshot: NativeAIFunctionPreferences?
    @Published private(set) var preview: NativeAIFunctionPreview?
    @Published private(set) var message = "Collega l’host e accedi con il PIN operatore."
    @Published private(set) var isWorking = false
    private var task: Task<Void, Never>?
    private var generation: UInt = 0
    private var snapshotIdentity: ClinicalWorkspaceConnection.Identity?
    private let connectionProvider: () -> ClinicalWorkspaceConnection?
    // Typed service seams permit synthetic tests without Web sessions or real data.
    struct Services {
        var read: (ClinicalWorkspaceConnection) async throws -> NativeAIFunctionPreferences
        var preview: (NativeAIFunctionCommand, ClinicalWorkspaceConnection) async throws -> NativeAIFunctionPreview
        var apply: (NativeAIFunctionCommand, ClinicalWorkspaceConnection) async throws -> NativeAIFunctionPreferences
        static let live = Services(read: { connection in
            try await client(connection).readNativeFunctionPreferences(credentials: connection.credentials, sessionCookie: connection.sessionCookie)
        }, preview: { command, connection in
            try await client(connection).previewNativeFunctionPreferences(command, credentials: connection.credentials, sessionCookie: connection.sessionCookie)
        }, apply: { command, connection in
            try await client(connection).applyNativeFunctionPreferences(command, credentials: connection.credentials, sessionCookie: connection.sessionCookie)
        })
        private static func client(_ connection: ClinicalWorkspaceConnection) throws -> HomeBasePatientsClient {
            guard let url = connection.serverURL, let pin = connection.tlsPin, !pin.isEmpty else { throw HomeBaseClientError.contract }
            return HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: url, tlsPin: pin))
        }
    }
    private let services: Services
    init(connectionProvider: @escaping () -> ClinicalWorkspaceConnection?, services: Services = .live) {
        self.connectionProvider = connectionProvider; self.services = services
    }
    func invalidate() {
        generation &+= 1; task?.cancel(); task = nil
        snapshot = nil; preview = nil; snapshotIdentity = nil; isWorking = false
        message = "Rileggi la configurazione con una sessione autorizzata."
    }
    func load() {
        invalidate()
        run { connection in
            let value = try await self.services.read(connection)
            try value.validate()
            return (value, nil, "Configurazione letta dall’host.")
        }
    }
    func prepare(_ command: NativeAIFunctionCommand) {
        guard snapshotIdentity == connectionProvider()?.identity else { invalidate(); return }
        guard !isWorking, let snapshot, command.expectedRevision == snapshot.revision,
              command.expectedCatalogRevision == snapshot.catalogRevision else { return }
        preview = nil
        run { connection in
            let value = try await self.services.preview(command, connection)
            try value.validate(command: command)
            return (snapshot, value, "Anteprima: nessuna modifica salvata.")
        }
    }
    func cancelPreview() { preview = nil }
    func confirm() {
        guard snapshotIdentity == connectionProvider()?.identity else { invalidate(); return }
        guard !isWorking, let preview else { return }
        self.preview = nil
        run { connection in
            let applied = try await self.services.apply(preview.command, connection)
            try applied.validate()
            // Do not issue a follow-up read if this session was retired while applying.
            guard !Task.isCancelled, self.connectionProvider()?.identity == connection.identity else { throw CancellationError() }
            let observed = try await self.services.read(connection)
            try observed.validate()
            return (observed, nil, observed.revision == applied.revision && observed.catalogRevision == applied.catalogRevision
                ? "Preferenze salvate e rilette dall’host." : "L’host è cambiato dopo il salvataggio. Mostro la configurazione riletta.")
        }
    }
    private func run(_ operation: @escaping (ClinicalWorkspaceConnection) async throws -> (NativeAIFunctionPreferences, NativeAIFunctionPreview?, String)) {
        guard let connection = connectionProvider() else {
            snapshot = nil; preview = nil; message = "Collega l’host e accedi con il PIN operatore."; return
        }
        generation &+= 1; let expected = generation
        task?.cancel(); isWorking = true
        task = Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await operation(connection)
                guard !Task.isCancelled, self.generation == expected, self.connectionProvider()?.identity == connection.identity else { return }
                self.snapshot = result.0; self.snapshotIdentity = connection.identity
                self.preview = result.1; self.message = result.2
            } catch {
                guard !Task.isCancelled, self.generation == expected, self.connectionProvider()?.identity == connection.identity else { return }
                self.snapshot = nil; self.preview = nil; self.snapshotIdentity = nil
                if case HomeBaseClientError.httpStatus(let status, _) = error {
                    switch status {
                    case 401: self.message = "Sessione o pairing non più validi. Accedi nuovamente."
                    case 403: self.message = "L’amministratore deve autorizzare questo operatore e questo Mac sul computer host."
                    case 409: self.message = "La configurazione è cambiata. Rileggi e prepara una nuova anteprima."
                    case 404: self.message = "Questo host non espone ancora la configurazione AI nativa."
                    default: self.message = "Esito non verificato. Rileggi prima di riprovare; nessun invio automatico."
                    }
                } else { self.message = "Esito non verificato. Rileggi prima di riprovare; nessun invio automatico." }
            }
            self.isWorking = false; self.task = nil
        }
    }
}

struct NativeAIConfigurationView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var model: NativeAIConfigurationModel
    init(workspaceModel: PairedPatientsWorkspaceModel) {
        self.workspaceModel = workspaceModel
        _model = StateObject(wrappedValue: NativeAIConfigurationModel(connectionProvider: { workspaceModel.nativeOperatorConnection }))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Preferenze per tutti gli operatori dell’host. La disponibilità di un modello non prova che l’inferenza sia pronta.")
                .font(.caption).foregroundStyle(.secondary)
            Text(model.message).font(.callout).accessibilityIdentifier("native-ai-configuration-status")
            if model.isWorking { ProgressView("Verifica sull’host…") }
            if let snapshot = model.snapshot {
                ForEach(snapshot.functions) { function in
                    NativeAIFunctionEditor(function: function, snapshot: snapshot, isWorking: model.isWorking || model.preview != nil, prepare: model.prepare)
                        .id(function.id + snapshot.revision + snapshot.catalogRevision)
                }
                HStack {
                    Button("Anteprima valori host") { model.prepare(NativeAIFunctionCommand(snapshot: snapshot, presetId: "host_defaults")) }
                    Button("Anteprima tutte disattivate") { model.prepare(NativeAIFunctionCommand(snapshot: snapshot, presetId: "all_off")) }
                }.disabled(model.isWorking || model.preview != nil)
                Text("Valori host ripristina i modelli mantenendo gli interruttori attuali. Tutte disattivate spegne le quattro funzioni.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let preview = model.preview {
                GroupBox("Conferma configurazione dell’host") {
                    VStack(alignment: .leading, spacing: 8) {
                        ForEach(preview.proposed.functions) { function in
                            Text("\(function.title): \(function.enabled ? "attiva" : "disattivata") · \(function.options.first(where: { $0.id == function.defaultModelOptionId })?.label ?? "modello non disponibile")")
                        }
                        HStack {
                            Button("Conferma e salva sull’host") { model.confirm() }
                                .accessibilityIdentifier("native-ai-configuration-confirm")
                            Button("Annulla anteprima") { model.cancelPreview() }
                        }.disabled(model.isWorking)
                    }.frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Button("Rileggi preferenze dall’host") { model.load() }.disabled(model.isWorking)
                .accessibilityIdentifier("native-ai-configuration-reload")
            Divider()
            Text("Lo stato account ChatGPT non è ancora disponibile per questa sessione Mac.")
                .font(.caption).foregroundStyle(.secondary)
        }
        .buttonStyle(.bordered)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("native-ai-configuration")
        .task(id: workspaceModel.nativeOperatorConnection?.identity) { model.load() }
        .onDisappear { model.invalidate() }
    }
}
private struct NativeAIFunctionEditor: View {
    let function: NativeAIFunctionPreferences.Function
    let snapshot: NativeAIFunctionPreferences
    let isWorking: Bool
    let prepare: (NativeAIFunctionCommand) -> Void
    @State private var enabled: Bool
    @State private var option: String
    init(function: NativeAIFunctionPreferences.Function, snapshot: NativeAIFunctionPreferences, isWorking: Bool,
         prepare: @escaping (NativeAIFunctionCommand) -> Void) {
        self.function = function; self.snapshot = snapshot; self.isWorking = isWorking; self.prepare = prepare
        _enabled = State(initialValue: function.enabled)
        let selected = function.defaultSource == "host_configuration" ? "" : function.defaultModelOptionId ?? ""
        _option = State(initialValue: function.options.contains(where: { $0.id == selected }) ? selected : "")
    }
    var body: some View {
        GroupBox(function.title) {
            VStack(alignment: .leading, spacing: 8) {
                Toggle("Funzione attiva", isOn: $enabled)
                    .accessibilityLabel(function.title + ": funzione attiva")
                Picker("Modello preferito", selection: $option) {
                    Text("Valore configurato sull’host").tag("")
                    ForEach(function.options) { value in
                        Text("\(value.label)\(value.state == "unavailable" ? " — non disponibile" : "")").tag(value.id)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityLabel("Modello preferito per " + function.title)
                if function.bindingState != "current" {
                    Text("Associazione da verificare sull’host.").font(.caption).foregroundStyle(.secondary)
                }
                Button("Prepara modifica") {
                    prepare(NativeAIFunctionCommand(snapshot: snapshot, functionId: function.id, enabled: enabled, defaultModelOptionId: option.isEmpty ? nil : option))
                }.accessibilityLabel("Prepara modifica: " + function.title)
            }.disabled(isWorking)
        }
        .buttonStyle(.bordered)
    }
}
