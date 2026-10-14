import SwiftUI

/// Geometry and text roles shared by every clinical section.
enum ClinicalChartMetrics {
    static let cardRadius = LumeGeometry.planeRadius
    static let cardPadding: CGFloat = 16
    static let innerRadius: CGFloat = 0
    static let rowRadius: CGFloat = 0
    static let fieldRadius = LumeGeometry.controlRadius
    #if os(macOS)
    static let groupSpacing: CGFloat = 16
    static let sectionSpacing: CGFloat = 20
    #else
    static let groupSpacing: CGFloat = 28
    static let sectionSpacing: CGFloat = 28
    #endif
    static let itemSpacing: CGFloat = 8
}

extension View {
    func chartCardTitle() -> some View {
        inkRegister(weight: .semibold).accessibilityAddTraits(.isHeader)
    }

    func chartGroupHeading() -> some View {
        font(.caption.weight(.semibold))
            .textCase(.uppercase).tracking(0.6)
            .foregroundStyle(.secondary).accessibilityAddTraits(.isHeader)
    }

    func chartRowTitle() -> some View { inkRegister(weight: .semibold) }

    func chartProse() -> some View {
        #if os(macOS)
        inkRegister().lineSpacing(3)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 540, alignment: .leading)
        #else
        inkVoice(17, relativeTo: .body).lineSpacing(5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 640, alignment: .leading)
        #endif
    }

    func chartMetadata() -> some View {
        font(.caption).monospacedDigit().foregroundStyle(.secondary)
    }
}

struct ChartGroup<Content: View>: View {
    private let title: String
    private let systemImage: String?
    private let content: Content

    init(_ title: String, systemImage: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
            Group {
                if let systemImage { Label(title, systemImage: systemImage) }
                else { Text(title) }
            }.chartGroupHeading()
            content
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}
