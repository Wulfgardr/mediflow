import SwiftUI

/* @Codex */
enum PairedPatientsWorkspaceSupport {
    static let clinicalPreviewCap = HomeBaseClinicalListLimit.boundaryMaximum

    static let birthDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    static func age(from birthDate: Date?) -> Int? {
        guard let birthDate else { return nil }
        let years = Calendar.current.dateComponents([.year], from: birthDate, to: Date()).year
        guard let years, years >= 0, years < 140 else { return nil }
        return years
    }

    /* @Codex */
    static func birthYear(from birthDate: Date?) -> Int? {
        guard let birthDate else { return nil }
        let year = Calendar.current.component(.year, from: birthDate)
        return year > 0 ? year : nil
    }

    /* @Codex */
    static func birthYearText(from birthDate: Date?) -> String? {
        birthYear(from: birthDate).map(String.init)
    }

    /* @Codex */
    static func compactTaxCode(_ taxCode: String) -> String {
        let normalized = taxCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count > 6 else { return normalized }
        return "…\(normalized.suffix(6))"
    }

    private static let relativeUpdatedFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.unitsStyle = .short
        return formatter
    }()

    static func relativeUpdated(_ date: Date) -> String {
        relativeUpdatedFormatter.localizedString(for: date, relativeTo: Date())
    }

    static let entryDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    private static let therapyDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter
    }()

    static func therapyDateLine(for therapy: HomeBaseTherapySummary) -> String {
        let start = therapyDayFormatter.string(from: therapy.startDate)
        guard let endDate = therapy.endDate else { return "Dal \(start)" }
        return "Dal \(start) al \(therapyDayFormatter.string(from: endDate))"
    }
}

/* @Codex */
func cleanedPatientWorkspaceValue(_ value: String?) -> String? {
    value.flatMap { $0.trimmedOrNil }
}

/* @Codex */
struct PairedPatientFlagChip: View {
    let text: String
    let tone: VetroTone
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    init(_ text: String, tone: VetroTone) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let toneColor = LumePalette.tint(for: tone, using: palette)
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(toneColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(palette.field, in: Capsule())
            .overlay(Capsule().strokeBorder(toneColor.opacity(0.4), lineWidth: 0.5))
    }
}

/* @Codex */
struct PairedPatientSectionHeader: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let title: String
    let subtitle: String
    let systemImage: String
    let refreshIdentifier: String
    let action: () -> Void

    var body: some View {
        /* @Codex */
        Group {
            if dynamicTypeSize >= .accessibility1 {
                VStack(alignment: .leading, spacing: 8) {
                    heading
                    refreshButton
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    heading
                    Spacer(minLength: 8)
                    refreshButton
                }
            }
        }
    }

    private var heading: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: systemImage)
                .font(.subheadline.weight(.semibold))
            Text(subtitle)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var refreshButton: some View {
        Button(action: action) {
            Label("Aggiorna", systemImage: "arrow.clockwise")
        }
        .font(.caption)
        .disabled(model.isWorking || model.selectedPatient == nil)
        .accessibilityIdentifier(refreshIdentifier)
    }
}

/* @Codex */
struct PairedPatientFormButtons: View {
    let primaryLabel: String
    let primaryIdentifier: String
    let canSubmit: Bool
    let onCancel: (() -> Void)?
    let onSubmit: () -> Void

    var body: some View {
        HStack(spacing: 8) {
            if let onCancel {
                Button("Annulla") {
                    onCancel()
                }
                .font(.caption)
            }
            Button {
                onSubmit()
            } label: {
                Label(primaryLabel, systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!canSubmit)
            .accessibilityIdentifier(primaryIdentifier)
        }
    }
}

/* @Codex */
struct PairedPatientCounterStrip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let values: [(String, Int)]
    let identifier: String

    var body: some View {
        Group {
            if dynamicTypeSize >= .accessibility1 {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(values, id: \.0) { label, value in
                        HStack(spacing: 6) {
                            Text("\(value)")
                                .font(.caption.weight(.semibold))
                                .registro()
                            Text(label)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(minWidth: 58, alignment: .leading)
                        .padding(.vertical, 6)
                        .padding(.horizontal, 8)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            } else {
                HStack(spacing: 8) {
                    ForEach(values, id: \.0) { label, value in
                        VStack(spacing: 2) {
                            Text("\(value)")
                                .font(.caption.weight(.semibold))
                                .registro()
                            Text(label)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        .frame(minWidth: 58)
                        .padding(.vertical, 6)
                        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    }
                }
            }
        }
        .accessibilityIdentifier(identifier)
    }
}

/* @Codex */
enum PatientLifecycleSheet: String, Identifiable {
    case archive
    case unarchive
    case delete

    var id: String { rawValue }
}

/* @Codex */
enum FseValidationRecordKind: String, CaseIterable, Identifiable {
    case therapy
    case observation

    var id: String { rawValue }

    var title: String {
        switch self {
        case .therapy: return "Terapia"
        case .observation: return "Osservazione"
        }
    }
}
