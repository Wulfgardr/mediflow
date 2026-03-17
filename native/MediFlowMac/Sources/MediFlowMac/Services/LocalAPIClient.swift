// Codex: created 2026-02-01
import Foundation
import CryptoKit

actor LocalAPIClient {
    static let shared = LocalAPIClient()
    /* @Codex */
    private static let sourceSurfaceHeader = "X-MediFlow-Source-Surface"
    /* @Codex */
    private static let sourceSurfaceValue = "native"

    private let delegate = LocalAPISessionDelegate()
    private let session: URLSession
    private let tokenProvider: LocalAPITokenProvider

    init(tokenProvider: LocalAPITokenProvider = .shared, session: URLSession? = nil) {
        self.tokenProvider = tokenProvider
        let configuration = URLSessionConfiguration.ephemeral
        self.session = session ?? URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    }

    /* @Codex */
    private func data(for request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch let error as URLError {
            throw mapTransportError(error)
        }
    }

    func fetchPatients(ambulatoryId: String?) async throws -> [PatientSummary] {
        let queryItems = ambulatoryId.map { [URLQueryItem(name: "ambulatoryId", value: $0)] } ?? []
        let request = try makeRequest(path: "patients", queryItems: queryItems)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([PatientSummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    func fetchPatient(id: String) async throws -> PatientDetail {
        let request = try makeRequest(path: "patients/\(id)")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode(PatientDetail.self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    func fetchAmbulatories() async throws -> [AmbulatorySummary] {
        let request = try makeRequest(path: "ambulatories")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([AmbulatorySummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    /* @Codex */
    func fetchEntries(
        patientId: String,
        limit: Int? = nil,
        type: String? = nil,
        dateFrom: Date? = nil,
        dateTo: Date? = nil
    ) async throws -> [EntrySummary] {
        var queryItems: [URLQueryItem] = []
        if let limit { queryItems.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let type, !type.isEmpty { queryItems.append(URLQueryItem(name: "type", value: type)) }
        if let dateFrom { queryItems.append(URLQueryItem(name: "dateFrom", value: iso8601String(from: dateFrom))) }
        if let dateTo { queryItems.append(URLQueryItem(name: "dateTo", value: iso8601String(from: dateTo))) }

        let request = try makeRequest(
            path: "patients/\(patientId)/entries",
            queryItems: queryItems
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([EntrySummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    /* @Codex */
    func fetchTherapies(
        patientId: String,
        limit: Int? = nil,
        status: String? = nil,
        dateFrom: Date? = nil,
        dateTo: Date? = nil
    ) async throws -> [TherapySummary] {
        var queryItems: [URLQueryItem] = []
        if let limit { queryItems.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let status, !status.isEmpty { queryItems.append(URLQueryItem(name: "status", value: status)) }
        if let dateFrom { queryItems.append(URLQueryItem(name: "dateFrom", value: iso8601String(from: dateFrom))) }
        if let dateTo { queryItems.append(URLQueryItem(name: "dateTo", value: iso8601String(from: dateTo))) }

        let request = try makeRequest(
            path: "patients/\(patientId)/therapies",
            queryItems: queryItems
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([TherapySummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    /* @Codex */
    func fetchCheckups(
        patientId: String,
        limit: Int? = nil,
        status: String? = nil,
        dateFrom: Date? = nil,
        dateTo: Date? = nil
    ) async throws -> [CheckupSummary] {
        var queryItems: [URLQueryItem] = []
        if let limit { queryItems.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let status, !status.isEmpty { queryItems.append(URLQueryItem(name: "status", value: status)) }
        if let dateFrom { queryItems.append(URLQueryItem(name: "dateFrom", value: iso8601String(from: dateFrom))) }
        if let dateTo { queryItems.append(URLQueryItem(name: "dateTo", value: iso8601String(from: dateTo))) }

        let request = try makeRequest(
            path: "patients/\(patientId)/checkups",
            queryItems: queryItems
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([CheckupSummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    /* @Codex */
    func fetchObservations(
        patientId: String,
        limit: Int? = nil,
        code: String? = nil,
        dateFrom: Date? = nil,
        dateTo: Date? = nil
    ) async throws -> [ObservationSummary] {
        var queryItems: [URLQueryItem] = []
        if let limit { queryItems.append(URLQueryItem(name: "limit", value: String(limit))) }
        if let code, !code.isEmpty { queryItems.append(URLQueryItem(name: "code", value: code)) }
        if let dateFrom { queryItems.append(URLQueryItem(name: "dateFrom", value: iso8601String(from: dateFrom))) }
        if let dateTo { queryItems.append(URLQueryItem(name: "dateTo", value: iso8601String(from: dateTo))) }

        let request = try makeRequest(
            path: "patients/\(patientId)/observations",
            queryItems: queryItems
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([ObservationSummary].self, from: data) { decoder in
            decoder.dateDecodingStrategy = .iso8601
        }
    }

    /* @Codex */
    func searchTerminology(system: String, query: String = "", limit: Int = 100) async throws -> [TerminologySearchItem] {
        let normalizedSystem = system.trimmingCharacters(in: .whitespacesAndNewlines)
        var queryItems = [URLQueryItem(name: "system", value: normalizedSystem)]
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedQuery.isEmpty {
            queryItems.append(URLQueryItem(name: "q", value: trimmedQuery))
        }
        if limit > 0 {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }

        let request = try makeRequest(path: "terminology/search", queryItems: queryItems)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([TerminologySearchItem].self, from: data)
    }

    func createPatient(payload: CreatePatientPayload) async throws -> String {
        let request = try makeRequest(path: "patients", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(CreatePatientResponse.self, from: data)
        return result.id
    }

    /* @Codex */
    func updatePatient(id: String, payload: UpdatePatientPayload) async throws {
        let request = try makeRequest(path: "patients/\(id)", method: "PUT", body: payload)
        let (data, response) = try await data(for: request)
        try validatePatientMutation(data: data, response: response)
    }

    /* @Codex */
    func deletePatient(id: String, expectedVersion: Int) async throws {
        let request = try makeRequest(
            path: "patients/\(id)",
            method: "DELETE",
            body: DeletePatientPayload(version: expectedVersion)
        )
        let (data, response) = try await data(for: request)
        try validatePatientMutation(data: data, response: response)
    }

    func createEntry(patientId: String, payload: CreateEntryPayload) async throws -> String {
        let request = try makeRequest(path: "patients/\(patientId)/entries", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(CreatePatientResponse.self, from: data)
        return result.id
    }

    /* @Codex */
    func updateEntry(patientId: String, entryId: String, payload: UpdateEntryPayload) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/entries/\(entryId)", method: "PUT", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func deleteEntry(patientId: String, entryId: String) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/entries/\(entryId)", method: "DELETE")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func createTherapy(patientId: String, payload: CreateTherapyPayload) async throws -> String {
        let request = try makeRequest(path: "patients/\(patientId)/therapies", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(CreatePatientResponse.self, from: data)
        return result.id
    }

    /* @Codex */
    func updateTherapy(patientId: String, therapyId: String, payload: UpdateTherapyPayload) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/therapies/\(therapyId)", method: "PUT", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func deleteTherapy(patientId: String, therapyId: String) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/therapies/\(therapyId)", method: "DELETE")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func createCheckup(patientId: String, payload: CreateCheckupPayload) async throws -> String {
        let request = try makeRequest(path: "patients/\(patientId)/checkups", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(CreatePatientResponse.self, from: data)
        return result.id
    }

    /* @Codex */
    func updateCheckup(patientId: String, checkupId: String, payload: UpdateCheckupPayload) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/checkups/\(checkupId)", method: "PUT", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func deleteCheckup(patientId: String, checkupId: String) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/checkups/\(checkupId)", method: "DELETE")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func createObservation(patientId: String, payload: CreateObservationPayload) async throws -> String {
        let request = try makeRequest(path: "patients/\(patientId)/observations", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(CreatePatientResponse.self, from: data)
        return result.id
    }

    /* @Codex */
    func updateObservation(patientId: String, observationId: String, payload: UpdateObservationPayload) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/observations/\(observationId)", method: "PUT", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func deleteObservation(patientId: String, observationId: String) async throws {
        let request = try makeRequest(path: "patients/\(patientId)/observations/\(observationId)", method: "DELETE")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func testConnection() async throws {
        let request = try makeRequest(path: "ambulatories")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    /* @Codex */
    func checkAuthStatus() async throws -> AuthCheckResponse {
        let request = try makeRootRequest(path: "auth/check", requiresAuth: false)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode(AuthCheckResponse.self, from: data)
    }

    func login(pin: String) async throws -> AuthLoginResponse {
        let payload = AuthLoginRequest(username: "admin", password: pin)
        let request = try makeRootRequest(path: "auth/login", method: "POST", body: payload, requiresAuth: false)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode(AuthLoginResponse.self, from: data)
    }

    func setup(pin: String, displayName: String, ambulatoryName: String, encryptedMasterKey: String, salt: String) async throws {
        let payload = AuthSetupRequest(
            username: "admin",
            password: pin,
            encryptedMasterKey: encryptedMasterKey,
            salt: salt,
            displayName: displayName,
            ambulatoryName: ambulatoryName
        )
        let request = try makeRootRequest(path: "auth/setup", method: "POST", body: payload, requiresAuth: false)
        /* @Codex */
        let (data, response) = try await data(for: request)
        guard let http = response as? HTTPURLResponse else {
            throw LocalAPIError.unexpectedResponse
        }
        if (200...299).contains(http.statusCode) { return }
        if let errorPayload = try? JSONDecoder().decode(AuthErrorResponse.self, from: data),
           errorPayload.code == "SETUP_ALREADY_COMPLETED" {
            throw AuthFlowError.setupAlreadyCompleted
        }
        throw buildHTTPError(statusCode: http.statusCode, data: data)
    }

    func fetchSetting(key: String) async throws -> String? {
        let request = try makeRootRequest(path: "settings/\(key)")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(SettingResponse.self, from: data)
        return result.value
    }

    func saveSetting(key: String, value: String) async throws {
        let payload = SettingUpdateRequest(key: key, value: value)
        let request = try makeRootRequest(path: "settings", method: "POST", body: payload)
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func saveSettings(_ items: [String: String]) async throws {
        for (key, value) in items {
            try await saveSetting(key: key, value: value)
        }
    }

    func searchDrugs(query: String) async throws -> [DrugSummary] {
        let request = try makeRequest(
            path: "drugs",
            queryItems: [URLQueryItem(name: "q", value: query)]
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([DrugSummary].self, from: data)
    }

    /* @Codex */
    func searchExemptions(query: String, limit: Int = 60) async throws -> [ExemptionSummary] {
        let request = try makeRequest(
            path: "exemptions",
            queryItems: [
                URLQueryItem(name: "q", value: query),
                URLQueryItem(name: "limit", value: String(limit))
            ]
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode([ExemptionSummary].self, from: data)
    }

    func searchICD(query: String) async throws -> [ICDResult] {
        let request = try makeRootRequest(
            path: "icd/proxy",
            queryItems: [URLQueryItem(name: "q", value: query)]
        )
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try ICDResultParser.parse(data: data)
    }

    func checkICDStatus() async throws -> Bool {
        let request = try makeRootRequest(path: "icd/proxy")
        let (_, response) = try await data(for: request)
        if let http = response as? HTTPURLResponse {
            return http.statusCode >= 200 && http.statusCode < 400
        }
        return false
    }

    /* @Codex */
    func repairDbFromLegacy() async throws {
        let request = try makeRootRequest(path: "system/repair-db", method: "POST")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func listAIModels(baseURL: String) async throws -> [AIModelInfo] {
        let cleanedBase = normalizedAIBaseURL(baseURL)
        var request = try makeRootRequest(path: "ai/models")
        request.setValue(cleanedBase, forHTTPHeaderField: "x-target-url")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        /* @Codex */
        // Be tolerant to provider payload changes (e.g. mixed types in model entries).
        if let object = try? JSONSerialization.jsonObject(with: data, options: []),
           let root = object as? [String: Any],
           let rawModels = root["models"] as? [[String: Any]] {
            let models = rawModels.compactMap { raw -> AIModelInfo? in
                guard let name = raw["name"] as? String, !name.isEmpty else { return nil }
                let size: Int?
                if let n = raw["size"] as? NSNumber {
                    size = n.intValue
                } else if let s = raw["size"] as? String, let parsed = Int(s) {
                    size = parsed
                } else {
                    size = nil
                }
                return AIModelInfo(name: name, size: size)
            }
            return models
        }

        if let result = try? JSONDecoder().decode(AIModelListResponse.self, from: data) {
            return result.models
        }

        throw LocalAPIError.invalidAIModelsPayload
    }

    func checkOCRStatus() async throws -> OCRModelStatus {
        let request = try makeRootRequest(path: "ocr/extract")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode(OCRModelStatus.self, from: data)
    }

    func fetchMLXStatus() async throws -> MLXStatus {
        let request = try makeRootRequest(path: "system/mlx")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        return try decode(MLXStatus.self, from: data)
    }

    func startMLX() async throws {
        let request = try makeRootRequest(path: "system/mlx", method: "POST")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func stopMLX() async throws {
        let request = try makeRootRequest(path: "system/mlx", method: "DELETE")
        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
    }

    func aiChat(prompt: String, model: String, baseURL: String, maxTokens: Int = 1024, temperature: Double = 0.4) async throws -> String {
        let body = AIChatRequest(
            model: model,
            messages: [AIChatMessage(role: "user", content: prompt)],
            stream: false,
            temperature: temperature,
            maxTokens: maxTokens
        )

        let cleanedBase = normalizedAIBaseURL(baseURL)
        let finalTarget = "\(cleanedBase)/v1/chat/completions"

        var request = try makeRootRequest(path: "proxy/ai/chat", method: "POST", body: body)
        request.setValue(finalTarget, forHTTPHeaderField: "x-target-url")

        let (data, response) = try await data(for: request)
        try validate(data: data, response: response)
        let result = try decode(AIChatResponse.self, from: data)
        return result.choices.first?.message.content ?? ""
    }

    private func normalizedAIBaseURL(_ url: String) -> String {
        var cleaned = url
        if cleaned.hasSuffix("/v1") {
            cleaned = String(cleaned.dropLast(3))
        }
        if cleaned.hasSuffix("/") {
            cleaned = String(cleaned.dropLast())
        }
        return cleaned
    }

    /* @Codex */
    private func iso8601String(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func makeRequest(
        path: String,
        method: String = "GET",
        body: Encodable? = nil,
        queryItems: [URLQueryItem] = [],
        requiresAuth: Bool = true
    ) throws -> URLRequest {
        let baseURL = try currentBaseURL()
        let url = baseURL.appendingPathComponent(path)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let finalURL = components?.url else {
            throw LocalAPIError.invalidBaseURL
        }

        var request = URLRequest(url: finalURL)
        request.httpMethod = method
        /* @Codex */
        request.setValue(Self.sourceSurfaceValue, forHTTPHeaderField: Self.sourceSurfaceHeader)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        if requiresAuth {
            try applyAuth(to: &request)
        }
        return request
    }

    private func makeRootRequest(
        path: String,
        method: String = "GET",
        body: Encodable? = nil,
        queryItems: [URLQueryItem] = [],
        requiresAuth: Bool = true
    ) throws -> URLRequest {
        let baseURL = try currentBaseURL()
        let rootURL = baseURL.deletingLastPathComponent()
        let url = rootURL.appendingPathComponent(path)
        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        if !queryItems.isEmpty {
            components?.queryItems = queryItems
        }
        guard let finalURL = components?.url else {
            throw LocalAPIError.invalidBaseURL
        }

        var request = URLRequest(url: finalURL)
        request.httpMethod = method
        /* @Codex */
        request.setValue(Self.sourceSurfaceValue, forHTTPHeaderField: Self.sourceSurfaceHeader)
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            let encoder = JSONEncoder()
            encoder.dateEncodingStrategy = .iso8601
            request.httpBody = try encoder.encode(AnyEncodable(body))
        }
        if requiresAuth {
            try applyAuth(to: &request)
        }
        return request
    }

    private func applyAuth(to request: inout URLRequest) throws {
        /* @Codex */
        switch tokenProvider.resolveToken() {
        case .resolved(let token, _):
            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        case .failure(.notFound):
            throw LocalAPIError.missingAPIToken
        case .failure(let failure):
            throw LocalAPIError.incompleteAPITokenBootstrap(failure)
        }
    }

    /* @Codex */
    private func validate(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalAPIError.unexpectedResponse
        }
        guard (200...299).contains(httpResponse.statusCode) else {
            throw buildHTTPError(statusCode: httpResponse.statusCode, data: data)
        }
    }

    /* @Codex */
    private func validatePatientMutation(data: Data, response: URLResponse) throws {
        guard let httpResponse = response as? HTTPURLResponse else {
            throw LocalAPIError.unexpectedResponse
        }
        if (200...299).contains(httpResponse.statusCode) {
            return
        }
        if httpResponse.statusCode == 409,
           let payload = try? JSONDecoder().decode(PatientVersionConflictPayload.self, from: data),
           payload.code == "VERSION_CONFLICT" {
            throw LocalAPIError.versionConflict(payload)
        }
        throw buildHTTPError(statusCode: httpResponse.statusCode, data: data)
    }

    /* @Codex */
    private func buildHTTPError(statusCode: Int, data: Data) -> LocalAPIError {
        let message = errorMessage(from: data)
        switch statusCode {
        case 400, 422:
            return .validation(statusCode: statusCode, message: message)
        case 401, 403:
            return .auth(statusCode: statusCode, message: message)
        default:
            return .httpStatus(statusCode, message: message)
        }
    }

    /* @Codex */
    private func decode<T: Decodable>(
        _ type: T.Type,
        from data: Data,
        configure: ((JSONDecoder) -> Void)? = nil
    ) throws -> T {
        let decoder = JSONDecoder()
        configure?(decoder)
        do {
            return try decoder.decode(T.self, from: data)
        } catch {
            throw LocalAPIError.contract("Risposta API locale non valida.")
        }
    }

    /* @Codex */
    private func errorMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        if let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data) {
            return payload.message ?? payload.error
        }
        return nil
    }

    /* @Codex */
    private func mapTransportError(_ error: URLError) -> LocalAPIError {
        switch error.code {
        case .cancelled, .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot, .clientCertificateRejected, .clientCertificateRequired:
            return .transport(.tlsHandshakeFailed)
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet:
            return .transport(.unreachable)
        case .timedOut:
            return .transport(.timeout)
        case .networkConnectionLost, .dnsLookupFailed:
            return .transport(.networkLost)
        default:
            return .transport(.other(error.code.rawValue))
        }
    }

    private func currentBaseURL() throws -> URL {
        let baseURLString = LocalAPISettings.loadBaseURLString()
        guard let url = URL(string: baseURLString) else {
            throw LocalAPIError.invalidBaseURL
        }
        guard url.scheme?.lowercased() == "https" else {
            throw LocalAPIError.insecureTransport
        }
        return url
    }

    private func parseAuthDate(_ value: String) -> Date? {
        ISO8601DateFormatter().date(from: value)
    }
}

enum LocalAPIError: LocalizedError, Equatable {
    case invalidBaseURL
    case insecureTransport
    case missingAPIToken
    case incompleteAPITokenBootstrap(LocalAPITokenBootstrapFailure)
    case unexpectedResponse
    case transport(LocalAPITransportIssue)
    case auth(statusCode: Int, message: String?)
    case validation(statusCode: Int, message: String?)
    case httpStatus(Int, message: String?)
    case contract(String)
    /* @Codex */
    case invalidAIModelsPayload
    /* @Codex */
    case versionConflict(PatientVersionConflictPayload)

    var errorDescription: String? {
        switch self {
        case .invalidBaseURL:
            return "Base URL non valida."
        case .insecureTransport:
            return "Trasporto non sicuro: HTTPS richiesto."
        case .missingAPIToken:
            return "Token API locale assente."
        case .incompleteAPITokenBootstrap(let failure):
            return failure.localizedDescription
        case .unexpectedResponse:
            return "Risposta non valida dal server locale."
        case .transport(let issue):
            return issue.localizedDescription
        case .auth(let statusCode, let message):
            if let message, !message.isEmpty { return message }
            return statusCode == 403 ? "Accesso negato." : "Autenticazione fallita."
        case .validation(_, let message):
            return message ?? "Richiesta non valida."
        case .httpStatus(let statusCode, let message):
            return message ?? "Errore server (HTTP \(statusCode))."
        case .contract(let message):
            return message
        /* @Codex */
        case .invalidAIModelsPayload:
            return "Risposta modelli AI non valida."
        /* @Codex */
        case .versionConflict:
            return "Conflitto di modifica: il record e stato aggiornato altrove. Ricarica e riprova."
        }
    }
}

/* @Codex */
enum LocalAPITransportIssue: Equatable {
    case tlsHandshakeFailed
    case unreachable
    case timeout
    case networkLost
    case other(Int)

    var localizedDescription: String {
        switch self {
        case .tlsHandshakeFailed:
            return "Handshake TLS fallito. Rigenera la configurazione locale e riprova."
        case .unreachable:
            return "Server locale non raggiungibile."
        case .timeout:
            return "Timeout verso il server locale."
        case .networkLost:
            return "Connessione al server locale interrotta."
        case .other:
            return "Errore di trasporto verso il server locale."
        }
    }
}

/* @Codex */
enum AuthFlowError: LocalizedError {
    case setupAlreadyCompleted

    var errorDescription: String? {
        switch self {
        case .setupAlreadyCompleted:
            return "Setup già completato."
        }
    }
}

final class LocalAPISessionDelegate: NSObject, URLSessionDelegate {
    func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let serverTrust = challenge.protectionSpace.serverTrust else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let expectedPin = LocalAPISettings.loadTLSPin()
            .lowercased()
            .replacingOccurrences(of: ":", with: "")

        if !expectedPin.isEmpty {
            let certificates = SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate]
            if let certificate = certificates?.first {
                let data = SecCertificateCopyData(certificate) as Data
                let hash = SHA256.hash(data: data)
                let pin = hash.map { String(format: "%02x", $0) }.joined()

                if pin == expectedPin {
                    completionHandler(.useCredential, URLCredential(trust: serverTrust))
                } else {
                    completionHandler(.cancelAuthenticationChallenge, nil)
                }
                return
            }
        }

        if SecTrustEvaluateWithError(serverTrust, nil) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

struct CreatePatientPayload: Encodable {
    let firstName: String
    let lastName: String
    let taxCode: String
    let birthDate: Date?
    let address: String?
    let phone: String?
    let caregiver: String?
    /* @Codex */
    let exemptions: String?
    let notes: String?
    let isAdi: Bool
    let isArchived: Bool
    let ambulatoryId: String?
}

/* @Codex */
enum PatchValue<Value> {
    case omit
    case null
    case value(Value)
}

/* @Codex */
struct UpdatePatientPayload: Encodable {
    let version: Int
    let firstName: String?
    let lastName: String?
    let taxCode: String?
    let birthDate: PatchValue<Date>
    let address: PatchValue<String>
    let phone: PatchValue<String>
    let caregiver: PatchValue<String>
    let exemptions: PatchValue<String>
    let notes: PatchValue<String>
    let aiSummary: PatchValue<String>
    let documentInsights: PatchValue<String>
    let isAdi: Bool?
    let isArchived: Bool?
    let ambulatoryId: PatchValue<String>

    init(
        version: Int,
        firstName: String? = nil,
        lastName: String? = nil,
        taxCode: String? = nil,
        birthDate: PatchValue<Date> = .omit,
        address: PatchValue<String> = .omit,
        phone: PatchValue<String> = .omit,
        caregiver: PatchValue<String> = .omit,
        exemptions: PatchValue<String> = .omit,
        notes: PatchValue<String> = .omit,
        aiSummary: PatchValue<String> = .omit,
        documentInsights: PatchValue<String> = .omit,
        isAdi: Bool? = nil,
        isArchived: Bool? = nil,
        ambulatoryId: PatchValue<String> = .omit
    ) {
        self.version = version
        self.firstName = firstName
        self.lastName = lastName
        self.taxCode = taxCode
        self.birthDate = birthDate
        self.address = address
        self.phone = phone
        self.caregiver = caregiver
        self.exemptions = exemptions
        self.notes = notes
        self.aiSummary = aiSummary
        self.documentInsights = documentInsights
        self.isAdi = isAdi
        self.isArchived = isArchived
        self.ambulatoryId = ambulatoryId
    }

    private enum CodingKeys: String, CodingKey {
        case version
        case firstName
        case lastName
        case taxCode
        case birthDate
        case address
        case phone
        case caregiver
        case exemptions
        case notes
        case aiSummary
        case documentInsights
        case isAdi
        case isArchived
        case ambulatoryId
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encodeIfPresent(firstName, forKey: .firstName)
        try container.encodeIfPresent(lastName, forKey: .lastName)
        try container.encodeIfPresent(taxCode, forKey: .taxCode)
        try container.encodePatch(birthDate, forKey: .birthDate)
        try container.encodePatch(address, forKey: .address)
        try container.encodePatch(phone, forKey: .phone)
        try container.encodePatch(caregiver, forKey: .caregiver)
        try container.encodePatch(exemptions, forKey: .exemptions)
        try container.encodePatch(notes, forKey: .notes)
        try container.encodePatch(aiSummary, forKey: .aiSummary)
        try container.encodePatch(documentInsights, forKey: .documentInsights)
        try container.encodeIfPresent(isAdi, forKey: .isAdi)
        try container.encodeIfPresent(isArchived, forKey: .isArchived)
        try container.encodePatch(ambulatoryId, forKey: .ambulatoryId)
    }
}

/* @Codex */
struct DeletePatientPayload: Encodable {
    let version: Int
}

struct CreateEntryPayload: Encodable {
    let type: String
    let date: Date
    let content: String
}

/* @Codex */
struct UpdateEntryPayload: Encodable {
    let type: String?
    let date: Date?
    let content: String?
}

struct CreateTherapyPayload: Encodable {
    let drugName: String
    /* @Codex */
    let aic: String?
    /* @Codex */
    let atc: String?
    let dosage: String
    let status: String
    let startDate: Date
    let endDate: Date?
}

/* @Codex */
struct UpdateTherapyPayload: Encodable {
    let drugName: String?
    /* @Codex */
    let aic: PatchValue<String>
    /* @Codex */
    let atc: PatchValue<String>
    let dosage: String?
    let status: String?
    let startDate: Date?
    let endDate: PatchValue<Date>

    init(
        drugName: String? = nil,
        aic: PatchValue<String> = .omit,
        atc: PatchValue<String> = .omit,
        dosage: String? = nil,
        status: String? = nil,
        startDate: Date? = nil,
        endDate: PatchValue<Date> = .omit
    ) {
        self.drugName = drugName
        self.aic = aic
        self.atc = atc
        self.dosage = dosage
        self.status = status
        self.startDate = startDate
        self.endDate = endDate
    }

    private enum CodingKeys: String, CodingKey {
        case drugName
        case aic
        case atc
        case dosage
        case status
        case startDate
        case endDate
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encodeIfPresent(drugName, forKey: .drugName)
        try container.encodePatch(aic, forKey: .aic)
        try container.encodePatch(atc, forKey: .atc)
        try container.encodeIfPresent(dosage, forKey: .dosage)
        try container.encodeIfPresent(status, forKey: .status)
        try container.encodeIfPresent(startDate, forKey: .startDate)
        try container.encodePatch(endDate, forKey: .endDate)
    }
}

struct CreateCheckupPayload: Encodable {
    let date: Date
    let title: String
    let status: String
}

/* @Codex */
struct UpdateCheckupPayload: Encodable {
    let date: Date?
    let title: String?
    let status: String?
}

/* @Codex */
struct CreateObservationPayload: Encodable {
    let codeSystem: String
    let code: String
    let display: String
    let unitSystem: String
    let unitCode: String
    let value: String
    let notes: String?
    let observedAt: Date
    let source: String?
}

/* @Codex */
struct UpdateObservationPayload: Encodable {
    let codeSystem: String?
    let code: String?
    let display: String?
    let unitSystem: String?
    let unitCode: String?
    let value: String?
    let notes: String?
    let observedAt: Date?
    let source: String?
}

struct CreatePatientResponse: Decodable {
    let id: String
}

/* @Codex */
struct AuthCheckResponse: Decodable {
    let status: String?
    let isSetup: Bool
    let hasSession: Bool?
    let error: AuthErrorResponse?
    let db: AuthDbHealth?
}

/* @Codex */
struct AuthErrorResponse: Decodable {
    let error: String?
    let code: String?
    let message: String?
    let lockedUntil: String?
    let remainingAttempts: Int?
    let failedLoginAttempts: Int?
    let retryAfterSeconds: Int?
}

/* @Codex */
struct APIErrorPayload: Decodable {
    let error: String?
    let message: String?
}

/* @Codex */
struct PatientVersionConflictPayload: Decodable, Equatable {
    let error: String
    let code: String
    let entity: String
    let recordId: String
    let expectedVersion: Int
    let currentVersion: Int?
    let currentUpdatedAt: String?
    let currentState: String
    let currentSnapshot: PatientConflictSnapshot?
}

/* @Codex */
struct PatientConflictSnapshot: Decodable, Equatable {
    let id: String
    let version: Int
    let updatedAt: String?
    let isArchived: Bool?
}

/* @Codex */
struct AuthDbHealth: Decodable {
    let dataDir: String?
    let dbPath: String?
    let dbExists: Bool?
    let dbReadable: Bool?
    let dbWritable: Bool?
    let dbSizeBytes: Int?
    let legacyDbPath: String?
    let legacyExists: Bool?
    let schemaOk: Bool?
}

struct AuthLoginRequest: Encodable {
    let username: String
    let password: String
}

struct AuthLoginResponse: Decodable {
    let encryptedMasterKey: String
    let salt: String
}

struct AuthSetupRequest: Encodable {
    let username: String
    let password: String
    let encryptedMasterKey: String
    let salt: String
    let displayName: String
    let ambulatoryName: String
}

struct SettingResponse: Decodable {
    let key: String
    let value: String?
}

struct SettingUpdateRequest: Encodable {
    let key: String
    let value: String
}

struct DrugSummary: Identifiable, Decodable, Equatable {
    let aic: String
    let name: String
    let activePrinciple: String?
    let company: String?
    let packaging: String?
    let `class`: String?
    let price: Int?
    let atc: String?

    var id: String { aic }
}

/* @Codex */
struct ExemptionSummary: Identifiable, Decodable, Equatable {
    let code: String
    let description: String
    let type: String?
    let source: String?
    let startDate: String?
    let endDate: String?
    let isPharma: Bool?
    let isSpecialist: Bool?
    let isNational: Bool?
    let updatedAt: String?

    var id: String { code }
}

struct ICDResult: Identifiable {
    let id = UUID()
    let code: String
    let description: String
    let system: String
}

struct AIModelInfo: Decodable, Identifiable {
    let name: String
    let size: Int?
    /* @Codex */
    // Ollama /api/tags returns mixed-type details; we decode only stable fields used by UI.
    private enum CodingKeys: String, CodingKey {
        case name
        case size
    }

    /* @Codex */
    init(name: String, size: Int?) {
        self.name = name
        self.size = size
    }

    var id: String { name }
}

struct AIModelListResponse: Decodable {
    let models: [AIModelInfo]
}

struct OCRModelStatus: Decodable {
    let available: Bool
    let model: String
    let message: String
}

struct MLXStatus: Decodable {
    let name: String?
    let status: String?
    let cpu: Double?
    let memory: Double?
}

enum ICDResultParser {
    static func parse(data: Data) throws -> [ICDResult] {
        let json = try JSONSerialization.jsonObject(with: data, options: [])
        guard let dict = json as? [String: Any], let entities = dict["destinationEntities"] as? [[String: Any]] else {
            return []
        }

        return entities.map { entity in
            let rawTitle = titleString(from: entity["title"])
            let cleanTitle = stripHTML(rawTitle)
            let code = (entity["theCode"] as? String) ?? (entity["code"] as? String) ?? (entity["codeRange"] as? String) ?? "N/A"
            return ICDResult(code: code, description: cleanTitle.isEmpty ? "Descrizione assente" : cleanTitle, system: "ICD-11")
        }
    }

    private static func titleString(from value: Any?) -> String {
        if let string = value as? String { return string }
        if let dict = value as? [String: Any], let val = dict["value"] as? String { return val }
        return ""
    }

    private static func stripHTML(_ value: String) -> String {
        return value.replacingOccurrences(of: "<[^>]+>", with: "", options: .regularExpression)
    }
}

struct AIChatRequest: Encodable {
    let model: String
    let messages: [AIChatMessage]
    let stream: Bool
    let temperature: Double
    let maxTokens: Int

    enum CodingKeys: String, CodingKey {
        case model
        case messages
        case stream
        case temperature
        case maxTokens = "max_tokens"
    }
}

struct AIChatMessage: Encodable {
    let role: String
    let content: String
}

struct AIChatResponse: Decodable {
    struct Choice: Decodable {
        struct Message: Decodable {
            let content: String
        }
        let message: Message
    }
    let choices: [Choice]
}

/* @Codex */
private extension KeyedEncodingContainer {
    mutating func encodePatch<T: Encodable>(_ value: PatchValue<T>, forKey key: Key) throws {
        switch value {
        case .omit:
            break
        case .null:
            try encodeNil(forKey: key)
        case .value(let wrapped):
            try encode(wrapped, forKey: key)
        }
    }
}

struct AnyEncodable: Encodable {
    private let encodeClosure: (Encoder) throws -> Void

    init<T: Encodable>(_ value: T) {
        self.encodeClosure = value.encode
    }

    func encode(to encoder: Encoder) throws {
        try encodeClosure(encoder)
    }
}
