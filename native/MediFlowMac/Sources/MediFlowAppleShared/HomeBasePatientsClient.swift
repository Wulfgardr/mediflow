// Codex: created 2026-04-17
import CryptoKit
import Foundation


public actor HomeBasePatientsClient {
    private let configuration: HomeBaseConnectionConfiguration
    private let session: URLSession

    init(configuration: HomeBaseConnectionConfiguration, session: URLSession) {
        self.configuration = configuration
        self.session = session
    }

    public init(configuration: HomeBaseConnectionConfiguration) {
        self.configuration = configuration
        let delegate = HomeBaseTLSSessionDelegate(expectedPin: configuration.normalizedTLSPin)
        let sessionConfiguration = URLSessionConfiguration.ephemeral
        sessionConfiguration.httpShouldSetCookies = false
        self.session = URLSession(configuration: sessionConfiguration, delegate: delegate, delegateQueue: nil)
    }

    public func verifyPreviousNativeAuthorityRetirement(_ reference: String, credentials: HomeBasePairedCredentials,
                                                        sessionCookie: String) async throws -> NativeAuthorityRetirement {
        guard NativeOrdinaryDisclosure.matches(reference, "^[a-f0-9]{64}$") else { throw NativeOrdinaryContractError.invalid }
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/authority-retirement")
        let headers = pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil)
            .merging(["Cache-Control": "no-store"]) { _, new in new }
        let (data, _) = try await send(to: url, method: "POST", headers: headers,
            body: encode(["previousAuthorityRef": reference]))
        return try decode(NativeAuthorityRetirement.self, from: data)
    }

    public func prepareNativeFabric(_ preparation: NativeOrdinaryPreparation, credentials: HomeBasePairedCredentials,
                                    sessionCookie: String) async throws -> NativeFabricResponse {
        try preparation.validate()
        return try await fabricRequest("prepare", method: "POST", credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: preparation.ambulatoryId, body: encode(preparation))
    }
    public func projectNativeFabric(_ plan: NativeOrdinaryProjectionPlan, body: Data, credentials: HomeBasePairedCredentials,
                                    sessionCookie: String, ambulatoryId: String?) async throws -> NativeFabricResponse {
        let maximum = plan.functionId == .documentSynthesis ? 25 * 1024 * 1024 : 2 * 1024 * 1024
        guard NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$"), !body.isEmpty, body.count <= maximum else { throw NativeOrdinaryContractError.invalid }
        return try await fabricRequest("project", method: "POST", credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, body: body, extra: ["X-MediFlow-Ordinary-Projection": plan.grantId,
                "Content-Type": plan.functionId == .documentSynthesis ? "application/octet-stream" : "application/json"])
    }
    public func cancelNativeFabricProjection(_ plan: NativeOrdinaryProjectionPlan, credentials: HomeBasePairedCredentials,
                                             sessionCookie: String, ambulatoryId: String?) async throws -> NativeFabricResponse {
        guard NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$") else { throw NativeOrdinaryContractError.invalid }
        return try await fabricRequest("project", method: "DELETE", credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, extra: ["X-MediFlow-Ordinary-Projection": plan.grantId])
    }
    public func commandNativeFabric(_ command: NativeFabricCommand, credentials: HomeBasePairedCredentials,
                                    sessionCookie: String, ambulatoryId: String?) async throws -> NativeFabricResponse {
        guard UUID(uuidString: command.attemptId) != nil else { throw NativeOrdinaryContractError.invalid }
        return try await fabricRequest(command.path, method: "POST", credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, body: encode(["attemptId": command.attemptId]))
    }
    public func statusNativeFabric(attemptId: String?, credentials: HomeBasePairedCredentials,
                                   sessionCookie: String, ambulatoryId: String?) async throws -> NativeFabricResponse {
        if let attemptId, UUID(uuidString: attemptId) == nil { throw NativeOrdinaryContractError.invalid }
        return try await fabricRequest("status", method: "GET", credentials: credentials, sessionCookie: sessionCookie,
            ambulatoryId: ambulatoryId, extra: attemptId.map { ["X-MediFlow-Fabric-Attempt": $0] } ?? [:])
    }
    private func fabricRequest(_ path: String, method: String, credentials: HomeBasePairedCredentials,
                               sessionCookie: String, ambulatoryId: String?, body: Data? = nil,
                               extra: [String: String] = [:]) async throws -> NativeFabricResponse {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/fabric/\(path)")
        let headers = pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .merging(["Cache-Control": "no-store"]) { _, new in new }.merging(extra) { _, new in new }
        let (data, _) = try await send(to: url, method: method, headers: headers, body: body)
        return try decode(NativeFabricResponse.self, from: data)
    }

    /* named paired Apple ordinary routes, distinct from account/configuration. */
    public func prepareNativeOrdinary(_ preparation: NativeOrdinaryPreparation, credentials: HomeBasePairedCredentials,
                                      sessionCookie: String) async throws -> NativeOrdinaryResponse {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/chatgpt/ordinary/prepare")
        let (data, _) = try await send(to: url, method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: preparation.ambulatoryId),
            body: encode(preparation))
        return try decode(NativeOrdinaryResponse.self, from: data)
    }
    /* only the named pre-attempt projection endpoint accepts these bounded bytes. */
    public func projectNativeOrdinary(_ plan: NativeOrdinaryProjectionPlan, body: Data,
                                      credentials: HomeBasePairedCredentials, sessionCookie: String,
                                      ambulatoryId: String?) async throws -> NativeOrdinaryResponse {
        let maximum = plan.functionId == .documentSynthesis ? 25 * 1024 * 1024 : 2 * 1024 * 1024
        guard NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$"), !body.isEmpty, body.count <= maximum else { throw NativeOrdinaryContractError.invalid }
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/chatgpt/ordinary/project")
        let headers = pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging([
            "X-MediFlow-Ordinary-Projection": plan.grantId, "Cache-Control": "no-store",
            "Content-Type": plan.functionId == .documentSynthesis ? "application/octet-stream" : "application/json"
        ]) { _, new in new }
        let (data, _) = try await send(to: url, method: "POST", headers: headers, body: body)
        return try decode(NativeOrdinaryResponse.self, from: data)
    }
    public func cancelNativeOrdinaryProjection(_ plan: NativeOrdinaryProjectionPlan, credentials: HomeBasePairedCredentials,
                                               sessionCookie: String, ambulatoryId: String?) async throws -> NativeOrdinaryResponse {
        guard NativeOrdinaryDisclosure.matches(plan.grantId, "^[a-f0-9]{64}$") else { throw NativeOrdinaryContractError.invalid }
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/chatgpt/ordinary/project")
        let headers = pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging([
            "X-MediFlow-Ordinary-Projection": plan.grantId, "Cache-Control": "no-store"
        ]) { _, new in new }
        let (data, _) = try await send(to: url, method: "DELETE", headers: headers)
        return try decode(NativeOrdinaryResponse.self, from: data)
    }
    public func commandNativeOrdinary(_ command: NativeOrdinaryCommand, credentials: HomeBasePairedCredentials,
                                      sessionCookie: String, ambulatoryId: String?) async throws -> NativeOrdinaryResponse {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/chatgpt/ordinary/\(command.path)")
        let (data, _) = try await send(to: url, method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(command.body))
        return try decode(NativeOrdinaryResponse.self, from: data)
    }
    public func statusNativeOrdinary(credentials: HomeBasePairedCredentials, sessionCookie: String,
                                     ambulatoryId: String?) async throws -> NativeOrdinaryResponse {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/chatgpt/ordinary/status")
        let (data, _) = try await send(to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId))
        return try decode(NativeOrdinaryResponse.self, from: data)
    }

    public func readNativeFunctionPreferences(credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> NativeAIFunctionPreferences {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/functions")
        let (data, _) = try await send(to: url, headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil).merging(["Cache-Control": "no-store"]) { _, new in new })
        let value = try decode(NativeAIFunctionPreferences.self, from: data)
        try value.validate(); return value
    }

    public func previewNativeFunctionPreferences(_ command: NativeAIFunctionCommand, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> NativeAIFunctionPreview {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/functions/preview")
        let (data, _) = try await send(to: url, method: "POST", headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil), body: encode(command))
        let value = try decode(NativeAIFunctionPreview.self, from: data)
        try value.validate(command: command); return value
    }

    public func applyNativeFunctionPreferences(_ command: NativeAIFunctionCommand, credentials: HomeBasePairedCredentials, sessionCookie: String) async throws -> NativeAIFunctionPreferences {
        let url = try configuration.apiBaseURL().appendingPathComponent("network/ai/functions")
        let (data, _) = try await send(to: url, method: "POST", headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil), body: encode(command))
        let value = try decode(NativeAIFunctionPreferences.self, from: data)
        try value.validate(); return value
    }

    public func login(
        username: String?, password: String, credentials: HomeBasePairedCredentials
    ) async throws -> HomeBaseLoginResult {
        guard Self.hasPairedCredentials(credentials) else { throw HomeBaseClientError.contract }
        let url = try configuration.serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("auth")
            .appendingPathComponent("native")
            .appendingPathComponent("login")
        let checkURL = try configuration.serverURL().appendingPathComponent("api/auth/check")
        let (checkData, _) = try await send(to: checkURL,
            headers: ["Cache-Control": "no-store"], includesSourceSurface: false)
        if let failure = try? JSONDecoder().decode(AuthHealthFailure.self, from: checkData), failure.status == "error" {
            throw HomeBaseClientError.httpStatus(503, failure.publicMessage)
        }
        let check = try decode(AuthUnlockCheck.self, from: checkData)
        guard check.status == "ok", check.isSetup, let parameters = check.unlock else { throw HomeBaseClientError.contract }
        let material: CryptoService.UnlockMaterial?
        let body: Data
        switch parameters.credential {
        case "passphrase":
            guard parameters.kdfVersion == CryptoService.unlockKdfVersion,
                  let salt = parameters.salt.flatMap({ Data(base64Encoded: $0) }),
                  let derived = CryptoService.deriveUnlockMaterial(passphrase: password, salt: salt),
                  check.archiveGeneration != nil else { throw HomeBaseClientError.contract }
            material = derived
            body = try JSONEncoder().encode(AuthLoginRequest(username: username, verifier: derived.verifier))
        case "pin":
            guard CryptoService.normalizedPassphrase(password) == nil, password.unicodeScalars.count < 15 else {
                throw HomeBaseClientError.httpStatus(409, "L’account indica un PIN precedente. Verifica l’accesso dal browser prima di inviare questo testo.")
            }
            material = nil
            body = try JSONEncoder().encode(AuthLoginRequest(username: username, password: password))
        default: throw HomeBaseClientError.contract
        }
        try Task.checkCancellation()
        let (data, response) = try await send(
            to: url,
            method: "POST",
            headers: pairedLoginHeaders(credentials: credentials).merging(["Cache-Control": "no-store"]) { _, new in new },
            body: body,
            includesSourceSurface: false
        )
        let sessionCookie = try Self.extractSessionCookie(from: response, url: url)
        let payload: AuthLoginResponse
        var unlockedMasterKey: SymmetricKey?
        do {
            payload = try decode(AuthLoginResponse.self, from: data)
            if let material {
                guard payload.success == true, payload.id?.isEmpty == false,
                      payload.salt == parameters.salt, payload.archiveGeneration == check.archiveGeneration,
                      let wrapped = payload.encryptedMasterKey,
                      CryptoService.kdfVersion(of: wrapped) == CryptoService.unlockKdfVersion,
                      let key = CryptoService.unwrapMasterKey(wrappedBase64: CryptoService.parseWrappedMasterKey(wrapped).base64,
                                                             kek: material.kek), key.bitCount == 256 else { throw HomeBaseClientError.contract }
                unlockedMasterKey = key
            } else if let wrapped = payload.encryptedMasterKey, CryptoService.kdfVersion(of: wrapped) > 2 {
                throw HomeBaseClientError.contract
            }
        } catch {
            _ = try? await logout(credentials: credentials, sessionCookie: sessionCookie)
            throw error
        }
        return HomeBaseLoginResult(
            sessionCookie: sessionCookie,
            encryptedMasterKey: payload.encryptedMasterKey,
            salt: payload.salt,
            id: payload.id,
            username: payload.username,
            displayName: payload.displayName,
            ambulatoryName: payload.ambulatoryName,
            role: payload.role,
            masterKey: unlockedMasterKey
        )
    }

    public func changePin(
        currentPin: String,
        newPin: String,
        encryptedMasterKey: String,
        salt: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("auth")
            .appendingPathComponent("change-pin")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: accountHeaders(credentials: credentials, sessionCookie: sessionCookie),
            body: encode(AuthChangePinRequest(
                currentPin: currentPin,
                newPin: newPin,
                encryptedMasterKey: encryptedMasterKey,
                salt: salt
            ))
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func logout(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("auth")
            .appendingPathComponent("native")
            .appendingPathComponent("logout")
        let (data, response) = try await send(
            to: url,
            method: "POST",
            headers: accountHeaders(credentials: credentials, sessionCookie: sessionCookie)
        )
        // Logout is the only acknowledgement boundary that accepts the HTTP
        // no-content variant. A body would contradict the 204 contract.
        if response.statusCode == 204 {
            guard data.isEmpty else {
                throw HomeBaseClientError.contract
            }
            return HomeBaseMutationAcknowledgement(success: true)
        }
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchAccountProfile(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAccountProfile {
        let url = try configuration.serverURL().appendingPathComponent("api/auth/profile")
        let headers = accountHeaders(credentials: credentials, sessionCookie: sessionCookie)
            .merging(["Cache-Control": "no-store"]) { _, new in new }
        let (data, _) = try await send(to: url, headers: headers)
        let profile = try decode(HomeBaseAccountProfile.self, from: data)
        guard profile.operation == "account-profile.read.v1", profile.contractVersion == 1 else {
            throw HomeBaseClientError.contract
        }
        return try validatedAccountProfile(profile)
    }

    public func updateProfile(
        expectedVersion: String, displayName: String?, ambulatoryName: String?, archiveGeneration: String,
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) async throws -> HomeBaseAccountProfile {
        let url = try configuration.serverURL().appendingPathComponent("api/auth/profile")
        let headers = accountHeaders(credentials: credentials, sessionCookie: sessionCookie)
            .merging(["Cache-Control": "no-store", "x-mediflow-archive-generation": archiveGeneration]) { _, new in new }
        let (data, _) = try await send(to: url, method: "PUT", headers: headers,
            body: encode(AuthProfileUpdateRequest(expectedVersion: expectedVersion,
                displayName: displayName, ambulatoryName: ambulatoryName)))
        let profile = try decode(HomeBaseAccountProfile.self, from: data)
        guard profile.changed != nil, profile.archiveGeneration == archiveGeneration else {
            throw HomeBaseClientError.contract
        }
        return try validatedAccountProfile(profile)
    }

    private func validatedAccountProfile(_ profile: HomeBaseAccountProfile) throws -> HomeBaseAccountProfile {
        guard !profile.userId.isEmpty, !profile.username.isEmpty,
              !profile.profileVersion.isEmpty, !profile.archiveGeneration.isEmpty else {
            throw HomeBaseClientError.contract
        }
        return profile
    }

    public func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        includeDeleted: Bool = false
    ) async throws -> [HomeBasePatientSummary] {
        var url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
        if includeDeleted {
            url = url.appending(queryItems: [URLQueryItem(name: "includeDeleted", value: "true")])
        }
        let (data, _) = try await send(
            to: url,
            headers: [
                "x-mediflow-paired-client-id": credentials.clientId,
                "x-mediflow-paired-client-token": credentials.clientToken,
                "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
                "Cache-Control": "no-store",
            ]
        )
        return try decode([HomeBasePatientSummary].self, from: data)
    }

    public func fetchPatients(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        includeDiagnoses: Bool
    ) async throws -> [HomeBasePatientSummary] {
        var url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
        if includeDiagnoses {
            url = url.appending(queryItems: [URLQueryItem(name: "include", value: "diagnoses")])
        }
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBasePatientSummary].self, from: data)
    }

    // A18: fetch the ambulatory scope options for the picker. Rides on the same
    // read capability + auth headers as the patient list.
    public func fetchNetworkAmbulatories(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [NetworkAmbulatorySummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ambulatories")
        let (data, _) = try await send(
            to: url,
            headers: [
                "x-mediflow-paired-client-id": credentials.clientId,
                "x-mediflow-paired-client-token": credentials.clientToken,
                "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            ]
        )
        return try decode([NetworkAmbulatorySummary].self, from: data)
    }

    public func createAmbulatory(
        payload: HomeBaseAmbulatoryCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ambulatories")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil),
            body: encode(payload)
        )
        return try decode(HomeBaseAmbulatoryMutationResponse.self, from: data)
    }

    public func updateAmbulatory(
        id: String,
        payload: HomeBaseAmbulatoryUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ambulatories")
            .appendingPathComponent(id)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil),
            body: encode(payload)
        )
        return try decode(HomeBaseAmbulatoryMutationResponse.self, from: data)
    }

    public func deleteAmbulatory(
        id: String,
        expectedVersion: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ambulatories")
            .appendingPathComponent(id)
        let (data, _) = try await send(
            to: url,
            method: "DELETE",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil),
            body: encode(AmbulatoryVersionRequest(version: expectedVersion))
        )
        return try decode(HomeBaseAmbulatoryMutationResponse.self, from: data)
    }

    public func clearAmbulatory(
        id: String,
        expectedVersion: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String
    ) async throws -> HomeBaseAmbulatoryMutationResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ambulatories")
            .appendingPathComponent("clear")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: nil),
            body: encode(AmbulatoryClearRequest(ambulatoryId: id, version: expectedVersion))
        )
        return try decode(HomeBaseAmbulatoryMutationResponse.self, from: data)
    }

    public func searchDrugs(
        query: String,
        limit: Int = HomeBaseCatalogSearchLimit.defaultMaximum,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseDrugSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("drugs")
            .appending(queryItems: [
                URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "limit", value: String(HomeBaseCatalogSearchLimit.clamped(limit))),
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseDrugSummary].self, from: data)
    }

    public func searchExemptions(
        query: String,
        limit: Int = HomeBaseCatalogSearchLimit.defaultMaximum,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseExemptionSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("exemptions")
            .appending(queryItems: [
                URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "limit", value: String(HomeBaseCatalogSearchLimit.clamped(limit))),
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseExemptionSummary].self, from: data)
    }

    /* WUL-673. Named local WHO contracts on the canonical paired channel. */
    public func searchWHO(query: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOSearchResponse {
        let query = try HomeBaseWHODecoder.normalizedQuery(query)
        let (data, status) = try await sendWHO(path: "search", parameters: [URLQueryItem(name: "q", value: query)], credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        guard status == 200 else { throw HomeBaseWHODecoder.error(data, status: status) }
        let result = try HomeBaseWHODecoder.search(data)
        try Task.checkCancellation()
        return result
    }

    public func readWHOReadiness(credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOReadiness {
        let (data, status) = try await sendWHO(path: "readiness", parameters: [], credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        if status == 200 || status == 503, let result = try? HomeBaseWHODecoder.readiness(data) {
            guard (status == 200) == (result.status == .available) else { throw HomeBaseWHOError.invalidResponse }
            try Task.checkCancellation()
            return result
        }
        throw HomeBaseWHODecoder.error(data, status: status)
    }

    public func checkWHOCode(code: String, credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> HomeBaseWHOCodeCheckResponse {
        guard HomeBaseWHODecoder.isCheckCode(code) else { throw HomeBaseWHOError.invalidRequest }
        let (data, status) = try await sendWHO(path: "code-check", parameters: [URLQueryItem(name: "code", value: code), URLQueryItem(name: "release", value: HomeBaseWHODecoder.release)], credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        guard status == 200 else { throw HomeBaseWHODecoder.error(data, status: status) }
        let result = try HomeBaseWHODecoder.checkCode(data, requestedCode: code)
        try Task.checkCancellation()
        return result
    }

    private func sendWHO(path: String, parameters: [URLQueryItem], credentials: HomeBasePairedCredentials, sessionCookie: String, ambulatoryId: String?) async throws -> (Data, Int) {
        try Task.checkCancellation()
        guard Self.hasPairedCredentials(credentials), !sessionCookie.isEmpty,
              ["readiness", "search", "code-check"].contains(path) else { throw HomeBaseWHOError.unauthorized }
        let url = try configuration.apiBaseURL().appendingPathComponent("network/terminology/who")
            .appendingPathComponent(path).appending(queryItems: parameters)
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "GET"
        request.httpShouldHandleCookies = false
        request.setValue("native", forHTTPHeaderField: "X-MediFlow-Source-Surface")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("no-store", forHTTPHeaderField: "Cache-Control")
        for (name, value) in pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId) {
            request.setValue(value, forHTTPHeaderField: name)
        }
        do {
            // Same ephemeral URLSession and TLS delegate; no alternate transport.
            let (data, response) = try await session.data(for: request)
            try Task.checkCancellation()
            guard let response = response as? HTTPURLResponse,
                  data.count <= HomeBaseWHODecoder.maximumBytes,
                  response.mimeType?.lowercased() == "application/json"
            else { throw HomeBaseWHOError.invalidResponse }
            return (data, response.statusCode)
        } catch let error as URLError {
            if error.code == .cancelled || Task.isCancelled { throw CancellationError() }
            throw HomeBaseClientError.transport(Self.mapTransportError(error))
        }
    }

    public func searchTerminology(
        system: String,
        query: String,
        limit: Int = HomeBaseCatalogSearchLimit.defaultMaximum,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyItem] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("terminology")
            .appendingPathComponent("search")
            .appending(queryItems: [
                URLQueryItem(name: "system", value: system.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "limit", value: String(HomeBaseCatalogSearchLimit.clamped(limit))),
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseTerminologyItem].self, from: data)
    }

    public func resolveTerminology(
        system: String,
        code: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseTerminologyItem {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("terminology")
            .appendingPathComponent("resolve")
            .appending(queryItems: [
                URLQueryItem(name: "system", value: system.trimmingCharacters(in: .whitespacesAndNewlines)),
                URLQueryItem(name: "code", value: code.trimmingCharacters(in: .whitespacesAndNewlines)),
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(HomeBaseTerminologyItem.self, from: data)
    }

    public func fetchTerminologySystems(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseTerminologyRegistryEntry] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("terminology")
            .appendingPathComponent("systems")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseTerminologyRegistryEntry].self, from: data)
    }

    public func fetchPatient(
        id: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBasePatientDetail {
        // preserve the data-source protocol witness; native projection opts into a fresh read explicitly.
        try await fetchPatient(id: id, credentials: credentials, sessionCookie: sessionCookie,
                               ambulatoryId: ambulatoryId, fresh: false)
    }

    public func fetchPatient(
        id: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        fresh: Bool
    ) async throws -> HomeBasePatientDetail {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(id)
        let (data, _) = try await send(
            to: url,
            headers: [
                "x-mediflow-paired-client-id": credentials.clientId,
                "x-mediflow-paired-client-token": credentials.clientToken,
                "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            ].merging(fresh ? ["Cache-Control": "no-store"] : [:]) { _, new in new }
        )
        return try decode(HomeBasePatientDetail.self, from: data)
    }

    public func createPatient(
        payload: HomeBasePatientCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func softDeletePatient(
        id: String,
        version: Int,
        sealedReason: String?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(id)
        let (data, _) = try await send(
            to: url,
            method: "DELETE",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(HomeBasePatientSoftDeletePayload(version: version, deletionReason: sealedReason))
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func restorePatient(
        id: String,
        version: Int,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(id)
            .appendingPathComponent("restore")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(HomeBasePatientRestorePayload(version: version))
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func fetchEntry(
        patientId: String, entryId: String, credentials: HomeBasePairedCredentials,
        sessionCookie: String, ambulatoryId: String?
    ) async throws -> HomeBaseEntrySummary {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network/patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
            .appendingPathComponent(entryId)
        let headers = pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
            .merging(["Cache-Control": "no-store"]) { _, new in new }
        let (data, _) = try await send(to: url, headers: headers)
        let entry = try decode(HomeBaseEntrySummary.self, from: data)
        guard entry.id == entryId, entry.patientId == patientId else { throw HomeBaseClientError.contract }
        return entry
    }

    public func fetchEntries(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
    ) async throws -> [HomeBaseEntrySummary] {
        // preserve the protocol witness while keeping cache bypass explicit at the projection boundary.
        try await fetchEntries(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                               ambulatoryId: ambulatoryId, limit: limit, fresh: false)
    }

    public func fetchEntries(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum,
        fresh: Bool
    ) async throws -> [HomeBaseEntrySummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
            .appending(queryItems: [
                URLQueryItem(name: "limit", value: String(HomeBaseClinicalListLimit.clamped(limit)))
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging(fresh ? ["Cache-Control": "no-store"] : [:]) { _, new in new }
        )
        return try decode([HomeBaseEntrySummary].self, from: data)
    }

    public func createEntry(
        patientId: String,
        payload: HomeBaseEntryCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updatePatient(
        patientId: String,
        payload: HomeBasePatientUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func updateEntry(
        patientId: String,
        entryId: String,
        payload: HomeBaseEntryUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("entries")
            .appendingPathComponent(entryId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchAttachments(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseAttachmentSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("attachments")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseAttachmentSummary].self, from: data)
    }

    public func fetchAttachment(
        patientId: String,
        attachmentId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseAttachmentDetail {
        // preserve the data-source protocol witness; sensitive projection reads pass fresh explicitly.
        try await fetchAttachment(patientId: patientId, attachmentId: attachmentId, credentials: credentials,
                                  sessionCookie: sessionCookie, ambulatoryId: ambulatoryId, fresh: false)
    }

    public func fetchAttachment(
        patientId: String,
        attachmentId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        fresh: Bool
    ) async throws -> HomeBaseAttachmentDetail {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("attachments")
            .appendingPathComponent(attachmentId)
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging(fresh ? ["Cache-Control": "no-store"] : [:]) { _, new in new }
        )
        return try decode(HomeBaseAttachmentDetail.self, from: data)
    }

    public func createAttachment(
        patientId: String,
        payload: HomeBaseAttachmentCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("attachments")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: HomeBaseAttachmentWirePrecheck.encodedBody(for: payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func computeVisitDraft(
        input: HomeBaseVisitDraftInput,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseVisitDraftResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("visit-draft")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(input)
        )
        return try decode(HomeBaseVisitDraftResponse.self, from: data)
    }

    public func fetchAiRuntimeStatus(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseNetworkAiRuntimeSummary {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("ai-runtime")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(HomeBaseNetworkAiRuntimeSummary.self, from: data)
    }

    public func fetchTherapies(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
    ) async throws -> [HomeBaseTherapySummary] {
        // preserve the protocol witness while keeping cache bypass explicit at the projection boundary.
        try await fetchTherapies(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                                 ambulatoryId: ambulatoryId, limit: limit, fresh: false)
    }

    public func fetchTherapies(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum,
        fresh: Bool
    ) async throws -> [HomeBaseTherapySummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("therapies")
            .appending(queryItems: [
                URLQueryItem(name: "limit", value: String(HomeBaseClinicalListLimit.clamped(limit)))
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging(fresh ? ["Cache-Control": "no-store"] : [:]) { _, new in new }
        )
        return try decode([HomeBaseTherapySummary].self, from: data)
    }

    public func createTherapy(
        patientId: String,
        payload: HomeBaseTherapyCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("therapies")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateTherapy(
        patientId: String,
        therapyId: String,
        payload: HomeBaseTherapyUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("therapies")
            .appendingPathComponent(therapyId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchCheckups(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
    ) async throws -> [HomeBaseCheckupSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("checkups")
            .appending(queryItems: [
                URLQueryItem(name: "limit", value: String(HomeBaseClinicalListLimit.clamped(limit)))
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseCheckupSummary].self, from: data)
    }

    public func fetchScopedCheckups(
        dateFrom: Date?,
        dateTo: Date?,
        status: [String],
        limit: Int?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseCheckupSummary] {
        var queryItems = [URLQueryItem]()
        if let dateFrom {
            queryItems.append(URLQueryItem(name: "dateFrom", value: Self.queryDateValue(dateFrom)))
        }
        if let dateTo {
            queryItems.append(URLQueryItem(name: "dateTo", value: Self.queryDateValue(dateTo)))
        }
        queryItems.append(contentsOf: status.map { URLQueryItem(name: "status", value: $0) })
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("checkups")
            .appending(queryItems: queryItems)
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseCheckupSummary].self, from: data)
    }

    public func fetchScopedEntries(
        type: String?,
        dateFrom: Date?,
        dateTo: Date?,
        limit: Int?,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseEntrySummary] {
        var queryItems = [URLQueryItem]()
        if let type {
            queryItems.append(URLQueryItem(name: "type", value: type))
        }
        if let dateFrom {
            queryItems.append(URLQueryItem(name: "dateFrom", value: Self.queryDateValue(dateFrom)))
        }
        if let dateTo {
            queryItems.append(URLQueryItem(name: "dateTo", value: Self.queryDateValue(dateTo)))
        }
        if let limit {
            queryItems.append(URLQueryItem(name: "limit", value: String(limit)))
        }
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("entries")
            .appending(queryItems: queryItems)
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseEntrySummary].self, from: data)
    }

    public func createCheckup(
        patientId: String,
        payload: HomeBaseCheckupCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("checkups")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateCheckup(
        patientId: String,
        checkupId: String,
        payload: HomeBaseCheckupUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("checkups")
            .appendingPathComponent(checkupId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchObservations(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
    ) async throws -> [HomeBaseObservationSummary] {
        // preserve the protocol witness while keeping cache bypass explicit at the projection boundary.
        try await fetchObservations(patientId: patientId, credentials: credentials, sessionCookie: sessionCookie,
                                    ambulatoryId: ambulatoryId, limit: limit, fresh: false)
    }

    public func fetchObservations(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum,
        fresh: Bool
    ) async throws -> [HomeBaseObservationSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("observations")
            .appending(queryItems: [
                URLQueryItem(name: "limit", value: String(HomeBaseClinicalListLimit.clamped(limit)))
            ])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId).merging(fresh ? ["Cache-Control": "no-store"] : [:]) { _, new in new }
        )
        return try decode([HomeBaseObservationSummary].self, from: data)
    }

    public func createObservation(
        patientId: String,
        payload: HomeBaseObservationCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("observations")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateObservation(
        patientId: String,
        observationId: String,
        payload: HomeBaseObservationUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("patients")
            .appendingPathComponent(patientId)
            .appendingPathComponent("observations")
            .appendingPathComponent(observationId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchServicePrescriptions(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescriptions")
            .appending(queryItems: [URLQueryItem(name: "patientId", value: patientId)])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseServicePrescriptionSummary].self, from: data)
    }

    public func createServicePrescription(
        payload: HomeBaseServicePrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescriptions")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateServicePrescription(
        prescriptionId: String,
        payload: HomeBaseServicePrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescriptions")
            .appendingPathComponent(prescriptionId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchServicePrescriptionItems(
        patientId: String? = nil,
        prescriptionId: String? = nil,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServicePrescriptionItemSummary] {
        var queryItems: [URLQueryItem] = []
        if let prescriptionId {
            queryItems.append(URLQueryItem(name: "prescriptionId", value: prescriptionId))
        }
        if let patientId {
            queryItems.append(URLQueryItem(name: "patientId", value: patientId))
        }
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescription-items")
            .appending(queryItems: queryItems)
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseServicePrescriptionItemSummary].self, from: data)
    }

    public func createServicePrescriptionItem(
        payload: HomeBaseServicePrescriptionItemCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescription-items")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateServicePrescriptionItem(
        itemId: String,
        payload: HomeBaseServicePrescriptionItemUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-prescription-items")
            .appendingPathComponent(itemId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchServiceCatalog(
        query: String? = nil,
        code: String? = nil,
        limit: Int = HomeBaseCatalogSearchLimit.defaultMaximum,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseServiceCatalogEntrySummary] {
        var queryItems: [URLQueryItem] = [
            URLQueryItem(name: "limit", value: String(HomeBaseCatalogSearchLimit.clamped(limit)))
        ]
        if let query {
            queryItems.append(URLQueryItem(name: "q", value: query.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        if let code {
            queryItems.append(URLQueryItem(name: "code", value: code.trimmingCharacters(in: .whitespacesAndNewlines)))
        }
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-catalog")
            .appending(queryItems: queryItems)
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseServiceCatalogEntrySummary].self, from: data)
    }

    public func fetchServiceCatalogCount(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCatalogCountResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("service-catalog")
            .appending(queryItems: [URLQueryItem(name: "count", value: "1")])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(HomeBaseCatalogCountResponse.self, from: data)
    }

    public func fetchProstheticPrescriptions(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> [HomeBaseProstheticPrescriptionSummary] {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("prosthetic-prescriptions")
            .appending(queryItems: [URLQueryItem(name: "patientId", value: patientId)])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseProstheticPrescriptionSummary].self, from: data)
    }

    public func createProstheticPrescription(
        payload: HomeBaseProstheticPrescriptionCreatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseCreatedResource {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("prosthetic-prescriptions")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseCreatedResource.self, from: data)
    }

    public func updateProstheticPrescription(
        prescriptionId: String,
        payload: HomeBaseProstheticPrescriptionUpdatePayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseMutationAcknowledgement {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("prosthetic-prescriptions")
            .appendingPathComponent(prescriptionId)
        let (data, _) = try await send(
            to: url,
            method: "PUT",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseMutationAcknowledgement.self, from: data)
    }

    public func fetchNetworkCapabilities(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkCapabilitiesResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("capabilities")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(NetworkCapabilitiesResponse.self, from: data)
    }

    public func fetchNetworkIdentity(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkIdentitySummary {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("identity")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(NetworkIdentitySummary.self, from: data)
    }

    public func fetchNetworkNode(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkNodeSummary {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("node")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(NetworkNodeSummary.self, from: data)
    }

    public func fetchNetworkRevision(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> NetworkRevisionSummary {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("revision")
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(NetworkRevisionSummary.self, from: data)
    }

    public func fetchFseValidatePatient(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseValidatePatientExportResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("fse")
            .appendingPathComponent("validate-patient")
            .appending(queryItems: [URLQueryItem(name: "patientId", value: patientId)])
        let (data, _) = try await send(
            to: url,
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode(HomeBaseValidatePatientExportResponse.self, from: data)
    }

    public func validateFseDocument(
        payload: HomeBaseFseDocumentValidationPayload,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) async throws -> HomeBaseFseDocumentValidationResponse {
        let url = try configuration.apiBaseURL()
            .appendingPathComponent("network")
            .appendingPathComponent("fse")
            .appendingPathComponent("validate-document")
        let (data, _) = try await send(
            to: url,
            method: "POST",
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
            body: encode(payload)
        )
        return try decode(HomeBaseFseDocumentValidationResponse.self, from: data)
    }

    static func cookieHeader(sessionCookie: String, ambulatoryId: String?) -> String {
        let trimmedAmbulatory = ambulatoryId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !trimmedAmbulatory.isEmpty else { return sessionCookie }
        return "\(sessionCookie); ambulatory_id=\(trimmedAmbulatory)"
    }

    private func pairedHeaders(
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?
    ) -> [String: String] {
        [
            "x-mediflow-paired-client-id": credentials.clientId,
            "x-mediflow-paired-client-token": credentials.clientToken,
            "Cookie": Self.cookieHeader(sessionCookie: sessionCookie, ambulatoryId: ambulatoryId),
        ]
    }

    private func pairedLoginHeaders(credentials: HomeBasePairedCredentials) -> [String: String] {
        [
            "x-mediflow-paired-client-id": credentials.clientId,
            "x-mediflow-paired-client-token": credentials.clientToken,
        ]
    }

    private func accountHeaders(
        credentials: HomeBasePairedCredentials, sessionCookie: String
    ) -> [String: String] {
        pairedLoginHeaders(credentials: credentials).merging(["Cookie": sessionCookie]) { _, new in new }
    }

    private static func hasPairedCredentials(_ credentials: HomeBasePairedCredentials) -> Bool {
        !credentials.clientId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && !credentials.clientToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private static func queryDateValue(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func send(
        to url: URL,
        method: String = "GET",
        headers: [String: String] = [:],
        body: Data? = nil,
        includesSourceSurface: Bool = true
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        if includesSourceSurface {
            request.setValue("native", forHTTPHeaderField: "X-MediFlow-Source-Surface")
        }
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if body != nil && request.value(forHTTPHeaderField: "Content-Type") == nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        if request.value(forHTTPHeaderField: "Cache-Control") == "no-store" {
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        }
        do {
            try Task.checkCancellation()
            let sensitive = request.value(forHTTPHeaderField: "Cache-Control") == "no-store"
                || url.path.hasPrefix("/api/v1/network/ai/chatgpt/ordinary/")
            let (data, response) = try await session.data(for: request,
                delegate: sensitive ? NativeOrdinaryNoRedirectDelegate() : nil)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw HomeBaseClientError.contract
            }
            guard 200..<300 ~= httpResponse.statusCode else {
                if url == (try? configuration.serverURL().appendingPathComponent("api/auth/check")) {
                    let failure = try? JSONDecoder().decode(AuthHealthFailure.self, from: data)
                    throw HomeBaseClientError.httpStatus(httpResponse.statusCode,
                        failure?.publicMessage ?? AuthHealthFailure.unavailableMessage)
                }
                if url.path.hasPrefix("/api/v1/network/ai/fabric/") {
                    let code = (try? JSONDecoder().decode(APIErrorPayload.self, from: data))?.code
                    throw NativeFabricFailure(status: httpResponse.statusCode, code: NativeFabricFailure.Code(rawValue: code ?? "") ?? .unavailable)
                }
                // Only this exact native operation may preserve a pending device login.
                if method == "POST", url.path == "/api/v1/network/ai/chatgpt/ordinary/login/complete",
                   httpResponse.statusCode == 503,
                   let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data), payload.code == "login_pending" {
                    throw NativeOrdinaryContractError.loginPending
                }
                if url.path.hasPrefix("/api/v1/network/ai/chatgpt/ordinary/"),
                   let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data),
                   let rawCode = payload.code, let code = NativeOrdinaryFailureCode(rawValue: rawCode) {
                    throw NativeOrdinaryServerFailure(status: httpResponse.statusCode, code: code)
                }
                if url.path.hasPrefix("/api/v1/network/ai/chatgpt/ordinary/") {
                    throw HomeBaseClientError.httpStatus(httpResponse.statusCode, nil)
                }
                if url == (try? configuration.serverURL().appendingPathComponent("api/auth/profile")), httpResponse.statusCode == 409,
                   let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data) {
                    if payload.code == "ARCHIVE_REPLACED" { throw HomeBaseClientError.archiveReplaced }
                    if payload.code == "PROFILE_VERSION_CONFLICT" {
                        let profile = try validatedAccountProfile(decode(HomeBaseAccountProfile.self, from: data))
                        throw HomeBaseClientError.profileVersionConflict(profile)
                    }
                }
                if [404, 409].contains(httpResponse.statusCode),
                   let code = (try? JSONDecoder().decode(APIErrorPayload.self, from: data))?.code,
                   let failure = HomeBaseScaleWriteError(rawValue: code) {
                    throw failure
                }
                // WUL-308: a 409 carries a structured VERSION_CONFLICT body; surface
                // it as a typed error so the UI can show expected-vs-current version.
                if httpResponse.statusCode == 409,
                   let conflict = try? JSONDecoder().decode(VersionConflictPayload.self, from: data),
                   conflict.code == "VERSION_CONFLICT" {
                    throw HomeBaseClientError.versionConflict(conflict)
                }
                if httpResponse.statusCode == 409,
                   let payload = try? JSONDecoder().decode(APIErrorPayload.self, from: data),
                   payload.code == "PIN_CHANGE_CONFLICT" {
                    throw HomeBaseClientError.pinChangeConflict(payload.message ?? payload.error)
                }
                throw HomeBaseClientError.httpStatus(httpResponse.statusCode, Self.errorMessage(from: data))
            }
            return (data, httpResponse)
        } catch let error as URLError {
            throw HomeBaseClientError.transport(Self.mapTransportError(error))
        }
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = HomeBaseDateCoding.tolerantISO8601Strategy
        do {
            return try decoder.decode(type, from: data)
        } catch {
            throw HomeBaseClientError.contract
        }
    }

    private func encode<T: Encodable>(_ payload: T) throws -> Data {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return try encoder.encode(payload)
    }

    private static func extractSessionCookie(from response: HTTPURLResponse, url: URL) throws -> String {
        let headers = response.allHeaderFields.reduce(into: [String: String]()) { result, item in
            if let key = item.key as? String, let value = item.value as? String {
                result[key] = value
            }
        }
        let cookies = HTTPCookie.cookies(withResponseHeaderFields: headers, for: url)
        guard let session = cookies.first(where: { $0.name == "mediflow_session" }) else {
            throw HomeBaseClientError.missingSessionCookie
        }
        return "\(session.name)=\(session.value)"
    }

    private static func errorMessage(from data: Data) -> String? {
        guard !data.isEmpty else { return nil }
        return (try? JSONDecoder().decode(APIErrorPayload.self, from: data)).flatMap { $0.message ?? $0.error }
    }

    private static func mapTransportError(_ error: URLError) -> HomeBaseTransportIssue {
        switch error.code {
        case .cancelled, .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateHasUnknownRoot:
            return .tlsHandshakeFailed
        case .cannotConnectToHost, .cannotFindHost, .notConnectedToInternet:
            return .unreachable
        case .timedOut:
            return .timeout
        default:
            return .other(error.code.rawValue)
        }
    }
}

private final class HomeBaseTLSSessionDelegate: NSObject, URLSessionDelegate {
    private let expectedPin: String

    init(expectedPin: String) {
        self.expectedPin = expectedPin
    }

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

        if !expectedPin.isEmpty,
           let certificate = (SecTrustCopyCertificateChain(serverTrust) as? [SecCertificate])?.first {
            let pin = SHA256.hash(data: SecCertificateCopyData(certificate) as Data)
                .map { String(format: "%02x", $0) }
                .joined()
            if pin == expectedPin {
                completionHandler(.useCredential, URLCredential(trust: serverTrust))
            } else {
                completionHandler(.cancelAuthenticationChallenge, nil)
            }
            return
        }

        if SecTrustEvaluateWithError(serverTrust, nil) {
            completionHandler(.useCredential, URLCredential(trust: serverTrust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

private struct AuthLoginRequest: Encodable {
    let username: String?
    var password: String? = nil
    var verifier: String? = nil
}

private struct AuthHealthFailure: Decodable {
    let status: String
    let error: Diagnostic

    struct Diagnostic: Decodable {
        let code: String
    }

    static let unavailableMessage = "Il servizio di accesso sul Mac non è disponibile. Verifica MediFlow sul Mac e riprova."

    var publicMessage: String {
        switch error.code {
        case "DATA_DIR_UNAVAILABLE":
            return "La cartella dell’archivio sul Mac non è disponibile. Verifica l’accesso alla cartella dati sul Mac e riprova."
        case "DB_MISSING":
            return "L’archivio sul Mac non è stato trovato. Verifica la cartella dati o un backup valido sul Mac, conservando l’originale."
        case "DB_SCHEMA_MISSING":
            return "L’archivio richiede una versione compatibile di MediFlow. Verifica il recupero sul Mac, conservando l’originale."
        case "DB_NATIVE_DEPENDENCY_INVALID", "DB_NATIVE_DEPENDENCY_MISSING":
            return "Il componente SQLite sul Mac non è disponibile o compatibile. Verifica l’installazione di MediFlow sul Mac e riavviala."
        case "DB_QUERY_FAILED":
            return "L’archivio sul Mac non è leggibile. Verifica MediFlow sul Mac, conservando l’originale."
        default:
            return Self.unavailableMessage
        }
    }
}

private struct AuthUnlockCheck: Decodable {
    let status: String
    let isSetup: Bool
    let archiveGeneration: String?
    let unlock: Parameters?
    struct Parameters: Decodable {
        let credential: String
        let kdfVersion: Int?
        let salt: String?
    }
}

// The /api/auth/login body carries the operator's wrapped master key + PBKDF2
// salt (base64), exactly as the web client consumes them.
private struct AuthLoginResponse: Decodable {
    let success: Bool?
    let archiveGeneration: String?
    let encryptedMasterKey: String?
    let salt: String?
    let id: String?
    let username: String?
    let displayName: String?
    let ambulatoryName: String?
    let role: String?
}

public struct HomeBaseLoginResult: Sendable {
    public let masterKey: SymmetricKey?
    public let sessionCookie: String
    public let encryptedMasterKey: String?
    public let salt: String?
    public let id: String?
    public let username: String?
    public let displayName: String?
    public let ambulatoryName: String?
    public let role: String?

    public init(
        sessionCookie: String,
        encryptedMasterKey: String?,
        salt: String?,
        id: String? = nil,
        username: String? = nil,
        displayName: String? = nil,
        ambulatoryName: String? = nil,
        role: String? = nil,
        masterKey: SymmetricKey? = nil
    ) {
        self.sessionCookie = sessionCookie
        self.encryptedMasterKey = encryptedMasterKey
        self.salt = salt
        self.id = id
        self.username = username
        self.displayName = displayName
        self.ambulatoryName = ambulatoryName
        self.role = role
        self.masterKey = masterKey
    }
}

private struct APIErrorPayload: Decodable {
    let error: String?
    let message: String?
    let code: String?
}

private struct AuthChangePinRequest: Encodable {
    let currentPin: String
    let newPin: String
    let encryptedMasterKey: String
    let salt: String
}

private struct AuthProfileUpdateRequest: Encodable {
    let expectedVersion: String
    let displayName: String?
    let ambulatoryName: String?

    enum CodingKeys: String, CodingKey { case expectedVersion, displayName, ambulatoryName }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(expectedVersion, forKey: .expectedVersion)
        try container.encode(displayName, forKey: .displayName)
        try container.encode(ambulatoryName, forKey: .ambulatoryName)
    }
}

private struct AmbulatoryVersionRequest: Encodable {
    let version: Int
}

private struct AmbulatoryClearRequest: Encodable {
    let ambulatoryId: String
    let version: Int
}

public enum HomeBaseScaleWriteError: String, Error, LocalizedError {
    case patientInactive = "SCALE_PATIENT_INACTIVE"
    case payloadConflict = "SCALE_IDEMPOTENCY_CONFLICT"
    public var errorDescription: String? {
        switch self {
        case .patientInactive: "Paziente archiviato o rimosso. Nessuna nuova registrazione. La bozza è conservata."
        case .payloadConflict: "Questo invio è già associato a un contenuto diverso. Verifica gli esiti registrati prima di iniziare una nuova valutazione."
        }
    }
}

public struct HomeBaseCreatedResource: Decodable, Equatable, Sendable {
    public let id: String
    public let version: Int?
    public let idempotent: Bool?
    public init(id: String, version: Int?, idempotent: Bool? = nil) {
        self.id = id
        self.version = version
        self.idempotent = idempotent
    }
}

/* the paired source/ordinary operation cannot redirect its credentials or projection. */
private final class NativeOrdinaryNoRedirectDelegate: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}
