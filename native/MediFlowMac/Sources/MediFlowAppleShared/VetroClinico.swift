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
    static var groupedBackground: Color {
        #if os(macOS)
        return Color(nsColor: .windowBackgroundColor)
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

    public init(_ text: String, tone: VetroTone = .neutral) {
        self.text = text
        self.tone = tone
    }

    public var body: some View {
        // Status color lives on the text, over a neutral glass capsule, so it
        // stays legible (no same-color text-on-tint) and survives the fallback.
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(VetroPalette.tint(for: tone))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .vetroGlass(in: Capsule())
    }
}

/// A label / value row for clinical info grids.
public struct InfoRow: View {
    private let label: String
    private let value: String
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    public init(_ label: String, _ value: String) {
        self.label = label
        self.value = value
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
            .fixedSize(horizontal: false, vertical: true)
    }
}
