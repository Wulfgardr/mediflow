// Codex: created 2026-04-17
// @Codex
import CryptoKit
import Foundation


public actor HomeBasePatientsClient {
    private let configuration: HomeBaseConnectionConfiguration
    private let session: URLSession

    // @Codex
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

    public func login(username: String?, password: String) async throws -> HomeBaseLoginResult {
        let url = try configuration.serverURL()
            .appendingPathComponent("api")
            .appendingPathComponent("auth")
            .appendingPathComponent("login")
        let body = try JSONEncoder().encode(AuthLoginRequest(username: username, password: password))
        let (data, response) = try await send(to: url, method: "POST", body: body)
        let sessionCookie = try Self.extractSessionCookie(from: response, url: url)
        // The login body carries the wrapped master key + PBKDF2 salt (same as the
        // web client). We keep them so the PIN can unwrap the field-crypto key.
        let payload = try? JSONDecoder().decode(AuthLoginResponse.self, from: data)
        return HomeBaseLoginResult(
            sessionCookie: sessionCookie,
            encryptedMasterKey: payload?.encryptedMasterKey,
            salt: payload?.salt
        )
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
            ]
        )
        return try decode([HomeBasePatientSummary].self, from: data)
    }

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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
            ]
        )
        return try decode(HomeBasePatientDetail.self, from: data)
    }

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
    public func fetchEntries(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
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
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseEntrySummary].self, from: data)
    }

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
    public func fetchTherapies(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
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
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseTherapySummary].self, from: data)
    }

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
    public func fetchObservations(
        patientId: String,
        credentials: HomeBasePairedCredentials,
        sessionCookie: String,
        ambulatoryId: String?,
        limit: Int = HomeBaseClinicalListLimit.boundaryMaximum
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
            headers: pairedHeaders(credentials: credentials, sessionCookie: sessionCookie, ambulatoryId: ambulatoryId)
        )
        return try decode([HomeBaseObservationSummary].self, from: data)
    }

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    /* @Codex */
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

    private static func queryDateValue(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.string(from: date)
    }

    private func send(
        to url: URL,
        method: String = "GET",
        headers: [String: String] = [:],
        body: Data? = nil
    ) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("native", forHTTPHeaderField: "X-MediFlow-Source-Surface")
        for (key, value) in headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        if body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        do {
            let (data, response) = try await session.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse else {
                throw HomeBaseClientError.contract
            }
            guard 200..<300 ~= httpResponse.statusCode else {
                // WUL-308: a 409 carries a structured VERSION_CONFLICT body; surface
                // it as a typed error so the UI can show expected-vs-current version.
                if httpResponse.statusCode == 409,
                   let conflict = try? JSONDecoder().decode(VersionConflictPayload.self, from: data),
                   conflict.code == "VERSION_CONFLICT" {
                    throw HomeBaseClientError.versionConflict(conflict)
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
    let password: String
}

// The /api/auth/login body carries the operator's wrapped master key + PBKDF2
// salt (base64), exactly as the web client consumes them.
private struct AuthLoginResponse: Decodable {
    let encryptedMasterKey: String?
    let salt: String?
}

public struct HomeBaseLoginResult: Sendable {
    public let sessionCookie: String
    public let encryptedMasterKey: String?
    public let salt: String?

    public init(sessionCookie: String, encryptedMasterKey: String?, salt: String?) {
        self.sessionCookie = sessionCookie
        self.encryptedMasterKey = encryptedMasterKey
        self.salt = salt
    }
}

private struct APIErrorPayload: Decodable {
    let error: String?
    let message: String?
}

/* @Codex */
public struct HomeBaseCreatedResource: Decodable, Equatable, Sendable {
    public let id: String
    public let version: Int?
}
