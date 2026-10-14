import SwiftUI

/// Geometry and text roles shared by every clinical section.
enum ClinicalChartMetrics {
    static let cardRadius = LumeGeometry.planeRadius
    static let cardPadding: CGFloat = 16
    static let innerRadius: CGFloat = 0
    static let rowRadius: CGFloat = 0
    static let fieldRadius = LumeGeometry.controlRadius
    static let groupSpacing: CGFloat = 28
    static let itemSpacing: CGFloat = 8
    static let sectionSpacing: CGFloat = 28
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
        inkVoice(17, relativeTo: .body).lineSpacing(5)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 640, alignment: .leading)
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
