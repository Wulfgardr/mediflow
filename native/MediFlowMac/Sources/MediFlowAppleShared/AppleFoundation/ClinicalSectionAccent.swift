import SwiftUI

/// Compatibility names retain callers while section headings use neutral ink.
enum ClinicalSectionAccent: Sendable {
    case anagrafica
    case diario
    case scale
    case terapie
    case controlli
    case prescrizioni
    case documenti

    func tint(for colorScheme: ColorScheme) -> Color {
        LumePalette.palette(for: colorScheme, isGuardia: false).inkMuted
    }
}

/// Section names are register headings, with no decorative status colour.
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
        Text(title).chartGroupHeading()
            .accessibilityLabel(title)
            .accessibilityAddTraits(.isHeader)
    }
}
