import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

private struct CardStyleModifier: ViewModifier {
    private let cornerRadius: CGFloat = 14

    func body(content: Content) -> some View {
        if #available(iOS 26.0, macOS 26.0, *) {
            // Vetro Clinico: real Liquid Glass.
            content
                .padding(16)
                .glassEffect(.regular, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        } else {
            // Older OS: opaque card with a subtle border. The translucent material
            // alone washes out on grouped backgrounds, so keep the fill + stroke.
            content
                .padding(16)
                .background(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .fill(PlatformColors.cardBackground)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                        .stroke(Color.primary.opacity(0.06), lineWidth: 1)
                )
        }
    }
}

extension View {
    func cardStyle() -> some View {
        modifier(CardStyleModifier())
    }
}

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

extension AppleDeliveryPhase {
    var tintColor: Color {
        switch self {
        case .shipping:
            return .green
        case .foundation:
            return .teal
        case .next:
            return .orange
        case .blocked:
            return .red
        }
    }
}
