import CoreText
import SwiftUI

/// Local fonts are registered once per process, including previews and SwiftPM tests.
public enum LumeTypography {
    private static let registered: Void = {
        for name in ["Newsreader-Variable", "IBMPlexMono-Regular"] {
            guard let url = Bundle.module.url(forResource: name, withExtension: "ttf") else {
                preconditionFailure("Missing bundled font: \(name)")
            }
            CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
        }
    }()

    public static func voice(_ size: CGFloat, relativeTo style: Font.TextStyle = .title) -> Font {
        _ = registered
        return .custom("Newsreader16pt-Regular", size: size, relativeTo: style)
    }

    public static var code: Font {
        _ = registered
        return .custom("IBMPlexMono-Regular", size: 12, relativeTo: .caption)
    }


}

private struct InkRegister: ViewModifier {
    #if os(macOS)
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 13.5
    #else
    @ScaledMetric(relativeTo: .body) private var size: CGFloat = 15.5
    #endif
    let weight: Font.Weight
    func body(content: Content) -> some View { content.font(.system(size: size, weight: weight)).monospacedDigit() }
}

private struct InkVoice: ViewModifier {
    let size: CGFloat
    let style: Font.TextStyle

    func body(content: Content) -> some View {
        content.font(LumeTypography.voice(size, relativeTo: style))
    }
}

public extension View {
    func inkRegister(weight: Font.Weight = .regular) -> some View { modifier(InkRegister(weight: weight)) }

    func inkVoice(_ size: CGFloat = 26, relativeTo style: Font.TextStyle = .title) -> some View {
        modifier(InkVoice(size: size, style: style))
    }
}

public extension View {
    func inkWorkspaceTitle(_ title: String) -> some View {
        #if os(iOS)
        navigationTitle(title)
        #else
        navigationTitle(title)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    HStack(alignment: .firstTextBaseline, spacing: 3) {
                        Text(title).inkVoice(26)
                        Circle().fill(PlatformColors.ink).frame(width: 6, height: 6)
                            .accessibilityHidden(true)
                    }.accessibilityAddTraits(.isHeader)
                }
            }
        #endif
    }
}
