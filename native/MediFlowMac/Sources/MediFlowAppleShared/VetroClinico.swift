// Compatibility surface while consumers migrate from Vetro Clinico to Lume.
import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public typealias VetroTone = LumeTone
public typealias VetroPalette = LumePalette

enum PlatformColors {
    /// The recessive ground that grouped content sits on.
    ///
    /// On macOS this was `windowBackgroundColor`, which is the wrong half of the
    /// pair. Measured on macOS 27, `windowBackgroundColor`, `textBackgroundColor`
    /// and `controlBackgroundColor` all resolve to the *same* value — pure white
    /// in light, `(30, 30, 30)` at night — so the arrangement the chart is built
    /// on, grey underneath and lighter surfaces on top, had no grey underneath.
    /// Every clinical section was painted the exact colour of the ground it was
    /// meant to be an island on, and the split view read as one undivided sheet.
    ///
    /// `underPageBackgroundColor` is the colour that still recedes:
    /// `(246, 246, 246)` in light and `(40, 40, 40)` at night, against the card's
    /// 255 and 30. It is also the honest counterpart of iOS's
    /// `systemGroupedBackground`, which is what this token means on the other
    /// platform. Verified against a real `NSWindow` under both appearances, not
    /// deduced: `MacSingleGroundTests` pins it.
    static var groupedBackground: Color {
        #if os(macOS)
        return Color(nsColor: .underPageBackgroundColor)
        #else
        return Color(uiColor: .systemGroupedBackground)
        #endif
    }

    static var cardBackground: Color {
        #if os(macOS)
        return Color(nsColor: .controlBackgroundColor)
        #else
        return Color(uiColor: .secondarySystemBackground)
        #endif
    }

    /// The surface a section card sits on: white in light mode, the system's
    /// raised dark grey at night, on both platforms.
    ///
    /// Deliberately not `cardBackground`, which resolves to
    /// `secondarySystemBackground` — a light *grey* in light mode. A card that is
    /// grey on a grey ground has no edge, and the two greys are what made the
    /// chart read as cream once a slightly warm Lume surface was mixed in. These
    /// two are the grouped-content pair the system maintains for exactly this
    /// arrangement, so contrast and accessibility settings come with them.
    static var chartCardSurface: Color {
        #if os(macOS)
        return Color(nsColor: .textBackgroundColor)
        #else
        return Color(uiColor: .secondarySystemGroupedBackground)
        #endif
    }

    static var separator: Color {
        #if os(macOS)
        return Color(nsColor: .separatorColor)
        #else
        return Color(uiColor: .separator)
        #endif
    }
}

public extension View {
    /// Compatibility alias for chrome, controls and transient overlays.
    func vetroGlass<S: Shape>(in shape: S = Capsule()) -> some View {
        lumeGlass(in: shape)
    }
}

/// Legacy card name retained while call sites migrate to Lume terminology.
/// The rendered surface is opaque on every supported OS.
@available(*, deprecated, message: "Use clinicalCardStyle(cornerRadius:) for clinical content.")
public struct GlassCard<Content: View>: View {
    private let cornerRadius: CGFloat
    private let content: Content

    public init(cornerRadius: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    public var body: some View {
        content
            .clinicalCardStyle(cornerRadius: cornerRadius)
    }
}

/// A capsule status badge tinted by clinical tone.
public struct StatusBadge: View {
    private let text: String
    private let tone: VetroTone
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.lumeGuardia) private var isGuardia

    public init(_ text: String, tone: VetroTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        /* @Codex */
        let palette = LumePalette.palette(for: colorScheme, isGuardia: isGuardia)
        let toneColor = LumePalette.tint(for: tone, using: palette)
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(toneColor)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(palette.field, in: Capsule())
            .overlay(Capsule().strokeBorder(toneColor.opacity(0.4), lineWidth: 0.5))
            .accessibilityLabel(text)
    }
}

/// A label / value row for clinical info grids.
public struct InfoRow: View {
    private let label: String
    private let value: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    #if !os(macOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    public init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }

    /// Whether the row has enough width to place the value in a column next to
    /// its label instead of at the far edge.
    ///
    /// This used to be `#if os(macOS)`, which was the wrong question. The
    /// problem is not the platform, it is the distance: pushed apart by a
    /// Spacer, "Indirizzo" and its address sit at opposite ends of the row with
    /// nothing between them, and the reader has to traverse empty space to
    /// connect the two. On a phone that gap is small enough not to matter; on an
    /// iPad chart column it is several hundred points, exactly as it was on the
    /// Mac. So the question is the width.
    private var usesLabelColumn: Bool {
        #if os(macOS)
        true
        #else
        horizontalSizeClass == .regular
        #endif
    }

    public var body: some View {
        /* @Codex */
        Group {
            if dynamicTypeSize >= .accessibility1 {
                VStack(alignment: .leading, spacing: 2) {
                    labelText
                    valueText
                        .multilineTextAlignment(.leading)
                }
            } else if usesLabelColumn {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    labelText
                        .frame(width: 132, alignment: .leading)
                    valueText
                        .multilineTextAlignment(.leading)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else {
                HStack(alignment: .firstTextBaseline) {
                    labelText
                    Spacer(minLength: 12)
                    valueText
                        .multilineTextAlignment(.trailing)
                }
            }
        }
    }

    private var labelText: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(.secondary)
    }

    private var valueText: some View {
        Text(value)
            .font(.callout)
            .modifier(InfoRowValueTypeface(value: value))
            .fixedSize(horizontal: false, vertical: true)
    }
}

/// Monospace carries meaning here — codes, identifiers, doses — so it is applied
/// to those and not to prose. Every value in the same face made "Figlia,
/// convivente" look like a record locator.
private struct InfoRowValueTypeface: ViewModifier {
    let value: String

    func body(content: Content) -> some View {
        isCodeLike ? AnyView(content.registro()) : AnyView(content)
    }

    /// Code-like when the value carries no lowercase letters (`DEMODEL0002X`,
    /// `AMB-DEMO`, `048 · C01`) or is essentially numeric.
    private var isCodeLike: Bool {
        let letters = value.filter(\.isLetter)
        if letters.isEmpty { return true }
        return !letters.contains(where: \.isLowercase)
    }
}
