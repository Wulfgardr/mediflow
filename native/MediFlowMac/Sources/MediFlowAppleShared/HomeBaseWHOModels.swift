// @Codex: WUL-673. WHO-only DTOs; no transport, persistence or patient mutation.
import Foundation

public enum HomeBaseWHOError: Error, LocalizedError, Equatable, Sendable {
    case unsupported, invalidRequest, unauthorized, forbidden, networkModeDisabled
    case releaseNotSupported, unavailable, upstreamResponseInvalid, upstreamTimeout, invalidResponse

    public var errorDescription: String? {
        switch self {
        case .unsupported:
            return "WHO non è disponibile tramite questo datasource. Usa una connessione paired all’home-base configurata dal responsabile dell’host. Nessun repertorio alternativo viene usato."
        case .invalidRequest:
            return "Inserisci una ricerca specifica (massimo 160 byte UTF-8) o un codice ICD-11 valido (massimo 32 caratteri)."
        case .unauthorized:
            return "La sessione o il pairing non sono più validi. Ricollega l’home-base e accedi nuovamente prima di riprovare."
        case .forbidden:
            return "Consultazione non autorizzata per questo dispositivo o ambulatorio. Verifica accesso e ambulatorio con il responsabile dell’host."
        case .networkModeDisabled:
            return "La modalità home-base non è attiva sull’host. È necessario l’intervento del responsabile dell’host."
        case .releaseNotSupported:
            return "Il servizio richiede ICD-11 WHO, release 2026-01, lingua inglese. Verifica la versione dell’home-base."
        case .unavailable:
            return "Il servizio WHO non è disponibile. Verifica il servizio sull’home-base; per la ricerca prova anche termini più specifici. Nessun avvio o fallback automatico."
        case .upstreamResponseInvalid:
            return "Risposta WHO non valida o oltre il limite consentito. Restringi la ricerca oppure verifica il servizio sull’home-base."
        case .upstreamTimeout:
            return "Il servizio WHO non ha risposto entro il limite. Verifica il servizio e riprova manualmente."
        case .invalidResponse:
            return "Risposta WHO non compatibile o provenienza non valida. Nessun risultato è stato mostrato. Verifica la versione e il servizio dell’home-base."
        }
    }
}

public enum HomeBaseWHOSource: String, Decodable, Equatable, Sendable { case live, cache }
public enum HomeBaseWHOReadinessStatus: String, Decodable, Equatable, Sendable {
    case disabled, configurationRequired = "configuration_required", configured, available, unavailable
}
public enum HomeBaseWHOCheckStatus: String, Decodable, Equatable, Sendable { case found, notFound = "not_found" }

public struct HomeBaseWHOEntry: Decodable, Equatable, Identifiable, Sendable {
    public let code: String
    public let description: String
    public let system: String
    public let canonicalUri: String
    public var id: String { code }
}
public struct HomeBaseWHOSearchReceipt: Decodable, Equatable, Sendable {
    public let schemaVersion: String
    public let operation: String
    public let releaseId: String
    public let language: String
    public let deployment: String
    public let bindingId: String
    public let imageDigest: String
    public let datasetSnapshotId: String
    public let source: HomeBaseWHOSource
    public let resultCount: Int
    public let latencyMs: Int
    public let fetchedAt: String
    public let expiresAt: String
    public let completedAt: String
}
public struct HomeBaseWHOSearchResponse: Decodable, Equatable, Sendable {
    public let schemaVersion: String
    public let entries: [HomeBaseWHOEntry]
    public let partial: Bool
    public let receipt: HomeBaseWHOSearchReceipt
}
public struct HomeBaseWHOReadiness: Decodable, Equatable, Sendable {
    public let schemaVersion: String
    public let status: HomeBaseWHOReadinessStatus
    public let releaseId: String
    public let language: String
    public let deployment: String
    public let bindingId: String
    public let imageDigest: String?
    public let datasetSnapshotId: String?
    public let lastLiveObservedAt: String?
    public let lastResultSource: HomeBaseWHOSource?
}
public struct HomeBaseWHOCheckedCode: Decodable, Equatable, Sendable {
    public let canonicalUri: String
    public let stemUri: String
    public let stemCode: String
    public let stemTitle: String
}
public struct HomeBaseWHOCodeCheckReceipt: Decodable, Equatable, Sendable {
    public let schemaVersion: String
    public let operation: String
    public let releaseId: String
    public let language: String
    public let bindingId: String
    public let imageDigest: String
    public let datasetSnapshotId: String
    public let source: HomeBaseWHOSource
    public let found: Bool
    public let checkedAt: String
    public let latencyMs: Int
}
public struct HomeBaseWHOCodeCheckResponse: Decodable, Equatable, Sendable {
    public let schemaVersion: String
    public let code: String
    public let status: HomeBaseWHOCheckStatus
    public let entry: HomeBaseWHOCheckedCode?
    public let receipt: HomeBaseWHOCodeCheckReceipt
}

/// Mirrors the named canonical local WHO parsers; nothing is flattened into
/// HomeBaseTerminologyItem. Unknown keys/enum values and missing null keys fail.
public enum HomeBaseWHODecoder {
    public static let release = "2026-01"
    public static let language = "en"
    public static let binding = "who.icd11.v2.2026-01.mms.en.local.v1"
    public static let maximumBytes = 65_536
    public static let attribution = "ICD-11 — World Health Organization (WHO), CC BY-ND 3.0 IGO"
    private static let mms = "http://id.who.int/icd/release/11/2026-01/mms/"
    private static let referenceKeys = ["releaseId", "language", "bindingId", "imageDigest", "datasetSnapshotId"]

    public static func normalizedQuery(_ input: String) throws -> String {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        guard !value.isEmpty, value.utf8.count <= 160,
              !contains(value, #"[\x{0000}-\x{001f}\x{007f}<>\x{202a}-\x{202e}\x{2066}-\x{2069}]"#)
        else { throw HomeBaseWHOError.invalidRequest }
        return value
    }
    public static func isCheckCode(_ code: String) -> Bool {
        code.utf8.count <= 32 && code != "N/A"
            && matches(code, #"^[A-Z0-9][A-Z0-9.-]*(?:[&/][A-Z0-9][A-Z0-9.-]*)*$"#)
    }
    private static func codeInfoURI(_ code: String) -> String {
        mms + "codeinfo/" + code.replacingOccurrences(of: "&", with: "%26").replacingOccurrences(of: "/", with: "%2F")
    }
    private static func stemURI(_ uri: String) -> Bool {
        uri.hasPrefix(mms) && matches(String(uri.dropFirst(mms.count)), #"^[1-9][0-9]{0,19}(?:/(?:other|unspecified))?$"#)
    }
    private static func canonicalURI(_ uri: String, code: String) -> Bool {
        code.contains("&") || code.contains("/") ? uri == codeInfoURI(code) : stemURI(uri)
    }
    private static func matches(_ value: String, _ pattern: String) -> Bool {
        guard let range = value.range(of: pattern, options: .regularExpression) else { return false }
        return range == value.startIndex..<value.endIndex
    }
    private static func contains(_ value: String, _ pattern: String) -> Bool {
        value.range(of: pattern, options: .regularExpression) != nil
    }
    private static func title(_ value: String) -> Bool {
        !value.isEmpty && value.utf16.count <= 4096
            && value == value.trimmingCharacters(in: .whitespacesAndNewlines)
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            && !contains(value, #"[\x{0000}-\x{001f}\x{007f}<>\x{061c}\x{200e}\x{200f}\x{202a}-\x{202e}\x{2066}-\x{2069}]"#)
    }
    private static func digest(_ value: String) -> Bool { matches(value, "^sha256:[a-f0-9]{64}$") }
    private static func nonnegative(_ value: Int) -> Bool { value >= 0 && value <= 9_007_199_254_740_991 }
    private static func milliseconds(_ value: String) throws -> Int64 {
        guard matches(value, #"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$"#) else { throw HomeBaseWHOError.invalidResponse }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: value), formatter.string(from: date) == value else { throw HomeBaseWHOError.invalidResponse }
        return Int64((date.timeIntervalSince1970 * 1000).rounded())
    }
    private static func reference(releaseId: String, language: String, bindingId: String, image: String, dataset: String) throws {
        guard releaseId == release, language == self.language, bindingId == binding, digest(image), digest(dataset)
        else { throw HomeBaseWHOError.invalidResponse }
    }
    private static func object(_ value: Any?, keys: [String]) throws -> [String: Any] {
        guard let object = value as? [String: Any], Set(object.keys) == Set(keys) else { throw HomeBaseWHOError.invalidResponse }
        return object
    }
    private static func root(_ data: Data, keys: [String]) throws -> [String: Any] {
        guard !data.isEmpty, data.count <= maximumBytes else { throw HomeBaseWHOError.invalidResponse }
        do { return try object(JSONSerialization.jsonObject(with: data), keys: keys) }
        catch { throw HomeBaseWHOError.invalidResponse }
    }
    private static func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try JSONDecoder().decode(type, from: data) }
        catch { throw HomeBaseWHOError.invalidResponse }
    }

    public static func search(_ data: Data) throws -> HomeBaseWHOSearchResponse {
        let raw = try root(data, keys: ["schemaVersion", "entries", "partial", "receipt"])
        _ = try object(raw["receipt"], keys: referenceKeys + ["schemaVersion", "operation", "deployment", "source", "resultCount", "latencyMs", "fetchedAt", "expiresAt", "completedAt"])
        guard let entries = raw["entries"] as? [Any] else { throw HomeBaseWHOError.invalidResponse }
        for entry in entries { _ = try object(entry, keys: ["code", "description", "system", "canonicalUri"]) }
        let result = try decode(HomeBaseWHOSearchResponse.self, data)
        let receipt = result.receipt
        try reference(releaseId: receipt.releaseId, language: receipt.language, bindingId: receipt.bindingId, image: receipt.imageDigest, dataset: receipt.datasetSnapshotId)
        guard result.schemaVersion == "mediflow.reference-data.icd11-search-response.v2",
              receipt.schemaVersion == "mediflow.reference-data.icd11-search-receipt.v2",
              receipt.operation == "mediflow.reference_data.icd11.search.v2", receipt.deployment == "local",
              result.entries.count <= 25, receipt.resultCount == result.entries.count, nonnegative(receipt.latencyMs),
              Set(result.entries.map(\.code)).count == result.entries.count,
              result.entries.allSatisfy({ isCheckCode($0.code) && $0.system == "ICD-11" && title($0.description) && canonicalURI($0.canonicalUri, code: $0.code) })
        else { throw HomeBaseWHOError.invalidResponse }
        let fetched = try milliseconds(receipt.fetchedAt), expires = try milliseconds(receipt.expiresAt), completed = try milliseconds(receipt.completedAt)
        guard expires - fetched == 86_400_000, completed >= fetched, completed < expires,
              receipt.source != .live || completed - fetched <= Int64(receipt.latencyMs)
        else { throw HomeBaseWHOError.invalidResponse }
        return result
    }

    public static func readiness(_ data: Data) throws -> HomeBaseWHOReadiness {
        _ = try root(data, keys: referenceKeys + ["schemaVersion", "status", "deployment", "lastLiveObservedAt", "lastResultSource"])
        let result = try decode(HomeBaseWHOReadiness.self, data)
        guard result.schemaVersion == "mediflow.reference-data.icd11-who-readiness.v2", result.releaseId == release,
              result.language == language, result.deployment == "local", result.bindingId == binding,
              result.imageDigest.map(digest) ?? true, result.datasetSnapshotId.map(digest) ?? true
        else { throw HomeBaseWHOError.invalidResponse }
        if result.status != .disabled && result.status != .configurationRequired {
            guard result.imageDigest != nil, result.datasetSnapshotId != nil else { throw HomeBaseWHOError.invalidResponse }
        }
        if result.status == .available && result.lastLiveObservedAt == nil { throw HomeBaseWHOError.invalidResponse }
        if let date = result.lastLiveObservedAt { _ = try milliseconds(date) }
        return result
    }

    public static func checkCode(_ data: Data, requestedCode: String) throws -> HomeBaseWHOCodeCheckResponse {
        let raw = try root(data, keys: ["schemaVersion", "code", "status", "entry", "receipt"])
        _ = try object(raw["receipt"], keys: referenceKeys + ["schemaVersion", "operation", "source", "found", "checkedAt", "latencyMs"])
        if !(raw["entry"] is NSNull) { _ = try object(raw["entry"], keys: ["canonicalUri", "stemUri", "stemCode", "stemTitle"]) }
        let result = try decode(HomeBaseWHOCodeCheckResponse.self, data)
        let receipt = result.receipt
        try reference(releaseId: receipt.releaseId, language: receipt.language, bindingId: receipt.bindingId, image: receipt.imageDigest, dataset: receipt.datasetSnapshotId)
        guard isCheckCode(requestedCode), result.code == requestedCode,
              result.schemaVersion == "mediflow.reference-data.icd11-code-check.v1",
              receipt.schemaVersion == "mediflow.reference-data.icd11-code-check-receipt.v1",
              receipt.operation == "mediflow.reference_data.icd11.code_check.v1", receipt.source == .live,
              receipt.found == (result.status == .found), nonnegative(receipt.latencyMs)
        else { throw HomeBaseWHOError.invalidResponse }
        _ = try milliseconds(receipt.checkedAt)
        if let entry = result.entry {
            guard result.status == .found, entry.canonicalUri == codeInfoURI(requestedCode), stemURI(entry.stemUri),
                  entry.stemCode == requestedCode.split(whereSeparator: { $0 == "&" || $0 == "/" }).first.map(String.init), title(entry.stemTitle)
            else { throw HomeBaseWHOError.invalidResponse }
        } else if result.status != .notFound { throw HomeBaseWHOError.invalidResponse }
        return result
    }

    /// Stable public errors only; never expose vendor text or raw response bodies.
    public static func error(_ data: Data, status: Int) -> HomeBaseWHOError {
        if status == 401 { return .unauthorized }
        if status == 403 { return .forbidden }
        guard data.count <= maximumBytes,
              let raw = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let code = raw["code"] as? String else { return .invalidResponse }
        if status == 409 && code == "NETWORK_MODE_DISABLED" { return .networkModeDisabled }
        guard raw["schemaVersion"] as? String == "mediflow.reference-data.icd11-error.v1",
              Set(raw.keys) == Set(["schemaVersion", "code"]) else { return .invalidResponse }
        switch (status, code) {
        case (400, "request_invalid"), (405, "request_invalid"): return .invalidRequest
        case (409, "release_not_supported"): return .releaseNotSupported
        case (502, "upstream_response_invalid"): return .upstreamResponseInvalid
        case (503, "service_unavailable"): return .unavailable
        case (504, "upstream_timeout"): return .upstreamTimeout
        default: return .invalidResponse
        }
    }
}
