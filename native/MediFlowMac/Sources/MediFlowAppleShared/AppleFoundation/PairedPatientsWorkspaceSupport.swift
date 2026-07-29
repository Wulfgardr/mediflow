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
        let toneColor = LumePalette.tint(for: tone, using: palette)
        // A near-opaque chip on a selected row, so the tone colour it carries
        // stays a tone colour instead of washing into the selection tint. The
        // chip's job is to say "ADI" legibly; it cannot do that in pale ink on
        // pale glass over blue.
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(toneColor)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(
                isOnProminentBackground ? Color.white.opacity(0.94) : palette.field,
                in: Capsule()
            )
            .overlay(Capsule().strokeBorder(toneColor.opacity(0.4), lineWidth: 0.5))
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
        let shape = RoundedRectangle(cornerRadius: 5, style: .continuous)
        // Contrast first, and the same identity in both states.
        //
        // On a selected row the system resolves `.primary` to the selected
        // content colour — white — while the pill kept painting its near-white
        // field fill underneath. White on near-white: selecting a patient made
        // their ICD code vanish into an empty rounded box. A translucent scrim
        // was the first fix and it was not good enough either — a pale chip with
        // pale text on a saturated blue is legible in a screenshot and not at a
        // glance across a desk.
        //
        // So the pill stays a light chip with a dark code whether the row is
        // selected or not: it keeps looking like the same object, and dark ink on
        // a near-opaque chip is the highest contrast available in both states.
        // Both colours are stated explicitly, because that is what stops the
        // selection style from repainting the text out from under us.
        let isProminent = isOnProminentBackground
        Text(code)
            .font(.caption2.weight(.semibold))
            .registro()
            .foregroundStyle(palette.inkPrimary)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(shape.fill(isProminent ? Color.white.opacity(0.94) : palette.field))
            .overlay(
                shape.strokeBorder(
                    palette.inkMuted.opacity(isProminent ? 0.15 : 0.25),
                    lineWidth: 0.5
                )
            )
            .fixedSize()
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
    /// Wayfinding hue for this section. See `ClinicalSectionAccent` for why it
    /// tints the glyph and nothing else.
    var accent: ClinicalSectionAccent = .anagrafica
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
            ClinicalSectionTitle(title, systemImage: systemImage, accent: accent)
            Text(subtitle)
                .chartMetadata()
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
