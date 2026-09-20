/* @Codex — fresh paired HTTP reads; the key is read only from the current unlocked client. */
#if os(macOS)
import Foundation
import MediFlowCore

/// These closures belong to the live model generation, not to the retained preparation snapshot.
@MainActor
struct NativeOrdinaryProjectionIO {
    let current: () throws -> ClinicalWorkspaceConnection
    let willSubmit: () throws -> Void
}

@MainActor
enum NativeOrdinaryProjectionClient {
    static func project(_ plan: NativeOrdinaryProjectionPlan, preparation: NativeOrdinaryPreparation,
                        io: NativeOrdinaryProjectionIO, client injectedClient: HomeBasePatientsClient? = nil) async throws -> NativeOrdinaryResponse {
        try plan.validate(preparation: preparation)
        let initial = try io.current(), identity = initial.identity
        guard let url = initial.serverURL, let pin = initial.tlsPin, !pin.isEmpty else { throw NativeOrdinaryContractError.invalid }
        // The test seam substitutes only URLSession transport, never a plaintext or local-data provider.
        let client = injectedClient ?? HomeBasePatientsClient(configuration: HomeBaseConnectionConfiguration(serverURLString: url, tlsPin: pin))
        func current() throws -> ClinicalWorkspaceConnection {
            try Task.checkCancellation()
            let value = try io.current()
            guard value.identity == identity, value.ambulatoryId == preparation.ambulatoryId,
                  value.masterKey != nil, Date().timeIntervalSince1970 * 1000 < plan.expiresAt else { throw NativeOrdinaryContractError.stale }
            return value
        }
        func decrypt(_ ciphertext: String?, structured: Bool = false, maximum: Int = 262_144) throws -> String {
            let fresh = try current()
            guard let ciphertext, ciphertext.hasPrefix(CryptoService.encPrefix) else { throw NativeOrdinaryContractError.noSources }
            let plaintext = structured
                ? PatientFieldCrypto.decryptStructuredField(ciphertext, masterKey: fresh.masterKey)
                : PatientFieldCrypto.decryptStringField(ciphertext, masterKey: fresh.masterKey)
            guard let plaintext, plaintext.utf16.count <= maximum,
                  !plaintext.contains("ENC:"), !plaintext.contains("[LOCKED DATA]"), !plaintext.contains("\0")
            else { throw NativeOrdinaryContractError.noSources }
            return plaintext
        }
        let connection = try current()
        let patient = try await client.fetchPatient(id: preparation.patientId, credentials: connection.credentials,
            sessionCookie: connection.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
        _ = try current()
        guard patient.id == preparation.patientId, patient.ambulatoryId == preparation.ambulatoryId,
              patient.version == preparation.patientRevision, patient.deletedAt == nil, patient.isArchived != true
        else { throw NativeOrdinaryContractError.stale }

        var body = Data()
        defer { body.resetBytes(in: 0..<body.count); body.removeAll(keepingCapacity: false) }
        if plan.functionId == .documentSynthesis {
            let row = plan.roster[0], fresh = try current()
            let attachment = try await client.fetchAttachment(patientId: preparation.patientId, attachmentId: row.id,
                credentials: fresh.credentials, sessionCookie: fresh.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
            _ = try current()
            guard attachment.id == row.id, attachment.patientId == preparation.patientId else { throw NativeOrdinaryContractError.stale }
            // Reuse the ordinary attachment decoder. No share file, alternate parser or OCR path.
            let clear = try decrypt(attachment.data, maximum: 36 * 1024 * 1024)
            guard let decoded = HomeBaseAttachmentDataURL.decode(clear), !decoded.bytes.isEmpty,
                  decoded.bytes.count <= 25 * 1024 * 1024 else { throw NativeOrdinaryContractError.noSources }
            body = decoded.bytes
        } else {
            // Only ciphertext DTOs are cached for this one projection. Missing rows abort, never shrink the roster.
            var entries: [HomeBaseEntrySummary]?, therapies: [HomeBaseTherapySummary]?, observations: [HomeBaseObservationSummary]?
            var rows: [NativeOrdinaryProjectionRow] = []
            defer { rows.removeAll(keepingCapacity: false) }
            for row in plan.roster {
                _ = try current()
                var fields: [NativeOrdinaryProjectionRow.Field] = []
                let stored: [String: String?]
                switch row.entity {
                case "patient":
                    stored = ["notes": patient.notes, "diagnoses": patient.diagnoses]
                case "entries":
                    if entries == nil {
                        let fresh = try current()
                        entries = try await client.fetchEntries(patientId: preparation.patientId, credentials: fresh.credentials,
                            sessionCookie: fresh.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
                    }
                    _ = try current()
                    let matches = entries!.filter { $0.id == row.id }
                    guard matches.count == 1, let value = matches.first, value.patientId == preparation.patientId,
                          value.deletedAt == nil, value.version > 0 else { throw NativeOrdinaryContractError.stale }
                    stored = ["title": value.title, "content": value.content]
                case "therapies":
                    if therapies == nil {
                        let fresh = try current()
                        therapies = try await client.fetchTherapies(patientId: preparation.patientId, credentials: fresh.credentials,
                            sessionCookie: fresh.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
                    }
                    _ = try current()
                    let matches = therapies!.filter { $0.id == row.id }
                    guard matches.count == 1, let value = matches.first, value.patientId == preparation.patientId,
                          value.deletedAt == nil, value.version > 0 else { throw NativeOrdinaryContractError.stale }
                    stored = ["drugName": value.drugName, "dosage": value.dosage, "activePrinciple": value.activePrinciple, "aic": value.aic, "atc": value.atc]
                case "observations":
                    if observations == nil {
                        let fresh = try current()
                        observations = try await client.fetchObservations(patientId: preparation.patientId, credentials: fresh.credentials,
                            sessionCookie: fresh.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
                    }
                    _ = try current()
                    let matches = observations!.filter { $0.id == row.id }
                    guard matches.count == 1, let value = matches.first, value.patientId == preparation.patientId,
                          value.deletedAt == nil, value.version > 0 else { throw NativeOrdinaryContractError.stale }
                    stored = ["display": value.display, "value": value.value, "unitCode": value.unitCode]
                case "attachments":
                    let fresh = try current()
                    let value = try await client.fetchAttachment(patientId: preparation.patientId, attachmentId: row.id,
                        credentials: fresh.credentials, sessionCookie: fresh.sessionCookie, ambulatoryId: preparation.ambulatoryId, fresh: true)
                    _ = try current()
                    guard value.id == row.id, value.patientId == preparation.patientId else { throw NativeOrdinaryContractError.stale }
                    stored = ["name": value.name, "summarySnapshot": value.summarySnapshot]
                default: throw NativeOrdinaryContractError.invalid
                }
                for field in row.fields {
                    guard let selected = stored[field] else { throw NativeOrdinaryContractError.invalid }
                    let plaintext = try decrypt(selected, structured: row.entity == "patient" && field == "diagnoses")
                    fields.append(.init(name: field, value: plaintext))
                }
                rows.append(.init(entity: row.entity, id: row.id, fields: fields))
            }
            let projection = NativeOrdinaryProjectionBody(functionId: plan.functionId, rows: rows)
            body = try JSONEncoder().encode(projection)
            guard !body.isEmpty, body.count <= 2 * 1024 * 1024 else { throw NativeOrdinaryContractError.invalid }
        }
        let submitting = try current()
        try io.willSubmit() // changes only the local processing watchdog; cannot extend the host grant.
        try Task.checkCancellation()
        // Return even a late response so the model can cancel its exact attempt before discarding it.
        // No response is published here; the model rechecks identity, generation and lock on return.
        return try await client.projectNativeOrdinary(plan, body: body, credentials: submitting.credentials,
            sessionCookie: submitting.sessionCookie, ambulatoryId: preparation.ambulatoryId)
    }
}
#endif
