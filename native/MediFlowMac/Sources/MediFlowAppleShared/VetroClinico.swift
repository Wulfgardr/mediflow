// Vetro Clinico: the shared Liquid Glass design kit for the universal app.
// Adopts Apple Liquid Glass (WWDC25/26) on iOS 26 / macOS 26 and degrades to a
// system material on the iOS 17 / macOS 14 deployment floor, so one set of
// primitives renders correctly on every supported OS.
import SwiftUI

/// Clinical tone for status surfaces. Maps to a single source-of-truth color.
public enum VetroTone {
    case neutral
    case info
    case positive
    case attention
    case critical
}

/// Centralized Vetro Clinico palette. One place for clinical status colors so
/// badges, cards and indicators stay consistent across platforms.
public enum VetroPalette {
    public static func tint(for tone: VetroTone) -> Color {
        switch tone {
        case .neutral: return .secondary
        case .info: return .blue
        case .positive: return .green
        case .attention: return .orange
        case .critical: return .red
        }
    }
}

/// Applies Liquid Glass over a shape on supported OS, falling back to a system
/// material otherwise. Use via the `.vetroGlass(...)` View modifier below.
struct VetroGlassModifier<S: Shape>: ViewModifier {
    let shape: S
    let tone: VetroTone?
    let interactive: Bool

    func body(content: Content) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            content.glassEffect(resolvedGlass, in: shape)
        } else {
            content.background(.regularMaterial, in: shape)
        }
    }

    @available(iOS 26.0, macOS 26.0, *)
    private var resolvedGlass: Glass {
        var glass = Glass.regular
        if let tone { glass = glass.tint(VetroPalette.tint(for: tone)) }
        if interactive { glass = glass.interactive() }
        return glass
    }
}

public extension View {
    /// Apply Vetro Clinico Liquid Glass over `shape`. `tone` optionally tints the
    /// glass; `interactive` enables the touch-reactive variant for controls.
    func vetroGlass<S: Shape>(
        in shape: S = Capsule(),
        tone: VetroTone? = nil,
        interactive: Bool = false
    ) -> some View {
        modifier(VetroGlassModifier(shape: shape, tone: tone, interactive: interactive))
    }
}

/// A Liquid Glass clinical card container.
public struct GlassCard<Content: View>: View {
    private let cornerRadius: CGFloat
    private let content: Content

    public init(cornerRadius: CGFloat = 20, @ViewBuilder content: () -> Content) {
        self.cornerRadius = cornerRadius
        self.content = content()
    }

    public var body: some View {
        content
            .padding(16)
            .vetroGlass(in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
    }
}

/// A capsule status badge tinted by clinical tone.
public struct StatusBadge: View {
    private let text: String
    private let tone: VetroTone

    public init(_ text: String, tone: VetroTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(VetroPalette.tint(for: tone))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .vetroGlass(in: Capsule(), tone: tone)
    }
}

/// A label / value row for clinical info grids.
public struct InfoRow: View {
    private let label: String
    private let value: String

    public init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer(minLength: 12)
            Text(value)
                .font(.callout)
                .multilineTextAlignment(.trailing)
        }
    }
}
