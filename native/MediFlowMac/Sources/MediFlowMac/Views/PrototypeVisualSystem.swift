import SwiftUI

struct PrototypeSceneBackground: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.95, green: 0.97, blue: 0.99),
                    Color(red: 0.90, green: 0.93, blue: 0.96),
                    Color(red: 0.96, green: 0.95, blue: 0.93)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Circle()
                .fill(Color.orange.opacity(0.12))
                .frame(width: 420, height: 420)
                .offset(x: -280, y: -220)
                .blur(radius: 24)

            Circle()
                .fill(Color.teal.opacity(0.12))
                .frame(width: 500, height: 500)
                .offset(x: 340, y: -120)
                .blur(radius: 40)

            Circle()
                .fill(Color.pink.opacity(0.08))
                .frame(width: 440, height: 440)
                .offset(x: 260, y: 260)
                .blur(radius: 48)
        }
        .ignoresSafeArea()
    }
}

struct PrototypePanelSurface: ViewModifier {
    let cornerRadius: CGFloat
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.regularMaterial.opacity(0.88))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(Color.white.opacity(0.26), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.06), radius: 18, y: 8)
    }
}

struct PrototypeHeroSurface: ViewModifier {
    let tint: Color?
    let interactive: Bool
    let cornerRadius: CGFloat
    let padding: CGFloat

    func body(content: Content) -> some View {
        Group {
            if #available(macOS 26, *) {
                content
                    .padding(padding)
                    .overlay(
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                    )
                    .glassEffect(glassStyle, in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            } else {
                content
                    .modifier(PrototypePanelSurface(cornerRadius: cornerRadius, padding: padding))
            }
        }
        .shadow(color: Color.black.opacity(0.08), radius: 24, y: 10)
    }

    @available(macOS 26, *)
    private var glassStyle: Glass {
        Glass.regular
            .tint(tint)
            .interactive(interactive)
    }
}

struct PrototypeGlassGroup<Content: View>: View {
    let spacing: CGFloat
    let content: Content

    init(spacing: CGFloat = 18, @ViewBuilder content: () -> Content) {
        self.spacing = spacing
        self.content = content()
    }

    var body: some View {
        Group {
            if #available(macOS 26, *) {
                GlassEffectContainer(spacing: spacing) {
                    content
                }
            } else {
                content
            }
        }
    }
}

struct PrototypeActionRow<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        PrototypeGlassGroup(spacing: 20) {
            HStack(spacing: 12) {
                content
            }
        }
    }
}

extension View {
    func prototypePanel(cornerRadius: CGFloat = 22, padding: CGFloat = 18) -> some View {
        modifier(PrototypePanelSurface(cornerRadius: cornerRadius, padding: padding))
    }

    func prototypeHero(tint: Color? = nil, interactive: Bool = false, cornerRadius: CGFloat = 26, padding: CGFloat = 20) -> some View {
        modifier(PrototypeHeroSurface(tint: tint, interactive: interactive, cornerRadius: cornerRadius, padding: padding))
    }

    @ViewBuilder
    func prototypePrimaryAction() -> some View {
        if #available(macOS 26, *) {
            self.buttonStyle(.glassProminent)
        } else {
            self.buttonStyle(.borderedProminent)
        }
    }

    @ViewBuilder
    func prototypeSecondaryAction() -> some View {
        if #available(macOS 26, *) {
            self.buttonStyle(.glass)
        } else {
            self.buttonStyle(.bordered)
        }
    }
}
