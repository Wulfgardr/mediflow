/* @Codex — passive wire data, never session or clinical authority. */
import Foundation

public enum NativeOrdinaryContractError: Error, LocalizedError {
    case invalid, stale, cleanupUnconfirmed, noSources, loginPending
    public var errorDescription: String? {
        switch self {
        case .invalid: return "La risposta non corrisponde all’operazione richiesta. Nessuna proposta è stata applicata."
        case .stale: return "Il contesto è cambiato o è scaduto. Prepara una nuova proposta."
        case .cleanupUnconfirmed: return "La chiusura non è confermata. Non avviare un nuovo invio."
        case .loginPending: return "L’accesso OpenAI non è ancora completato. Termina l’accesso e verifica di nuovo."
        case .noSources: return "Non ci sono contenuti clinici leggibili per questa funzione."
        }
    }
}
/// Closed server codes allowed at the ordinary operation boundary. Host error text is never retained.
public enum NativeOrdinaryFailureCode: String, CaseIterable, Equatable, Sendable {
    case unqualifiedBoundary = "unqualified_boundary", sessionExpired = "session_expired"
    case notConnected = "not_connected", unsupportedAccount = "unsupported_account", busy, canceled, revoked
    case quotaExhausted = "quota_exhausted", limitsUnavailable = "limits_unavailable", catalogStale = "catalog_stale"
    case modelUnavailable = "model_unavailable", modelMismatch = "model_mismatch", invalidRequest = "invalid_request"
    case invalidOutput = "invalid_output", toolUseDenied = "tool_use_denied", timeout, processExited = "process_exited"
    case protocolError = "protocol_error", upstreamError = "upstream_error", preparationUnavailable = "preparation_unavailable", invalidState = "invalid_state", forbidden
    public var safeReason: String {
        switch self {
        case .unqualifiedBoundary: return "runtime locale non qualificato per questa operazione"
        case .sessionExpired: return "sessione o pairing non più validi"
        case .notConnected: return "accesso OpenAI non disponibile"
        case .unsupportedAccount: return "account OpenAI non supportato"
        case .busy: return "operazione già in corso"
        case .canceled: return "operazione annullata"
        case .revoked: return "contesto o autorizzazione non più correnti"
        case .quotaExhausted: return "limite di utilizzo raggiunto"
        case .limitsUnavailable: return "limiti di utilizzo non verificabili"
        case .catalogStale: return "catalogo non più corrente"
        case .modelUnavailable: return "modello non disponibile"
        case .modelMismatch: return "modello non coerente con l’opzione selezionata"
        case .invalidRequest: return "richiesta non valida"
        case .invalidOutput: return "risposta non verificata"
        case .toolUseDenied: return "strumento non ammesso"
        case .timeout: return "tempo di risposta scaduto"
        case .processExited: return "runtime terminato"
        case .protocolError: return "protocollo non verificato"
        case .upstreamError: return "esecuzione non disponibile"
        case .preparationUnavailable: return "preparazione locale non disponibile"
        case .invalidState: return "stato dell’operazione non valido"
        case .forbidden: return "operazione non autorizzata"
        }
    }
}
public struct NativeOrdinaryServerFailure: Error, Equatable, Sendable {
    public let status: Int
    public let code: NativeOrdinaryFailureCode
    public init(status: Int, code: NativeOrdinaryFailureCode) { self.status = status; self.code = code }
}
public enum NativeOrdinaryFunction: String, Codable, CaseIterable, Sendable {
    case patientInsight = "patient_insight", smartImport = "smart_import"
    case documentSynthesis = "document_synthesis", treatmentReasoning = "treatment_reasoning"
    public var title: String {
        switch self {
        case .patientInsight: return "Quadro paziente"
        case .smartImport: return "Smart Import"
        case .documentSynthesis: return "Sintesi del documento"
        case .treatmentReasoning: return "Ragionamento terapeutico"
        }
    }
}
/// Preserves the original function output rather than inventing a common clinical result.
public indirect enum NativeOrdinaryJSON: Codable, Equatable, Sendable {
    case object([String: NativeOrdinaryJSON]), array([NativeOrdinaryJSON]), string(String), number(Double), bool(Bool), null
    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null }
        else if let v = try? c.decode(Bool.self) { self = .bool(v) }
        else if let v = try? c.decode(String.self) { self = .string(v) }
        else if let v = try? c.decode(Double.self), v.isFinite { self = .number(v) }
        else if let v = try? c.decode([NativeOrdinaryJSON].self) { self = .array(v) }
        else { self = .object(try c.decode([String: NativeOrdinaryJSON].self)) }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .object(let v): try c.encode(v)
        case .array(let v): try c.encode(v)
        case .string(let v): try c.encode(v)
        case .number(let v): guard v.isFinite else { throw NativeOrdinaryContractError.invalid }; try c.encode(v)
        case .bool(let v): try c.encode(v)
        case .null: try c.encodeNil()
        }
    }
    public subscript(_ key: String) -> NativeOrdinaryJSON { if case .object(let v) = self { return v[key] ?? .null }; return .null }
    public var string: String? { if case .string(let v) = self { return v }; return nil }
    public var array: [NativeOrdinaryJSON] { if case .array(let v) = self { return v }; return [] }
    public var number: Double? { if case .number(let v) = self { return v }; return nil }
    public var bool: Bool? { if case .bool(let v) = self { return v }; return nil }
}
/// Closed selector input. Clinical text/projections cannot be represented here.
public enum NativeOrdinaryInput: Codable, Equatable, Sendable {
    case patientInsight, smartImport, treatmentReasoning
    case documentSynthesis(attachmentId: String)
    public var function: NativeOrdinaryFunction {
        switch self {
        case .patientInsight: return .patientInsight
        case .smartImport: return .smartImport
        case .treatmentReasoning: return .treatmentReasoning
        case .documentSynthesis: return .documentSynthesis
        }
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: NativeOrdinaryKey.self)
        let keys = Set(c.allKeys.map(\.stringValue))
        if keys == ["attachmentId"] {
            let id = try c.decode(String.self, forKey: .init("attachmentId"))
            guard nativeOrdinaryIdentifier(id, maximum: 200) else { throw NativeOrdinaryContractError.invalid }
            self = .documentSynthesis(attachmentId: id)
        } else if keys == ["selector"] {
            switch try c.decode(String.self, forKey: .init("selector")) {
            case "current_patient_insight": self = .patientInsight
            case "current_smart_import": self = .smartImport
            case "current_treatment_reasoning": self = .treatmentReasoning
            default: throw NativeOrdinaryContractError.invalid
            }
        } else { throw NativeOrdinaryContractError.invalid }
    }
    public func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: NativeOrdinaryKey.self)
        switch self {
        case .patientInsight: try c.encode("current_patient_insight", forKey: .init("selector"))
        case .smartImport: try c.encode("current_smart_import", forKey: .init("selector"))
        case .treatmentReasoning: try c.encode("current_treatment_reasoning", forKey: .init("selector"))
        case .documentSynthesis(let id):
            guard nativeOrdinaryIdentifier(id, maximum: 200) else { throw NativeOrdinaryContractError.invalid }
            try c.encode(id, forKey: .init("attachmentId"))
        }
    }
}
private struct NativeOrdinaryKey: CodingKey {
    let stringValue: String
    var intValue: Int? { nil }
    init(_ value: String) { stringValue = value }
    init?(stringValue: String) { self.init(stringValue) }
    init?(intValue: Int) { return nil }
}
// ECMAScript TrimString set, shared with the host parser (not Foundation's wider set).
private let nativeOrdinaryTrimCharacters = CharacterSet(charactersIn: "\u{0009}\u{000a}\u{000b}\u{000c}\u{000d}\u{0020}\u{00a0}\u{1680}\u{2000}\u{2001}\u{2002}\u{2003}\u{2004}\u{2005}\u{2006}\u{2007}\u{2008}\u{2009}\u{200a}\u{2028}\u{2029}\u{202f}\u{205f}\u{3000}\u{feff}")
private func nativeOrdinaryIdentifier(_ value: String, maximum: Int = 160) -> Bool {
    !value.isEmpty && value.utf16.count <= maximum && value == value.trimmingCharacters(in: nativeOrdinaryTrimCharacters)
        && !value.unicodeScalars.contains { $0.value < 32 || $0.value == 127 }
}
public struct NativeOrdinaryPreparation: Codable, Equatable, Sendable {
    public let functionId: NativeOrdinaryFunction
    public let patientId: String
    public let ambulatoryId: String
    public let patientRevision: Int
    public let input: NativeOrdinaryInput
    public init(functionId: NativeOrdinaryFunction, patientId: String, ambulatoryId: String, patientRevision: Int, input: NativeOrdinaryInput) {
        self.functionId = functionId; self.patientId = patientId; self.ambulatoryId = ambulatoryId
        self.patientRevision = patientRevision; self.input = input
    }
    public func validate() throws {
        guard functionId == input.function, nativeOrdinaryIdentifier(patientId), nativeOrdinaryIdentifier(ambulatoryId),
              patientRevision > 0, patientRevision <= 9_007_199_254_740_991 else { throw NativeOrdinaryContractError.invalid }
        if case .documentSynthesis(let id) = input, !nativeOrdinaryIdentifier(id, maximum: 200) { throw NativeOrdinaryContractError.invalid }
    }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: NativeOrdinaryKey.self)
        guard Set(c.allKeys.map(\.stringValue)) == ["functionId", "patientId", "ambulatoryId", "patientRevision", "input"]
        else { throw NativeOrdinaryContractError.invalid }
        functionId = try c.decode(NativeOrdinaryFunction.self, forKey: .init("functionId"))
        patientId = try c.decode(String.self, forKey: .init("patientId"))
        ambulatoryId = try c.decode(String.self, forKey: .init("ambulatoryId"))
        patientRevision = try c.decode(Int.self, forKey: .init("patientRevision"))
        input = try c.decode(NativeOrdinaryInput.self, forKey: .init("input"))
        try validate()
    }
    public func encode(to encoder: Encoder) throws {
        try validate()
        var c = encoder.container(keyedBy: NativeOrdinaryKey.self)
        try c.encode(functionId, forKey: .init("functionId")); try c.encode(patientId, forKey: .init("patientId"))
        try c.encode(ambulatoryId, forKey: .init("ambulatoryId")); try c.encode(patientRevision, forKey: .init("patientRevision"))
        try c.encode(input, forKey: .init("input"))
    }
}
public struct NativeOrdinaryDisclosure: Codable, Equatable, Sendable {
    public let schema, revision: String
    public let operation: NativeOrdinaryFunction
    public let profileVersion, contextRevision, attemptRevision, qualificationRevision: String
    public let sourceSha256, payloadSha256: String
    public let payloadBytes: Int
    public let egress: [String]
    public let proposalOnly: Bool
    public let clinicalWrites: Int
    public func validate(function: NativeOrdinaryFunction) throws {
        guard schema == "mediflow.chatgpt-ordinary-disclosure.v1", operation == function,
              UUID(uuidString: revision) != nil, profileVersion == "mediflow.ordinary-redacted-profile.v1",
              !contextRevision.isEmpty, !attemptRevision.isEmpty, !qualificationRevision.isEmpty,
              Self.matches(sourceSha256, "^sha256_[0-9a-f]{64}$"), Self.matches(payloadSha256, "^[0-9a-f]{64}$"),
              payloadBytes > 0, payloadBytes <= 2_000_000,
              egress == ["auth.openai.com:443", "chatgpt.com:443"], proposalOnly, clinicalWrites == 0
        else { throw NativeOrdinaryContractError.invalid }
    }
    static func matches(_ value: String, _ pattern: String) -> Bool { value.range(of: pattern, options: .regularExpression) != nil }
}
public struct NativeOrdinaryChallenge: Codable, Equatable, Sendable {
    public let verificationUrl, userCode: String
    public var safeURL: URL? {
        guard let u = URLComponents(string: verificationUrl), u.scheme == "https", u.user == nil, u.password == nil,
              u.port == nil || u.port == 443, let host = u.host,
              ["auth.openai.com", "chatgpt.com"].contains(host), !userCode.isEmpty, userCode.count <= 128 else { return nil }
        return u.url
    }
}
public struct NativeOrdinaryCatalog: Codable, Equatable, Sendable {
    public struct Choice: Codable, Equatable, Identifiable, Sendable {
        public let optionId, model, effort: String
        public var id: String { optionId }
        public var label: String {
            let names = ["none": "senza ragionamento", "minimal": "minimo", "low": "basso", "medium": "medio",
                         "high": "alto", "xhigh": "molto alto", "max": "massimo", "ultra": "ultra"]
            return "\(model) — \(names[effort] ?? effort)"
        }
    }
    public let revision: String
    public let choices: [Choice]
    public func validate() throws {
        guard UUID(uuidString: revision) != nil, !choices.isEmpty, choices.count <= 512,
              Set(choices.map(\.optionId)).count == choices.count,
              choices.allSatisfy({ UUID(uuidString: $0.optionId) != nil && !$0.model.isEmpty && $0.model.count <= 256 &&
                  ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"].contains($0.effort) })
        else { throw NativeOrdinaryContractError.invalid }
    }
}
public struct NativeOrdinaryResponse: Decodable, Sendable {
    public let schema, phase: String
    public let attemptId: String?
    public let functionId: NativeOrdinaryFunction?
    public let expiresAt: Double?
    public let cleanupConfirmed: Bool?
    public let disclosure: NativeOrdinaryDisclosure?
    public let challenge: NativeOrdinaryChallenge?
    public let catalog: NativeOrdinaryCatalog?
    public let result: NativeOrdinaryJSON?
    public func validate(function: NativeOrdinaryFunction, attempt: String? = nil, now: Date = Date()) throws {
        if phase == "closed" {
            guard schema == "mediflow.chatgpt-ordinary-flow.v1", result == nil,
                  functionId == nil || functionId == function,
                  attemptId == nil || attemptId == attempt else { throw NativeOrdinaryContractError.invalid }
            guard cleanupConfirmed == true else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
            return
        }
        guard functionId == function, let id = attemptId, UUID(uuidString: id) != nil,
              attempt == nil || id == attempt else { throw NativeOrdinaryContractError.invalid }
        if phase == "completed" {
            guard schema == "mediflow.native-ordinary.v1", cleanupConfirmed == true, result != nil,
                  challenge == nil, catalog == nil, disclosure == nil else { throw NativeOrdinaryContractError.invalid }
            return
        }
        guard schema == "mediflow.chatgpt-ordinary-flow.v1", result == nil,
              ["needs_consent", "consented", "awaiting_login", "connected", "ready", "generating"].contains(phase),
              let expiry = expiresAt, expiry.isFinite, expiry > now.timeIntervalSince1970 * 1000
        else { throw NativeOrdinaryContractError.stale }
        if phase == "needs_consent" { guard let disclosure else { throw NativeOrdinaryContractError.invalid }; try disclosure.validate(function: function) }
        if let challenge { guard phase == "awaiting_login", challenge.safeURL != nil else { throw NativeOrdinaryContractError.invalid } }
        if let catalog { guard phase == "ready" else { throw NativeOrdinaryContractError.invalid }; try catalog.validate() }
    }
    /// A data consistency check only. The host owner remains the sole publication authority.
    public func validatedProposal(function: NativeOrdinaryFunction, attempt: String, disclosure: NativeOrdinaryDisclosure,
                                  choice: NativeOrdinaryCatalog.Choice) throws -> NativeOrdinaryJSON {
        try validate(function: function, attempt: attempt)
        guard phase == "completed", let result else { throw NativeOrdinaryContractError.invalid }
        let receipt: NativeOrdinaryJSON
        switch function {
        case .patientInsight:
            let preview = result["preview"]
            guard preview["status"].string == "available", preview["writesPerformed"].number == 0,
                  preview["apply"].string == "denied", preview["proposal"]["reviewOnly"].bool == true,
                  preview["proposal"]["schemaVersion"].string == "mediflow.patient-insight.review-proposal.v2"
            else { throw NativeOrdinaryContractError.invalid }
            receipt = preview["receipt"]
        case .smartImport:
            let preview = result["preview"]
            guard preview["status"].string == "available", preview["writesPerformed"].number == 0,
                  preview["apply"].string == "denied", preview["proposal"]["writesPerformed"].number == 0,
                  preview["proposal"]["schemaVersion"].string == "mediflow.smart-import.proposal.v1"
            else { throw NativeOrdinaryContractError.invalid }
            receipt = preview["receipt"]
        case .treatmentReasoning:
            guard result["schemaVersion"].string == "mediflow.ai.treatment-reasoning-publication.chatgpt.v1",
                  result["status"].string == "available", result["writesPerformed"].number == 0,
                  result["applyPolicy"].string == "none", result["review"].string == "required"
            else { throw NativeOrdinaryContractError.invalid }
            receipt = result["fabricReceipt"]
        case .documentSynthesis:
            let publication = result["publication"], publicationReceipt = publication["receipt"]
            guard result["schemaVersion"].string == "mediflow.document-synthesis.preview-wire.v1",
                  result["status"].string == "available", publicationReceipt["reviewOnly"].bool == true,
                  publicationReceipt["applyPolicy"].string == "none", publicationReceipt["writesPerformed"].number == 0,
                  !publication["citations"].array.isEmpty else { throw NativeOrdinaryContractError.invalid }
            receipt = publicationReceipt["providerBindingReceipt"]
        }
        guard receipt["schemaVersion"].string == "mediflow.ai.chatgpt-receipt.v1",
              receipt["capability"].string == function.rawValue, receipt["provider"].string == "chatgpt_subscription",
              receipt["venue"].string == "cloud", receipt["model"].string == choice.model, receipt["effort"].string == choice.effort,
              receipt["egress"].string == "redacted_explicit_consent", receipt["fallback"].string == "none",
              receipt["retention"].string == "chatgpt_service_terms_apply",
              receipt["sourceSha256"].string == disclosure.sourceSha256, receipt["payloadSha256"].string == disclosure.payloadSha256,
              NativeOrdinaryDisclosure.matches(receipt["outputSha256"].string ?? "", "^[0-9a-f]{64}$")
        else { throw NativeOrdinaryContractError.invalid }
        return result
    }
}
public enum NativeOrdinaryCommand: Sendable {
    case consent(attemptId: String, disclosureRevision: String)
    case loginStart(attemptId: String), loginComplete(attemptId: String), models(attemptId: String)
    case generate(attemptId: String, optionId: String, catalogRevision: String)
    case cancel(attemptId: String)
    public var path: String {
        switch self { case .consent: return "consent"; case .loginStart: return "login/start"; case .loginComplete: return "login/complete"
        case .models: return "models"; case .generate: return "generate"; case .cancel: return "cancel" }
    }
    public var body: NativeOrdinaryJSON {
        switch self {
        case .consent(let id, let revision): return .object(["attemptId": .string(id), "expectedDisclosureRevision": .string(revision)])
        case .loginStart(let id), .loginComplete(let id), .models(let id), .cancel(let id): return .object(["attemptId": .string(id)])
        case .generate(let id, let option, let revision): return .object(["attemptId": .string(id), "modelOptionId": .string(option), "expectedCatalogRevision": .string(revision)])
        }
    }
}
