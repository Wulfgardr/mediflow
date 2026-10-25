/* selector snapshots only; clinical text never enters the native preparation DTO. */
import Foundation
import CryptoKit
import MediFlowCore

struct NativeOrdinarySnapshot {
    let connection: ClinicalWorkspaceConnection
    let preparation: NativeOrdinaryPreparation
    let fingerprint: String
    var retained: NativeOrdinarySnapshot {
        NativeOrdinarySnapshot(connection: NativeOrdinaryAuthority.transport(connection), preparation: preparation, fingerprint: fingerprint)
    }
    func matches(_ other: NativeOrdinarySnapshot) -> Bool {
        connection.identity == other.connection.identity && preparation.functionId == other.preparation.functionId &&
        preparation.patientId == other.preparation.patientId && preparation.ambulatoryId == other.preparation.ambulatoryId &&
        preparation.patientRevision == other.preparation.patientRevision && fingerprint == other.fingerprint
    }
}
@MainActor
enum NativeOrdinaryInputs {
    static func build(_ function: NativeOrdinaryFunction, workspace: PairedPatientsWorkspaceModel,
                      attachmentId: String? = nil, now: Date = Date()) throws -> NativeOrdinarySnapshot {
        guard let connection = workspace.clinicalWorkspaceConnection, let patient = workspace.selectedPatient,
              workspace.selectedPatientID == patient.id, let ambulatory = connection.ambulatoryId,
              patient.ambulatoryId == ambulatory, patient.version > 0, patient.deletedAt == nil,
              patient.isArchived != true else { throw NativeOrdinaryContractError.stale }
        let input: NativeOrdinaryInput
        switch function {
        case .patientInsight: input = .patientInsight
        case .smartImport: input = .smartImport
        case .treatmentReasoning: input = .treatmentReasoning
        case .documentSynthesis:
            guard workspace.attachmentsPatientId == patient.id, let attachmentId,
                  workspace.attachments.contains(where: { $0.id == attachmentId && $0.patientId == patient.id })
            else { throw NativeOrdinaryContractError.noSources }
            input = .documentSynthesis(attachmentId: attachmentId)
        }
        let preparation = NativeOrdinaryPreparation(functionId: function, patientId: patient.id,
            ambulatoryId: ambulatory, patientRevision: patient.version, input: input)
        try preparation.validate()
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        // UI invalidation hint only. Source revisions/digests belong exclusively to the host.
        let bytes = try encoder.encode(preparation)
        let fingerprint = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        return NativeOrdinarySnapshot(connection: connection, preparation: preparation, fingerprint: fingerprint)
    }
}

enum NativeOrdinaryAuthority {
    static func transport(_ connection: ClinicalWorkspaceConnection) -> ClinicalWorkspaceConnection {
        ClinicalWorkspaceConnection(dataSource: connection.dataSource, credentials: connection.credentials,
            sessionCookie: connection.sessionCookie, ambulatoryId: connection.ambulatoryId, masterKey: nil,
            serverURL: connection.serverURL, tlsPin: connection.tlsPin, sessionGeneration: connection.sessionGeneration)
    }
    static func recoveryConnection(previous: ClinicalWorkspaceConnection, current: ClinicalWorkspaceConnection) throws -> ClinicalWorkspaceConnection {
        guard previous.serverURL == current.serverURL, previous.tlsPin == current.tlsPin,
              previous.credentials.clientId == current.credentials.clientId,
              previous.credentials.clientToken == current.credentials.clientToken,
              reference(previous) != reference(current) else { throw NativeOrdinaryContractError.cleanupUnconfirmed }
        return transport(current)
    }

    static func reference(_ connection: ClinicalWorkspaceConnection) -> String {
        let cookie = connection.sessionCookie.split(separator: ";").map { $0.trimmingCharacters(in: .whitespaces) }
            .first { $0.hasPrefix("mediflow_session=") } ?? ""
        let bearer = String(cookie.dropFirst("mediflow_session=".count))
        return SHA256.hash(data: Data(bearer.utf8)).map { String(format: "%02x", $0) }.joined()
    }
}
