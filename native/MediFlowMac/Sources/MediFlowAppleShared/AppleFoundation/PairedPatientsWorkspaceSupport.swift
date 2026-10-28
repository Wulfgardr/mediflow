import SwiftUI

enum PairedPatientsWorkspaceSupport {
    static let clinicalPreviewCap = HomeBaseClinicalListLimit.boundaryMaximum

    static let birthDateFormatter = ClinicalDatePresentation.birthDate

    static func age(from birthDate: Date?) -> Int? {
        guard let birthDate else { return nil }
        let years = ClinicalDatePresentation.birthDate.calendar.dateComponents([.year], from: birthDate, to: Date()).year
        guard let years, years >= 0, years < 140 else { return nil }
        return years
    }

    static func birthYear(from birthDate: Date?) -> Int? {
        guard let birthDate else { return nil }
        let year = ClinicalDatePresentation.birthDate.calendar.component(.year, from: birthDate)
        return year > 0 ? year : nil
    }

    static func birthYearText(from birthDate: Date?) -> String? {
        birthYear(from: birthDate).map(String.init)
    }

    static func compactTaxCode(_ taxCode: String) -> String {
        let normalized = taxCode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard normalized.count > 6 else { return normalized }
        return "…\(normalized.suffix(6))"
    }

    private static let relativeUpdatedFormatter = ClinicalDatePresentation.relative

    static func relativeUpdated(_ date: Date) -> String {
        relativeUpdatedFormatter.localizedString(for: date, relativeTo: Date())
    }

    static let entryDateFormatter = ClinicalDatePresentation.timestamp

    private static let therapyDayFormatter = ClinicalDatePresentation.numericDay

    static func therapyDateLine(for therapy: HomeBaseTherapySummary) -> String {
        let start = therapyDayFormatter.string(from: therapy.startDate)
        guard let endDate = therapy.endDate else { return "Dal \(start)" }
        return "Dal \(start) al \(therapyDayFormatter.string(from: endDate))"
    }
}

func cleanedPatientWorkspaceValue(_ value: String?) -> String? {
    value.flatMap { $0.trimmedOrNil }
}

struct PairedPatientFlagChip: View {
    let text: String
    let tone: VetroTone
    /// Same reason as `ClinicalCodePill`: on a selected list row the system
    /// repaints `.primary`-derived text, and a tinted chip on a tinted row loses
    /// its contrast. The caller states it because the environment key that would
    /// answer needs macOS 14.
    let isOnProminentBackground: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    init(_ text: String, tone: VetroTone, isOnProminentBackground: Bool = false) {
        self.text = text
        self.tone = tone
        self.isOnProminentBackground = isOnProminentBackground
    }

    var body: some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let toneColor = tone == .info ? palette.inkMuted : LumePalette.tint(for: tone, using: palette)
        HStack(spacing: 4) {
            if tone == .attention { Image(systemName: "exclamationmark.triangle") }
            if tone == .critical { Image(systemName: "xmark") }
            if tone == .positive { Image(systemName: "checkmark") }
            Text(text)
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(isOnProminentBackground ? Color.primary : toneColor)
        .accessibilityElement(children: .combine)
    }

}

/// A clinical code — ICD, LOINC, ATC — set as a token rather than as words.
///
/// Codes were running into their descriptions behind a hyphen: "F03 - Demenza
/// non specificata", the whole string in one register. But the two are read
/// differently. A code is matched at a glance and compared down a column, which
/// wants a monospaced face and a boundary; a description is read as language.
/// Typeset identically, neither job is served, and the row becomes a single
/// grey line the eye slides off.
///
/// Deliberately untinted. A tone would claim the diagnosis is good news or bad,
/// which is not the pill's job: it separates a token from prose, nothing more.
/// The tinted chip is `PairedPatientFlagChip`, and it means something.
struct ClinicalCodePill: View {
    let code: String
    /// True when the pill sits on a tinted, prominent background — a selected
    /// list row. Passed in rather than read from `\.backgroundProminence`, which
    /// would answer this exactly but needs macOS 14 while the package still
    /// targets 13; a caller inside a selectable list knows its own state anyway.
    let isOnProminentBackground: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    init(_ code: String, isOnProminentBackground: Bool = false) {
        self.code = code
        self.isOnProminentBackground = isOnProminentBackground
    }

    var body: some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        Text(code)
            .codice()
            .foregroundStyle(isOnProminentBackground ? Color.primary : palette.inkMuted)
            .fixedSize()
    }
}

struct PairedPatientSectionHeader: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let title: String
    let subtitle: String
    let systemImage: String
    let refreshIdentifier: String
    var itemCount: Int? = nil // nil means unread, never an invented zero.
    /// Wayfinding hue for this section. See `ClinicalSectionAccent` for why it
    /// tints the glyph and nothing else.
    var accent: ClinicalSectionAccent = .anagrafica
    let action: () -> Void

    var body: some View {
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
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                ClinicalSectionTitle(title, systemImage: systemImage, accent: accent)
                if let itemCount {
                    Text("\(itemCount)")
                        .font(.headline)
                        .monospacedDigit()
                        .foregroundStyle(.secondary)
                        .accessibilityLabel("\(title): \(itemCount) nell'elenco caricato")
                        .accessibilityIdentifier("\(refreshIdentifier)-count")
                }
            }
            if !subtitle.isEmpty {
                Text(subtitle)
                    .chartMetadata()
                    .fixedSize(horizontal: false, vertical: true)
            }
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

struct PairedPatientCounterStrip: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    let values: [(String, Int)]
    let identifier: String

    var body: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 20) { counters }
            VStack(alignment: .leading, spacing: 8) { counters }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .bottom) { Rectangle().fill(PlatformColors.separator).frame(height: 1) }
        .accessibilityIdentifier(identifier)
    }

    @ViewBuilder
    private var counters: some View {
        ForEach(values, id: \.0) { label, value in
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(value)").inkRegister(weight: .semibold).monospacedDigit()
                Text(label).chartMetadata()
            }
        }
    }
}

enum PatientLifecycleSheet: String, Identifiable {
    case archive
    case unarchive
    case delete

    var id: String { rawValue }
}

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
