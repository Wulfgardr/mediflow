import SwiftUI

/// The shape of an input in the clinical chart.
///
/// Cards round at 22, pills round fully, and the text fields were drawing the
/// system's near-rectangle: three geometries in one column, and the one carrying
/// the sharpest corner was the one the reader touches most. An input is the same
/// kind of object as a pill — a self-contained token you act on — so it takes the
/// pill's curvature.
///
/// A `TextFieldStyle` rather than a modifier at each call site: it travels
/// through the environment, so a section applies it once and every field inside
/// it, however deeply nested, is shaped the same. There are several dozen fields
/// across the chart and none of them should be able to disagree.
struct ClinicalTextFieldStyle: TextFieldStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.isEnabled) private var isEnabled

    // swiftlint:disable:next identifier_name
    func _body(configuration: TextField<Self._Label>) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        configuration
            .textFieldStyle(.plain)
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .background(palette.field.opacity(isEnabled ? 1 : 0.5), in: Capsule())
            .overlay(
                Capsule().strokeBorder(palette.inkMuted.opacity(0.22), lineWidth: 0.5)
            )
            // A tap anywhere on the pill puts the caret in the field, not only on
            // the glyphs. The plain style's hit area is the text itself.
            .contentShape(Capsule())
    }
}

extension View {
    /// Applies the clinical input shape to every field in this subtree.
    func clinicalFieldShape() -> some View {
        textFieldStyle(ClinicalTextFieldStyle())
    }

    /// The multi-line counterpart, for a `TextEditor` or any wrapping input.
    ///
    /// A capsule bows outward around several lines of text, so this uses the
    /// continuous radius that reads as the same family without the distortion.
    func clinicalMultilineFieldShape() -> some View {
        modifier(ClinicalMultilineFieldShape())
    }
}

private struct ClinicalMultilineFieldShape: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    func body(content: Content) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let shape = RoundedRectangle(
            cornerRadius: ClinicalChartMetrics.fieldRadius,
            style: .continuous
        )
        content
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(palette.field, in: shape)
            .overlay(shape.strokeBorder(palette.inkMuted.opacity(0.22), lineWidth: 0.5))
    }
}
