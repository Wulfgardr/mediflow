import Foundation

/* @Codex */
public enum FHIRBundleDTOAdapter {
    public static func input(
        patient: HomeBasePatientDetail,
        entries: [HomeBaseEntrySummary],
        therapies: [HomeBaseTherapySummary],
        checkups: [HomeBaseCheckupSummary],
        observations: [HomeBaseObservationSummary],
        generatedAt: String
    ) -> FHIRBundleInput {
        FHIRBundleInput(
            generatedAt: generatedAt,
            patient: FHIRPatientInput(
                id: patient.id,
                firstName: patient.firstName,
                lastName: patient.lastName,
                taxCode: patient.taxCode,
                birthDate: patient.birthDate.map(isoDate),
                address: patient.address,
                phone: patient.phone,
                caregiver: patient.caregiver,
                exemptions: decodeStringArray(patient.exemptions),
                diagnoses: DiagnosesCodec.decode(patient.diagnoses).map {
                    FHIRDiagnosisInput(
                        code: $0.code,
                        description: $0.description,
                        system: $0.system ?? "ICD-10",
                        date: $0.date ?? isoDate(Date())
                    )
                }
            ),
            entries: entries.filter { $0.deletedAt == nil }.map {
                FHIRClinicalEntryInput(
                    id: $0.id,
                    patientId: patient.id,
                    date: isoDateTime($0.date),
                    type: $0.type,
                    title: $0.title,
                    content: $0.content,
                    metadata: decodeEntryMetadata($0.metadata)
                )
            },
            therapies: therapies.filter { $0.deletedAt == nil }.map {
                FHIRTherapyInput(
                    id: $0.id,
                    patientId: patient.id,
                    drugName: $0.drugName,
                    dosage: $0.dosage,
                    motivation: $0.motivation,
                    status: $0.status,
                    startDate: isoDate($0.startDate),
                    endDate: $0.endDate.map(isoDate)
                )
            },
            checkups: checkups.filter { $0.deletedAt == nil }.map {
                FHIRCheckupInput(
                    id: $0.id,
                    patientId: patient.id,
                    date: isoDateTime($0.date),
                    title: $0.title,
                    status: $0.status
                )
            },
            observations: observations.filter { $0.deletedAt == nil }.map {
                FHIRObservationInput(
                    id: $0.id,
                    patientId: patient.id,
                    codeSystem: $0.codeSystem,
                    code: $0.code,
                    display: $0.display,
                    unitSystem: $0.unitSystem,
                    unitCode: $0.unitCode,
                    value: .string($0.value),
                    notes: $0.notes,
                    observedAt: isoDateTime($0.observedAt)
                )
            }
        )
    }

    public static func encodedBundleData(input: FHIRBundleInput) throws -> Data {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return try encoder.encode(FHIRBundleGenerator.generate(input: input))
    }

    public static func exportFileName(patient: HomeBasePatientDetail) -> String {
        let last = slug(patient.lastName)
        let first = slug(patient.firstName)
        return "patient-\(last)-\(first)-fhir.json"
    }

    private static func decodeStringArray(_ raw: String?) -> [String]? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode([String].self, from: data)
    }

    private static func decodeEntryMetadata(_ raw: String?) -> FHIRClinicalEntryMetadata? {
        guard let raw, let data = raw.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(FHIRClinicalEntryMetadata.self, from: data)
    }

    private static func slug(_ value: String) -> String {
        let folded = value.folding(options: [.diacriticInsensitive, .caseInsensitive], locale: Locale(identifier: "it_IT"))
        let scalars = folded.unicodeScalars.map { scalar -> Character in
            CharacterSet.alphanumerics.contains(scalar) ? Character(String(scalar).lowercased()) : Character("-")
        }
        let raw = String(scalars)
        let collapsed = raw.replacingOccurrences(of: #"-+"#, with: "-", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        return collapsed.isEmpty ? "paziente" : collapsed
    }

    private static func isoDate(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withFullDate]
        return formatter.string(from: date)
    }

    private static func isoDateTime(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }
}
