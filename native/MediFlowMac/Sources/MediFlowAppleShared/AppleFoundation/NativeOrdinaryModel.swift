/* @Codex — Mac-only, explicit consent/login/catalog/turn; never auto-apply. */
#if os(macOS)
import Foundation
import Combine
import MediFlowCore

@MainActor
final class NativeOrdinaryModel: ObservableObject {
    enum Phase: Equatable { case idle, preparing, needsConsent, consented, awaitingLogin, connected, ready, generating, completed, closing, blocked }
    @Published private(set) var phase: Phase = .idle
    @Published private(set) var message = "Prepara una proposta da rivedere: nessuna modifica alla cartella."
    @Published private(set) var disclosure: NativeOrdinaryDisclosure?
    @Published private(set) var challenge: NativeOrdinaryChallenge?
    @Published private(set) var catalog: NativeOrdinaryCatalog?
    @Published private(set) var proposal: NativeOrdinaryJSON?
    @Published var selectedOptionId = ""
    @Published private(set) var isWorking = false
    private(set) var attemptId: String?
    private var pendingProjection: NativeOrdinaryProjectionPlan?
    private var preparationInFlight = false
    private var original: NativeOrdinarySnapshot?
    private var generation: UInt = 0
    private var task: Task<Void, Never>?
    private var expiryTask: Task<Void, Never>?
    private var expiry: Double = .infinity
    private var subscriptions = Set<AnyCancellable>()
    private let function: NativeOrdinaryFunction
    private let snapshot: () throws -> NativeOrdinarySnapshot
    struct Services {
        var prepare: (NativeOrdinaryPreparation, ClinicalWorkspaceConnection) async throws -> NativeOrdinaryResponse
        var command: (NativeOrdinaryCommand, ClinicalWorkspaceConnection) async throws -> NativeOrdinaryResponse
        var status: (ClinicalWorkspaceConnection) async throws -> NativeOrdinaryResponse
        var project: (NativeOrdinaryProjectionPlan, NativeOrdinaryPreparation, NativeOrdinaryProjectionIO) async throws -> NativeOrdinaryResponse = { _, _, _ in throw NativeOrdinaryContractError.invalid }
        var cancelProjection: (NativeOrdinaryProjectionPlan, ClinicalWorkspaceConnection) async throws -> NativeOrdinaryResponse = { _, _ in throw NativeOrdinaryContractError.cleanupUnconfirmed }
        static let live = Services(prepare: { preparation, connection in
            try await client(connection).prepareNativeOrdinary(preparation, credentials: connection.credentials, sessionCookie: connection.sessionCookie)
        }, command: { command, connection in
            try await client(connection).commandNativeOrdinary(command, credentials: connection.credentials,
                sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId)
        }, status: { connection in
            try await client(connection).statusNativeOrdinary(credentials: connection.credentials,
                sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId)
        }, project: { plan, preparation, io in
            try await NativeOrdinaryProjectionClient.project(plan, preparation: preparation, io: io)
        }, cancelProjection: { plan, connection in
            try await client(connection).cancelNativeOrdinaryProjection(plan, credentials: connection.credentials,
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
    /// Event invalidation prevents A -> B -> A resurrection, even between two awaits.
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
        guard !isWorking, !preparationInFlight, phase == .idle || phase == .completed else { return }
        do {
            let source = try snapshot(); generation &+= 1; let epoch = generation
            original = source; attemptId = nil; pendingProjection = nil; expiry = .infinity; proposal = nil; disclosure = nil; challenge = nil; catalog = nil
            phase = .preparing; isWorking = true; message = "Preparazione locale e verifica dei contenuti… Nessun invio a OpenAI."
            preparationInFlight = true
            task = Task {
                defer { preparationInFlight = false }
                do {
                    var value = try await services.prepare(source.preparation, source.connection)
                    // A late prepare may require cleanup, but never disclosure or result publication.
                    guard current(epoch, source) else {
                        await retireLate(value, source: source)
                        if generation == epoch { invalidate() }
                        return
                    }
                    if value.functionId == function, let id = value.attemptId, UUID(uuidString: id) != nil { attemptId = id }
                    if value.functionId == function, let plan = value.sourceProjection,
                       NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$") { pendingProjection = plan }
                    try value.validate(function: function)
                    if value.phase == "needs_source_projection" {
                        guard let plan = value.sourceProjection else { throw NativeOrdinaryContractError.invalid }
                        // Retain the authentic descriptive handle before the next suspension, including failures.
                        pendingProjection = plan
                        try plan.validate(preparation: source.preparation)
                        applyExpiry(plan.expiresAt)
                        message = "Lettura e decifratura locale delle fonti selezionate… Nessun invio a OpenAI."
                        let io = NativeOrdinaryProjectionIO(current: { [weak self] in
                            guard let self, self.current(epoch, source) else { throw NativeOrdinaryContractError.stale }
                            let fresh = try self.snapshot()
                            guard fresh.connection.masterKey != nil else { throw NativeOrdinaryContractError.stale }
                            return fresh.connection
                        }, willSubmit: { [weak self] in
                            guard let self, self.current(epoch, source) else { throw NativeOrdinaryContractError.stale }
                            // The server still owns its 30s grant / 120s processing deadlines.
                            self.expiry = .infinity; self.expiryTask?.cancel()
                            self.applyExpiry(Date().timeIntervalSince1970 * 1000 + 120_000)
                        })
                        value = try await services.project(plan, source.preparation, io)
                        guard current(epoch, source), (try? snapshot().connection.masterKey) != nil else {
                            await retireLate(value, source: source)
                            if generation == epoch { invalidate() }
                            return
                        }
                        if value.functionId == function, let id = value.attemptId, UUID(uuidString: id) != nil { attemptId = id }
                        try value.validate(function: function)
                        guard value.acquisition?.origin == "authenticated_client_decryption",
                              value.acquisition?.ciphertextEquality == "not_attested" else { throw NativeOrdinaryContractError.invalid }
                    }
                    guard value.phase == "needs_consent", let id = value.attemptId else { throw NativeOrdinaryContractError.invalid }
                    pendingProjection = nil; expiry = .infinity; expiryTask?.cancel()
                    attemptId = id; disclosure = value.disclosure; applyExpiry(value.expiresAt)
                    phase = .needsConsent; isWorking = false; message = "Contenuti preparati. Leggi l’informativa prima di autorizzare l’invio."
                } catch { if generation == epoch { await failAndClose(error, source: source) } }
            }
        } catch { message = (error as? LocalizedError)?.errorDescription ?? "Apri una cartella online con contenuti leggibili." }
    }
    func consent() { guard phase == .needsConsent, let id = attemptId, let disclosure else { return }; run(.consent(attemptId: id, disclosureRevision: disclosure.revision), expected: "consented") }
    func startLogin() { guard phase == .consented, let id = attemptId else { return }; run(.loginStart(attemptId: id), expected: "awaiting_login") }
    func completeLogin() { guard phase == .awaitingLogin, let id = attemptId else { return }; run(.loginComplete(attemptId: id), expected: "connected") }
    func loadModels() { guard phase == .connected || phase == .ready, let id = attemptId else { return }; run(.models(attemptId: id), expected: "ready") }
    func generate() {
        guard phase == .ready, let id = attemptId, let catalog, catalog.choices.contains(where: { $0.optionId == selectedOptionId }) else { return }
        run(.generate(attemptId: id, optionId: selectedOptionId, catalogRevision: catalog.revision), expected: "completed")
    }
    private func run(_ command: NativeOrdinaryCommand, expected: String) {
        guard !isWorking, let source = original, let id = attemptId, current(generation, source) else { invalidate(); return }
        let epoch = generation
        let selected = catalog?.choices.first { $0.optionId == selectedOptionId }
        isWorking = true
        if expected == "completed" { phase = .generating; message = "Proposta in elaborazione. Attendo anche la chiusura verificata." }
        task = Task {
            do {
                let value = try await services.command(command, source.connection)
                guard current(epoch, source) else {
                    if generation == epoch { invalidate() }
                    return
                }
                try value.validate(function: function, attempt: id)
                guard value.phase == expected else { throw NativeOrdinaryContractError.invalid }
                applyExpiry(value.expiresAt)
                switch expected {
                case "consented": phase = .consented; message = "Consenso acquisito per questi contenuti. Ora accedi a OpenAI per questa operazione."
                case "awaiting_login":
                    guard let valueChallenge = value.challenge, valueChallenge.safeURL != nil else { throw NativeOrdinaryContractError.invalid }
                    challenge = valueChallenge; phase = .awaitingLogin; message = "Completa l’accesso nella pagina dedicata, poi verifica qui."
                case "connected": challenge = nil; phase = .connected; message = "Accesso verificato. Leggi i modelli disponibili per questa operazione."
                case "ready":
                    guard let choices = value.catalog else { throw NativeOrdinaryContractError.invalid }; try choices.validate()
                    catalog = choices; selectedOptionId = ""; phase = .ready; message = "Scegli modello e livello di ragionamento, poi genera la proposta."
                case "completed":
                    guard let disclosure, let selected else { throw NativeOrdinaryContractError.invalid }
                    proposal = try value.validatedProposal(function: function, attempt: id, disclosure: disclosure, choice: selected)
                    phase = .completed; attemptId = nil; expiryTask?.cancel(); expiryTask = nil
                    challenge = nil; catalog = nil; message = "Proposta da verificare. Nessun dato clinico salvato; sessione di esecuzione chiusa."
                default: throw NativeOrdinaryContractError.invalid
                }
                isWorking = false
            } catch {
                if let pending = error as? NativeOrdinaryContractError, case .loginPending = pending,
                   expected == "connected", phase == .awaitingLogin, current(epoch, source) {
                    isWorking = false; message = pending.errorDescription ?? "Completa l’accesso, poi verifica di nuovo."; return
                }
                if generation == epoch { await failAndClose(error, source: source) }
            }
        }
    }
    private func applyExpiry(_ value: Double?) {
        guard let value else { return }; expiry = min(expiry, value); expiryTask?.cancel()
        let delay = max(0, min(86_400, (expiry / 1000) - Date().timeIntervalSince1970))
        expiryTask = Task { try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000)); if !Task.isCancelled { invalidate() } }
    }
    func invalidate() {
        proposal = nil
        guard phase != .closing else { return }
        generation &+= 1; task?.cancel(); expiryTask?.cancel(); challenge = nil; catalog = nil; disclosure = nil
        guard let source = original, phase != .completed, phase != .idle else {
            original = nil; attemptId = nil; pendingProjection = nil; phase = .idle; isWorking = false
            message = "Il contesto è cambiato. Prepara una nuova proposta."; return
        }
        close(source: source)
    }
    func cancel() { invalidate() }
    func verifyClosure() { guard !isWorking, phase == .blocked, let source = original else { return }; close(source: source) }
    private func close(source: NativeOrdinarySnapshot, closedMessage: String? = nil) {
        let id = attemptId, projection = pendingProjection, epoch = generation
        phase = .closing; isWorking = true; message = "Chiusura dell’operazione in corso…"
        task = Task {
            do {
                let value: NativeOrdinaryResponse
                if let id { value = try await services.command(.cancel(attemptId: id), source.connection) }
                else if let projection { value = try await services.cancelProjection(projection, source.connection) }
                else { value = try await services.status(source.connection) }
                guard generation == epoch else { return }
                try value.validate(function: function, attempt: id)
                guard value.phase == "closed", value.cleanupConfirmed == true else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
                attemptId = nil; pendingProjection = nil; original = nil; expiry = .infinity; isWorking = false; phase = .idle
                message = closedMessage ?? "Operazione chiusa. Nessuna modifica alla cartella."
            } catch {
                guard generation == epoch else { return }
                isWorking = false; phase = .blocked
                message = "Chiusura non confermata. Verifica la chiusura; non è stato avviato un altro invio."
            }
        }
    }
    private func failAndClose(_ error: Error, source: NativeOrdinarySnapshot) async {
        proposal = nil; challenge = nil; catalog = nil; disclosure = nil; generation &+= 1; expiryTask?.cancel()
        // Reconcile only this retained attempt; an unknown active operation is never cancelled.
        close(source: source, closedMessage: failureMessage(error))
    }
    /// The host error payload is not operator-safe diagnostic content.
    private func failureMessage(_ error: Error) -> String {
        let reason: String
        switch error {
        case let failure as NativeOrdinaryServerFailure:
            let reason = failure.code == .upstreamError && phase == .preparing ? "preparazione locale non disponibile" : failure.code.safeReason
            return "Operazione non completata (\(failure.code.rawValue)): \(reason). Operazione chiusa; nessuna modifica alla cartella."
        case HomeBaseClientError.httpStatus(let status, _):
            switch status {
            case 401: reason = "sessione o pairing non più validi"
            case 403: reason = "operazione non autorizzata"
            case 409: reason = "contesto o operazione non più correnti"
            case 429: reason = "servizio temporaneamente non disponibile"
            default: reason = "servizio non disponibile o risposta non verificata"
            }
            return "Operazione non completata (HTTP \(status)): \(reason). Operazione chiusa; nessuna modifica alla cartella."
        case NativeOrdinaryContractError.invalid:
            reason = "risposta non verificata"
        case NativeOrdinaryContractError.stale:
            reason = "contesto scaduto o modificato"
        case NativeOrdinaryContractError.noSources:
            reason = "nessun contenuto clinico leggibile"
        case NativeOrdinaryContractError.loginPending:
            reason = "accesso non completato"
        case NativeOrdinaryContractError.cleanupUnconfirmed:
            reason = "chiusura non confermata"
        case HomeBaseClientError.transport(let issue):
            switch issue {
            case .tlsHandshakeFailed: reason = "verifica TLS non riuscita"
            case .unreachable: reason = "host non raggiungibile"
            case .timeout: reason = "tempo di risposta scaduto"
            case .other: reason = "trasporto non disponibile"
            }
        default:
            reason = "errore locale o risposta non verificata"
        }
        return "Operazione non completata: \(reason). Operazione chiusa; nessuna modifica alla cartella."
    }
    private func retireLate(_ value: NativeOrdinaryResponse, source: NativeOrdinarySnapshot) async {
        // A late response must not turn failed cleanup into an idle/restartable model.
        // Retain the exact old connection/handle; generation invalidates any concurrent status cleanup.
        generation &+= 1; expiryTask?.cancel(); original = source
        proposal = nil; disclosure = nil; challenge = nil; catalog = nil
        guard value.functionId == function else {
            phase = .blocked; isWorking = false
            message = "Risposta tardiva non verificata. Verifica la chiusura prima di riprovare."
            return
        }
        let id = value.attemptId.flatMap { UUID(uuidString: $0) == nil ? nil : $0 }
        let plan = value.sourceProjection.flatMap { $0.functionId == function && NativeOrdinaryDisclosure.matches($0.grantId, "^[a-f0-9]{64}$") ? $0 : nil }
        attemptId = id; pendingProjection = plan; phase = .closing; isWorking = true
        let services = services
        do {
            // An unstructured cleanup task does not inherit the canceled preparation task.
            let closed = try await Task { () throws -> NativeOrdinaryResponse in
                if let id { return try await services.command(.cancel(attemptId: id), source.connection) }
                if let plan { return try await services.cancelProjection(plan, source.connection) }
                throw NativeOrdinaryContractError.cleanupUnconfirmed
            }.value
            try closed.validate(function: function, attempt: id)
            guard closed.phase == "closed", closed.cleanupConfirmed == true else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
            attemptId = nil; pendingProjection = nil; original = nil; expiry = .infinity
            isWorking = false; phase = .idle; message = "Operazione tardiva chiusa. Nessuna modifica alla cartella."
        } catch {
            isWorking = false; phase = .blocked
            message = "Chiusura tardiva non confermata. Verifica la chiusura; nessun nuovo invio è consentito."
        }
    }
}
#endif
