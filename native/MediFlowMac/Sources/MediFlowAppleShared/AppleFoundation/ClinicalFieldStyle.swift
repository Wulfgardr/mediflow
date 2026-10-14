import SwiftUI

/// Consistent controls preserve the native focus ring and touch target.
struct ClinicalTextFieldStyle: TextFieldStyle {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia
    @Environment(\.isEnabled) private var isEnabled

    // swiftlint:disable:next identifier_name
    func _body(configuration: TextField<Self._Label>) -> some View {
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        #if os(macOS)
        configuration.textFieldStyle(.roundedBorder).controlSize(.regular)
        #else
        let shape = RoundedRectangle(cornerRadius: LumeGeometry.controlRadius)
        configuration
            .textFieldStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .frame(minHeight: LumeGeometry.rowHeight)
            .background(palette.field.opacity(isEnabled ? 1 : 0.5), in: shape)
            .overlay(shape.strokeBorder(palette.strongRule, lineWidth: 1))
            .contentShape(Rectangle())
        #endif


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
            .overlay(shape.strokeBorder(palette.strongRule, lineWidth: 1))
    }
}
