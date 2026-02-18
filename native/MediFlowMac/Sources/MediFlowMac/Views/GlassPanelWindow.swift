// @Codex
import SwiftUI

/* @Codex */
struct GlassPanelWindow<Content: View>: View {
    let title: String
    let subtitle: String?
    let minSize: CGSize
    let expandedSize: CGSize
    let content: Content

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isCollapsed = false
    @State private var isExpanded = false
    @State private var hoveredControl: TrafficLightControl?

    init(
        title: String,
        subtitle: String? = nil,
        minSize: CGSize = CGSize(width: 740, height: 620),
        expandedSize: CGSize = CGSize(width: 980, height: 760),
        @ViewBuilder content: () -> Content
    ) {
        self.title = title
        self.subtitle = subtitle
        self.minSize = minSize
        self.expandedSize = expandedSize
        self.content = content()
    }

    private var currentSize: CGSize {
        isExpanded ? expandedSize : minSize
    }

    private var collapseAnimation: Animation {
        if reduceMotion { return .easeInOut(duration: 0.16) }
        return .spring(response: 0.36, dampingFraction: 0.9)
    }

    private var expandAnimation: Animation {
        if reduceMotion { return .easeInOut(duration: 0.16) }
        return .spring(response: 0.44, dampingFraction: 0.84)
    }

    var body: some View {
        VStack(spacing: 0) {
            header

            if !isCollapsed {
                Divider()
                    .overlay(Color.white.opacity(0.28))

                ScrollView {
                    content
                        .padding(18)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .transition(
                    .asymmetric(
                        insertion: .move(edge: .top).combined(with: .opacity),
                        removal: .scale(scale: 0.97).combined(with: .opacity)
                    )
                )
            }
        }
        .frame(
            minWidth: currentSize.width,
            idealWidth: currentSize.width,
            maxWidth: currentSize.width,
            minHeight: isCollapsed ? 84 : currentSize.height,
            idealHeight: isCollapsed ? 84 : currentSize.height,
            maxHeight: .infinity,
            alignment: .top
        )
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.regularMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.white.opacity(0.26), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.12), radius: 18, x: 0, y: 10)
        .padding(18)
        .animation(collapseAnimation, value: isCollapsed)
        .animation(expandAnimation, value: isExpanded)
    }

    private var header: some View {
        HStack(spacing: 10) {
            trafficLight(control: .close, color: .red, symbol: "xmark") {
                dismiss()
            }
            trafficLight(control: .collapse, color: .yellow, symbol: isCollapsed ? "chevron.down" : "chevron.up") {
                withAnimation(collapseAnimation) {
                    isCollapsed.toggle()
                }
            }
            trafficLight(control: .expand, color: .green, symbol: isExpanded ? "arrow.down.right.and.arrow.up.left" : "arrow.up.left.and.arrow.down.right") {
                withAnimation(expandAnimation) {
                    isExpanded.toggle()
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.headline)
                if let subtitle, !subtitle.isEmpty {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.regularMaterial)
        )
    }

    private func trafficLight(control: TrafficLightControl, color: Color, symbol: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Circle()
                .fill(color)
                .frame(width: 13, height: 13)
                .scaleEffect(hoveredControl == control ? 1.09 : 1)
                .overlay(
                    Image(systemName: symbol)
                        .font(.system(size: 7, weight: .semibold))
                        .foregroundStyle(Color.black.opacity(0.56))
                        .opacity(hoveredControl == control ? 0.86 : 0.56)
                )
        }
        .buttonStyle(.plain)
        .onHover { hovering in
            hoveredControl = hovering ? control : nil
        }
        .animation(reduceMotion ? .linear(duration: 0.01) : .spring(response: 0.22, dampingFraction: 0.75), value: hoveredControl)
    }
}

/* @Codex */
private enum TrafficLightControl {
    case close
    case collapse
    case expand
}
