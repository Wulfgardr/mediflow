import Foundation
import Combine
import MediFlowCore

@MainActor
final class NativeFabricModel: ObservableObject {
    enum Phase: Equatable { case idle, preparing, ready, generating, completed, closing, blocked }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var message = "Usa la funzione locale già configurata sull’host."
    @Published private(set) var proposal: NativeOrdinaryJSON?
    @Published private(set) var selection: NativeFabricSelection?
    @Published private(set) var isWorking = false
    private(set) var attemptId: String?
    private var projection: NativeOrdinaryProjectionPlan?
    private var original: NativeOrdinarySnapshot?
    private var generation: UInt = 0
    private var preparationInFlight = false
    private var task: Task<Void, Never>?
    private var watchdog: Task<Void, Never>?
    private var expiry = Double.infinity
    private var subscriptions = Set<AnyCancellable>()
    private let function: NativeOrdinaryFunction
    private let snapshot: () throws -> NativeOrdinarySnapshot
    struct Services {
        var prepare: (NativeOrdinaryPreparation, ClinicalWorkspaceConnection) async throws -> NativeFabricResponse
        var command: (NativeFabricCommand, ClinicalWorkspaceConnection) async throws -> NativeFabricResponse
        var status: (String?, ClinicalWorkspaceConnection) async throws -> NativeFabricResponse
        var project: (NativeOrdinaryProjectionPlan, NativeOrdinaryPreparation, NativeOrdinaryProjectionIO) async throws -> NativeFabricResponse = { _, _, _ in throw NativeOrdinaryContractError.invalid }
        var cancelProjection: (NativeOrdinaryProjectionPlan, ClinicalWorkspaceConnection) async throws -> NativeFabricResponse = { _, _ in throw NativeOrdinaryContractError.cleanupUnconfirmed }
        static let live = Services(prepare: { preparation, connection in
            try await client(connection).prepareNativeFabric(preparation, credentials: connection.credentials, sessionCookie: connection.sessionCookie)
        }, command: { command, connection in
            try await client(connection).commandNativeFabric(command, credentials: connection.credentials,
                sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId)
        }, status: { id, connection in
            try await client(connection).statusNativeFabric(attemptId: id, credentials: connection.credentials,
                sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId)
        }, project: { plan, preparation, io in
            try await NativeOrdinaryProjectionClient.projectFabric(plan, preparation: preparation, io: io)
        }, cancelProjection: { plan, connection in
            try await client(connection).cancelNativeFabricProjection(plan, credentials: connection.credentials,
                sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId)
        })
        private static func client(_ connection: ClinicalWorkspaceConnection) throws -> HomeBasePatientsClient {
            guard let url = connection.serverURL, let pin = connection.tlsPin, !pin.isEmpty else { throw HomeBaseClientError.contract }
            return HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: url, tlsPin: pin))
        }
    }
    private let services: Services
    init(function: NativeOrdinaryFunction, snapshot: @escaping () throws -> NativeOrdinarySnapshot, services: Services = .live) {
        self.function = function; self.snapshot = snapshot; self.services = services
    }
    func observe(_ workspace: PairedPatientsWorkspaceModel) {
        guard subscriptions.isEmpty else { return }
        workspace.clinicalWorkspaceInvalidations.sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$selectedPatientID.dropFirst().removeDuplicates().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$selectedPatient.dropFirst().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$entries.dropFirst().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$therapies.dropFirst().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$observations.dropFirst().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
        workspace.$attachments.dropFirst().sink { [weak self] _ in self?.invalidate() }.store(in: &subscriptions)
    }
    private func current(_ epoch: UInt, _ source: NativeOrdinarySnapshot) -> Bool {
        guard epoch == generation, !Task.isCancelled, Date().timeIntervalSince1970 * 1000 < expiry,
              let fresh = try? snapshot() else { return false }
        return source.matches(fresh)
    }
    func prepare() {
        guard phase == .idle, !isWorking, !preparationInFlight else { return }
        do {
            let source = try snapshot(); original = source; generation &+= 1; let epoch = generation
            phase = .preparing; isWorking = true; preparationInFlight = true; expiry = .infinity
            message = "Verifica delle fonti e della funzione locale sull’host…"
            task = Task {
                defer { preparationInFlight = false }
                do {
                    var value = try await services.prepare(source.preparation, source.connection)
                    guard current(epoch, source) else { await retireLate(value, source); return }
                    retain(value)
                    try value.validate(function: function)
                    if value.phase == "needs_source_projection" {
                        guard let plan = value.sourceProjection else { throw NativeOrdinaryContractError.invalid }
                        try plan.validate(preparation: source.preparation)
                        expiry = plan.expiresAt
                        let io = NativeOrdinaryProjectionIO(current: { [weak self] in
                            guard let self, self.current(epoch, source), let connection = try? self.snapshot().connection,
                                  connection.masterKey != nil else { throw NativeOrdinaryContractError.stale }
                            return connection
                        }, willSubmit: { [weak self] in
                            guard let self, self.current(epoch, source) else { throw NativeOrdinaryContractError.stale }
                            self.expiry = Date().timeIntervalSince1970 * 1000 + 120_000
                        })
                        value = try await services.project(plan, source.preparation, io)
                        guard current(epoch, source) else { await retireLate(value, source); return }
                        retain(value); try value.validate(function: function)
                    }
                    guard value.phase == "ready", value.attemptId != nil, let choice = value.selection, let deadline = value.expiresAt else { throw NativeOrdinaryContractError.invalid }
                    projection = nil; selection = choice; expiry = deadline; phase = .ready; isWorking = false
                    message = "Fonti pronte. Genera sul Mac con il modello configurato dall’host."
                    watch(epoch, source)
                } catch { if generation == epoch { fail(error, source) } }
            }
        } catch { message = "Apri una cartella online corrente prima di preparare la proposta." }
    }
    func generate() {
        guard phase == .ready, !isWorking, let source = original, let id = attemptId,
              let choice = selection, current(generation, source) else { invalidate(); return }
        let epoch = generation
        phase = .generating; isWorking = true; message = "Elaborazione locale sull’host…"
        task = Task {
            do {
                let response = try await services.command(.generate(id), source.connection)
                guard current(epoch, source) else { if generation == epoch { invalidate() }; return }
                proposal = try response.validatedProposal(function: function, attempt: id, expected: choice)
                phase = .completed; isWorking = false
                message = "Proposta locale da verificare sulle fonti. Nessuna modifica alla cartella."
            } catch { if generation == epoch { fail(error, source) } }
        }
    }
    private func retain(_ response: NativeFabricResponse) {
        guard response.functionId == function else { return }
        if let id = response.attemptId, UUID(uuidString: id) != nil { attemptId = id }
        if let plan = response.sourceProjection, plan.functionId == function,
           NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$") { projection = plan }
    }
    private func watch(_ epoch: UInt, _ source: NativeOrdinarySnapshot) {
        watchdog?.cancel()
        watchdog = Task {
            while !Task.isCancelled {
                do { try await Task.sleep(nanoseconds: 2_000_000_000) } catch { return }
                guard current(epoch, source), let id = attemptId else { if generation == epoch { invalidate() }; return }
                do {
                    let response = try await services.status(id, source.connection)
                    guard current(epoch, source) else { if generation == epoch { invalidate() }; return }
                    try response.validate(function: function, attempt: id)
                    guard response.phase == "current", response.selection == selection else { throw NativeOrdinaryContractError.stale }
                } catch { if generation == epoch { fail(error, source) }; return }
            }
        }
    }
    func invalidate() {
        proposal = nil; selection = nil
        guard phase != .closing else { return }
        guard phase != .idle || original != nil else { return }
        generation &+= 1; task?.cancel(); watchdog?.cancel()
        guard let source = original else { phase = .idle; isWorking = false; return }
        close(source, message: "Operazione chiusa. Prepara una nuova proposta per il contesto corrente.")
    }
    func verifyClosure() { guard phase == .blocked, !isWorking, let original else { return }; close(original) }
    private func fail(_ error: Error, _ source: NativeOrdinarySnapshot) {
        proposal = nil; selection = nil; generation &+= 1; watchdog?.cancel()
        let reason: String
        switch error {
        case let failure as NativeFabricFailure: reason = failure.code.message
        case HomeBaseClientError.transport(.unreachable): reason = "Host non raggiungibile."
        case HomeBaseClientError.transport(.timeout): reason = "Tempo di risposta scaduto."
        case NativeOrdinaryContractError.stale: reason = "Il contesto è cambiato o è scaduto."
        default: reason = "Funzione locale non disponibile o risposta non verificata."
        }
        close(source, message: reason + " Nessuna alternativa avviata; nessuna modifica alla cartella.")
    }
    private func close(_ source: NativeOrdinarySnapshot, message closedMessage: String = "Operazione chiusa. Nessuna modifica alla cartella.") {
        let id = attemptId, plan = projection, epoch = generation
        phase = .closing; isWorking = true; message = "Chiusura dell’operazione locale…"
        task = Task {
            do {
                let response: NativeFabricResponse
                if let id { response = try await services.command(.cancel(id), source.connection) }
                else if let plan { response = try await services.cancelProjection(plan, source.connection) }
                else { response = try await services.status(nil, source.connection) }
                guard generation == epoch else { return }
                try response.validate(function: function, attempt: id)
                guard response.phase == "closed" else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
                attemptId = nil; projection = nil; original = nil; expiry = .infinity
                phase = .idle; isWorking = false; message = closedMessage
            } catch {
                guard generation == epoch else { return }
                phase = .blocked; isWorking = false
                message = (closedMessage.hasPrefix("Operazione chiusa.") ? "" : closedMessage + " ") + "Chiusura non confermata. Verifica la chiusura prima di avviare un’altra proposta. Nessuna modifica alla cartella."
            }
        }
    }
    private func retireLate(_ response: NativeFabricResponse, _ source: NativeOrdinarySnapshot) async {
        generation &+= 1; watchdog?.cancel(); original = source; proposal = nil; selection = nil
        guard response.functionId == function else {
            phase = .blocked; isWorking = false; message = "Risposta tardiva non verificata. Verifica la chiusura."; return
        }
        retain(response)
        guard attemptId != nil || projection != nil else {
            phase = .blocked; isWorking = false; message = "Chiusura tardiva non verificata."; return
        }
        close(source)
    }
}
