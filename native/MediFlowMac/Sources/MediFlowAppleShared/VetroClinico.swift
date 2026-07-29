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
    /// On macOS this is Lume's own canvas, so the ground and the sections it
    /// carries come from one ramp instead of two.
    ///
    /// It was `windowBackgroundColor`, which measured against a real `NSWindow`
    /// on macOS 27 is the *same* value as `textBackgroundColor` and
    /// `controlBackgroundColor` — 255 in light, 30 at night. The arrangement the
    /// chart is built on, a recessive ground with lighter surfaces on it, had no
    /// recessive ground: every section was painted the exact colour it was meant
    /// to be an island on. `underPageBackgroundColor` fixed that against system
    /// cards, but once the sections became Lume `field` (#f5f5f4) its 246 sat one
    /// point away from them and the two collided again in light.
    ///
    /// Lume canvas is 238,240,242 against field's 245,245,244, and the ramp is
    /// then a single one shared with iPhone, iPad and the web tokens.
    /// `MacSingleGroundTests` pins the separation in both registers.
    ///
    /// Declared as a dynamic `NSColor` rather than a flat hex so it still follows
    /// the appearance. The guardia register is not reachable from here — it is an
    /// environment flag, and this accessor has no environment — which is a real
    /// limit of expressing a register as a static colour, recorded rather than
    /// hidden.
    static var groupedBackground: Color {
        #if os(macOS)
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(isDark ? LumePalette.grafite.canvas : LumePalette.giorno.canvas)
        })
        #else
        // Lume canvas here too, for the same reason and on harder evidence.
        //
        // This was `systemGroupedBackground`, which in dark is **pure black**.
        // Sampled from an iPad Pro 13 in dark: the detail pane came out
        // `rgb(0, 0, 0)` while the ground under the list was `rgb(25, 28, 33)`,
        // two different grounds in one window, and neither is a Lume value —
        // the darkest Lume declares is chrome at `(14, 16, 19)`. Worse, that
        // `(25, 28, 33)` is Lume `field`, the *card* step, so the card and the
        // ground it sits on were the exact same colour and the card had no edge
        // at all.
        return Color(uiColor: UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? LumePalette.grafite.canvas : LumePalette.giorno.canvas)
        })
        #endif
    }

    static var cardBackground: Color {
        #if os(macOS)
        return Color(nsColor: .controlBackgroundColor)
        #else
        return Color(uiColor: .secondarySystemBackground)
        #endif
    }

    /// The surface a section card sits on, one step above the ground.
    ///
    /// Deliberately not `cardBackground`, which resolves to
    /// `secondarySystemBackground` — a light *grey* in light mode. A card that is
    /// grey on a grey ground has no edge, and the two greys are what made the
    /// chart read as cream once a slightly warm Lume surface was mixed in.
    ///
    /// The two platforms reach that step differently, and the difference is
    /// worth stating. On iOS these are the grouped-content pair the system
    /// maintains, so Increase Contrast and the accessibility settings come with
    /// them. On macOS the system pair collapsed to one value, so the step comes
    /// from Lume instead — which costs that automatic adaptation and is the
    /// price of having a second level at all.
    static var chartCardSurface: Color {
        #if os(macOS)
        // Lume `field`, the same step `LumeSurface` fills a section with, so a
        // card drawn through this accessor and one drawn through the modifier
        // are the same surface rather than two near neighbours.
        return Color(nsColor: NSColor(name: nil) { appearance in
            let isDark = appearance.bestMatch(from: [.aqua, .darkAqua]) == .darkAqua
            return NSColor(isDark ? LumePalette.grafite.field : LumePalette.giorno.field)
        })
        #else
        return Color(uiColor: UIColor { traits in
            UIColor(traits.userInterfaceStyle == .dark ? LumePalette.grafite.field : LumePalette.giorno.field)
        })
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
