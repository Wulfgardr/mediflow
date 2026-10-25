import Foundation

public struct NativeFabricFailure: Error, Sendable {
    public enum Code: String, Sendable {
        case functionDisabled = "function_disabled", providerUnavailable = "provider_unavailable", bindingStale = "binding_stale"
        case catalogStale = "catalog_stale", sessionExpired = "session_expired", revoked, unavailable
        var message: String {
            switch self {
            case .functionDisabled: return "Funzione disabilitata sull’host."
            case .providerUnavailable, .unavailable: return "Esecuzione locale non disponibile sull’host."
            case .bindingStale, .catalogStale: return "Le impostazioni del modello sono cambiate. Prepara una nuova proposta."
            case .sessionExpired, .revoked: return "Sessione, fonti o contesto non più correnti."
            }
        }
    }
    public let status: Int
    public let code: Code
}
public enum NativeFabricCommand: Sendable {
    case generate(String), cancel(String)
    public var attemptId: String { switch self { case .generate(let id), .cancel(let id): return id } }
    public var path: String { switch self { case .generate: return "generate"; case .cancel: return "cancel" } }
}
public struct NativeFabricSelection: Decodable, Equatable, Sendable {
    public let modelOptionId, catalogRevision, preferenceRevision, source, provider, model, venue, fallback: String
    func validate(function: NativeOrdinaryFunction) throws {
        guard NativeOrdinaryDisclosure.matches(modelOptionId, "^model_option_[a-f0-9]{32}$"),
              NativeOrdinaryDisclosure.matches(catalogRevision, "^sha256_[a-f0-9]{64}$"),
              NativeOrdinaryDisclosure.matches(preferenceRevision, "^sha256_[a-f0-9]{64}$"),
              ["saved_preference", "host_configuration"].contains(source), venue == "local", fallback == "none",
              !model.isEmpty, model.count <= 256,
              function == .treatmentReasoning ? ["athena_mlx", "athena_transformers"].contains(provider) : provider == "ollama"
        else { throw NativeOrdinaryContractError.invalid }
    }
}
public struct NativeFabricResponse: Decodable, Sendable {
    public let schema, phase: String
    public let attemptId: String?
    public let functionId: NativeOrdinaryFunction?
    public let expiresAt: Double?
    public let cleanupConfirmed: Bool?
    public let sourceProjection: NativeOrdinaryProjectionPlan?
    public let selection: NativeFabricSelection?
    public let result: NativeOrdinaryJSON?
    public let clinicalWrites: Int?
    public let apply: String?
    public func validate(function: NativeOrdinaryFunction, attempt: String? = nil, now: Date = Date()) throws {
        guard schema == "mediflow.native-fabric.v1" else { throw NativeOrdinaryContractError.invalid }
        if phase == "closed" {
            guard cleanupConfirmed == true, result == nil, sourceProjection == nil,
                  attemptId == nil || attemptId == attempt else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
            return
        }
        guard functionId == function, let expiresAt, expiresAt.isFinite, expiresAt > now.timeIntervalSince1970 * 1000 else { throw NativeOrdinaryContractError.stale }
        if phase == "needs_source_projection" {
            guard attempt == nil, attemptId == nil, selection == nil, result == nil, let sourceProjection,
                  sourceProjection.functionId == function, sourceProjection.expiresAt == expiresAt else { throw NativeOrdinaryContractError.invalid }
            return
        }
        guard ["ready", "completed", "current"].contains(phase), sourceProjection == nil,
              let attemptId, UUID(uuidString: attemptId) != nil, attempt == nil || attemptId == attempt,
              let selection else { throw NativeOrdinaryContractError.invalid }
        try selection.validate(function: function)
        if phase == "completed" {
            guard clinicalWrites == 0, apply == "denied", result != nil else { throw NativeOrdinaryContractError.invalid }
        } else if result != nil { throw NativeOrdinaryContractError.invalid }
    }
    public func validatedProposal(function: NativeOrdinaryFunction, attempt: String, expected: NativeFabricSelection) throws -> NativeOrdinaryJSON {
        try validate(function: function, attempt: attempt)
        guard phase == "completed", selection == expected, let result else { throw NativeOrdinaryContractError.invalid }
        let receipt: NativeOrdinaryJSON
        switch function {
        case .patientInsight, .smartImport:
            let preview = result["preview"]
            guard preview["status"].string == "available", preview["writesPerformed"].number == 0,
                  preview["apply"].string == "denied", preview["provenance"]["provider"].string == expected.provider,
                  function == .patientInsight ? preview["proposal"]["reviewOnly"].bool == true : preview["proposal"]["writesPerformed"].number == 0
            else { throw NativeOrdinaryContractError.invalid }
            receipt = preview["receipt"]
        case .treatmentReasoning:
            guard ["mediflow.ai.treatment-reasoning-publication.v1", "mediflow.ai.treatment-reasoning-publication.v2"].contains(result["schemaVersion"].string ?? ""),
                  result["status"].string == "available", result["writesPerformed"].number == 0,
                  result["applyPolicy"].string == "none", result["review"].string == "required"
            else { throw NativeOrdinaryContractError.invalid }
            receipt = result["fabricReceipt"]
        case .documentSynthesis:
            let publication = result["publication"], publicationReceipt = publication["receipt"]
            guard result["status"].string == "available", publicationReceipt["reviewOnly"].bool == true,
                  publicationReceipt["applyPolicy"].string == "none", publicationReceipt["writesPerformed"].number == 0,
                  !publication["citations"].array.isEmpty else { throw NativeOrdinaryContractError.invalid }
            receipt = publication["provenance"]["fabricProvenance"]["receipt"]
        }
        guard receipt["capability"].string == function.rawValue, receipt["venue"].string == "local_process",
              receipt["provider"].string == expected.provider,
              expected.provider == "athena_mlx" ? receipt["model"] == .null : receipt["model"].string == expected.model,
              function == .patientInsight ? receipt["egress"].string == "none" :
                (receipt["egressProfile"]["egress"].string == "none" && receipt["fallbackCount"].number == 0)
        else { throw NativeOrdinaryContractError.invalid }
        return result
    }
}
