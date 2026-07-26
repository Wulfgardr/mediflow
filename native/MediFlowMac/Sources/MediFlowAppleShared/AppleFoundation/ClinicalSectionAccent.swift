import SwiftUI

/// Colour as wayfinding, kept strictly apart from colour as clinical signal.
///
/// The chart is a long scroll of cards that all look alike, so finding "Terapie"
/// means reading every title on the way past. A hue per section turns that into
/// recognition: the eye learns that therapies are violet and checkups are amber
/// and stops reading to navigate.
///
/// The hard constraint is that MediFlow already speaks in colour, and it means
/// something: `LumeTone` carries positive, attention and critical, and those
/// hues state clinical status. A decorative palette that drifted into the same
/// greens and reds would put a status colour next to a value that has no status,
/// which is worse than no colour at all. So these hues are:
///
/// - **attached to structure, never to data** — they tint a section's glyph, and
///   nothing else. Every number, label and clinical statement stays neutral.
/// - **drawn from cool, desaturated families** away from the success/warning/
///   critical seeds, so a section accent cannot be mistaken for a verdict.
/// - **never the only carrier of meaning** — the title is always written out, so
///   the accent adds nothing a colour-blind reader loses.
enum ClinicalSectionAccent: Sendable {
    case anagrafica
    case diario
    case scale
    case terapie
    case controlli
    case prescrizioni
    case documenti

    /// Hue angle and the tint's weight against the register's ink. Expressed as
    /// components rather than literals so both light and dark registers derive
    /// from one definition instead of two hand-picked hex values that drift.
    private var hue: Double {
        switch self {
        case .anagrafica: return 0.58   // slate blue
        case .diario: return 0.52       // teal
        case .scale: return 0.47        // sea green, well clear of the success seed
        case .terapie: return 0.75      // violet
        case .controlli: return 0.09    // amber
        case .prescrizioni: return 0.94 // plum
        case .documenti: return 0.64    // indigo
        }
    }

    func tint(for colorScheme: ColorScheme) -> Color {
        // Muted on purpose. At full saturation these read as status badges; at
        // this weight they read as stationery.
        colorScheme == .dark
            ? Color(hue: hue, saturation: 0.42, brightness: 0.82)
            : Color(hue: hue, saturation: 0.52, brightness: 0.52)
    }
}

/// A card title with its section's glyph.
///
/// The glyph sits in a soft tinted square rather than loose on the surface: an
/// enclosed icon is a landmark, a bare one is punctuation. This is the same
/// device iOS uses in Settings, for the same reason — you find the row you want
/// by its colour and shape before you have read a word.
struct ClinicalSectionTitle: View {
    private let title: String
    private let systemImage: String
    private let accent: ClinicalSectionAccent
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

    init(_ title: String, systemImage: String, accent: ClinicalSectionAccent) {
        self.title = title
        self.systemImage = systemImage
        self.accent = accent
    }

    var body: some View {
        let tint = accent.tint(for: colorScheme)
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(reduceTransparency ? Color.white : tint)
                .frame(width: 26, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(reduceTransparency ? tint : tint.opacity(0.14))
                )
            Text(title)
                .chartCardTitle()
        }
        // One element to VoiceOver: the glyph carries no information the title
        // does not already state.
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title)
        .accessibilityAddTraits(.isHeader)
    }
}
