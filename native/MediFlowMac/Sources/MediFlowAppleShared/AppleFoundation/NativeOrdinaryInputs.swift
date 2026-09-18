/* @Codex — snapshots of existing readable workspace data; no DB or clinical writes. */
#if os(macOS)
import Foundation
import CryptoKit
import MediFlowCore

struct NativeOrdinarySnapshot {
    let connection: ClinicalWorkspaceConnection
    let preparation: NativeOrdinaryPreparation
    let fingerprint: String
    func matches(_ other: NativeOrdinarySnapshot) -> Bool {
        connection.identity == other.connection.identity && preparation.functionId == other.preparation.functionId &&
        preparation.patientId == other.preparation.patientId && preparation.ambulatoryId == other.preparation.ambulatoryId &&
        preparation.patientRevision == other.preparation.patientRevision && fingerprint == other.fingerprint
    }
}
@MainActor
enum NativeOrdinaryInputs {
    typealias J = NativeOrdinaryJSON
    static func text(_ value: String?, maximum: Int) -> String? {
        guard let value, !value.hasPrefix("ENC:") else { return nil }
        let normalized = value.precomposedStringWithCanonicalMapping.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }.joined(separator: " ")
        guard !normalized.isEmpty, !normalized.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }) else { return nil }
        // UTF-16 limits match the canonical TypeScript parsers; do not split graphemes.
        var result = ""
        for character in normalized { if result.utf16.count + String(character).utf16.count > maximum { break }; result.append(character) }
        return result.isEmpty ? nil : result
    }
    static func iso(_ date: Date) -> String {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .gregorian); formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'"; return formatter.string(from: date)
    }
    static func nullable(_ text: String?) -> J { text.map(J.string) ?? .null }
    static func sourceID(_ id: String) -> String { "source_" + SHA256.hash(data: Data(id.utf8)).map { String(format: "%02x", $0) }.joined().prefix(32) }
    static func build(_ function: NativeOrdinaryFunction, workspace: PairedPatientsWorkspaceModel,
                      attachmentId: String? = nil, now: Date = Date()) throws -> NativeOrdinarySnapshot {
        guard let connection = workspace.clinicalWorkspaceConnection, let patient = workspace.selectedPatient,
              workspace.selectedPatientID == patient.id, let ambulatory = connection.ambulatoryId,
              patient.ambulatoryId == ambulatory, patient.version > 0, patient.deletedAt == nil,
              patient.isArchived != true else { throw NativeOrdinaryContractError.stale }
        let diagnoses = workspace.currentPatientDiagnoses
        let therapies = workspace.therapies.filter { $0.patientId == patient.id && $0.deletedAt == nil && $0.status == "active" }
        let entries = workspace.entries.filter { $0.patientId == patient.id && $0.deletedAt == nil && $0.lockedFields.isEmpty }
            .sorted { $0.date > $1.date }
        let observations = workspace.observations.filter { $0.patientId == patient.id && $0.deletedAt == nil }.sorted { $0.observedAt > $1.observedAt }
        let attachments = workspace.attachments.filter { $0.patientId == patient.id }
        let input: J
        switch function {
        case .patientInsight:
            let conditions = diagnoses.compactMap { text($0.displayText, maximum: 240).map { J.object(["label": .string($0)]) } }
            let active = therapies.compactMap { text("\($0.drugName) \($0.dosage)", maximum: 240).map { J.object(["label": .string($0)]) } }
            let events = entries.compactMap { text("\($0.title): \($0.content)", maximum: 240).map { J.object(["summary": .string($0)]) } }
            let focus = text(patient.notes, maximum: 240)
            guard focus != nil || !conditions.isEmpty || !active.isEmpty || !events.isEmpty else { throw NativeOrdinaryContractError.noSources }
            input = .object(["schemaVersion": .string("mediflow.patient-insight.preview-request.v1"),
                "requestId": .string("native_" + UUID().uuidString), "patientId": .string(patient.id), "ambulatoryId": .string(ambulatory),
                "patientRevision": .number(Double(patient.version)), "capturedAt": .string(iso(now)),
                "sources": .object(["focus": .object(["summary": .string(focus ?? "Riepiloga i contenuti clinici presenti.")]),
                    "conditions": .array(Array(conditions.prefix(12))), "activeTherapies": .array(Array(active.prefix(12))),
                    "recentEvents": .array(Array(events.prefix(12)))])])
        case .smartImport:
            var sources: [J] = []
            func add(_ id: String, _ kind: String, _ label: String, _ content: String?, _ date: Date?) {
                guard sources.count < 32, let content = text(content, maximum: 900) else { return }
                sources.append(.object(["id": .string(sourceID(id)), "kind": .string(kind), "label": .string(text(label, maximum: 160) ?? "Contenuto clinico"),
                    "date": nullable(date.map(iso)), "content": .string(content)]))
            }
            add("notes_" + patient.id, "patient-notes", "Note della cartella", patient.notes, patient.updatedAt)
            for entry in entries { add(entry.id, "clinical-entry", entry.title, entry.content, entry.date) }
            for attachment in attachments { add(attachment.id, "attachment-summary", attachment.name, attachment.summarySnapshot, attachment.createdAt) }
            guard !sources.isEmpty else { throw NativeOrdinaryContractError.noSources }
            // An absent coding system is not promoted to an invented ICD classification.
            let currentDiagnoses = diagnoses.compactMap { d -> J? in
                guard let system = text(d.system, maximum: 64), let code = text(d.code, maximum: 64),
                      let description = text(d.description, maximum: 320) else { return nil }
                return .object(["system": .string(system), "code": .string(code), "description": .string(description)])
            }
            let currentTherapies = therapies.compactMap { t -> J? in
                guard let name = text(t.drugName, maximum: 160) else { return nil }
                return .object(["drugName": .string(name), "activePrinciple": nullable(text(t.activePrinciple, maximum: 160)),
                    "dosage": nullable(text(t.dosage, maximum: 160)), "aic": nullable(text(t.aic, maximum: 32)), "atc": nullable(text(t.atc, maximum: 32))])
            }
            input = .object(["schemaVersion": .string("mediflow.smart-import.projection-attachment.v1"), "capability": .string(function.rawValue),
                "patientRevision": .number(Double(patient.version)), "sourceRevision": .number(Double(patient.version)), "capturedAt": .string(iso(now)),
                "currentDiagnoses": .array(Array(currentDiagnoses.prefix(64))), "currentActiveTherapies": .array(Array(currentTherapies.prefix(64))),
                "therapyCandidateHints": .array([]), "sources": .array(sources)])
        case .treatmentReasoning:
            var sources: [J] = [], therapyRefs: [J] = []
            func add(_ id: String, _ kind: String, _ label: String, _ content: String?, _ date: Date?) {
                guard let label = text(label, maximum: 180), sources.count < 16 else { return }
                let reference = sourceID(id)
                sources.append(.object(["id": .string(reference), "sourceKind": .string(kind), "label": .string(label),
                    "excerpt": nullable(text(content, maximum: 480)), "date": nullable(date.map(iso))]))
                if kind == "therapy" { therapyRefs.append(.string(reference)) }
            }
            if let notes = text(patient.notes, maximum: 480) { add("patient_" + patient.id, "patient-profile", "Note cliniche", notes, patient.updatedAt) }
            for (index, diagnosis) in diagnoses.prefix(3).enumerated() { add("diagnosis_\(patient.id)_\(index)", "diagnosis", diagnosis.displayText, nil, nil) }
            for therapy in therapies.prefix(4) { add(therapy.id, "therapy", therapy.drugName, therapy.dosage, therapy.updatedAt ?? therapy.startDate) }
            for observation in observations.prefix(3) { add(observation.id, "observation", observation.display, "\(observation.value) \(observation.unitCode)", observation.observedAt) }
            for entry in entries.prefix(2) { add(entry.id, "clinical-entry", entry.title, entry.content, entry.date) }
            if let attachment = attachments.first(where: { text($0.summarySnapshot, maximum: 480) != nil }) {
                add(attachment.id, "attachment-evidence", attachment.name, attachment.summarySnapshot, attachment.createdAt)
            }
            guard !sources.isEmpty else { throw NativeOrdinaryContractError.noSources }
            input = .object(["schemaVersion": .string("mediflow.ai.treatment-reasoning-projection-attachment.v1"), "capability": .string(function.rawValue),
                "patientRevision": .number(Double(patient.version)), "sourceRevision": .string("source_\(patient.version)_\(sources.count)"),
                "capturedAt": .string(iso(now)), "therapyRefs": .array(therapyRefs), "evidenceRefs": .array(sources.map { $0["id"] }), "sources": .array(sources)])
        case .documentSynthesis:
            guard workspace.attachmentsPatientId == patient.id, let attachmentId,
                  attachments.contains(where: { $0.id == attachmentId }) else { throw NativeOrdinaryContractError.noSources }
            input = .object(["attachmentId": .string(attachmentId)])
        }
        var stable = input
        if case .object(var fields) = input { fields.removeValue(forKey: "capturedAt"); fields.removeValue(forKey: "requestId"); stable = .object(fields) }
        let encoder = JSONEncoder(); encoder.outputFormatting = [.sortedKeys]
        let bytes = try encoder.encode(stable)
        let fingerprint = SHA256.hash(data: bytes).map { String(format: "%02x", $0) }.joined()
        return NativeOrdinarySnapshot(connection: connection, preparation: NativeOrdinaryPreparation(functionId: function, patientId: patient.id,
            ambulatoryId: ambulatory, patientRevision: patient.version, input: input), fingerprint: fingerprint)
    }
}
#endif
