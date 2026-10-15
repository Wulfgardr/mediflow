import SwiftUI

/// Presentation only: form values and write authority stay with the workspace model.
struct ClinicalCreationDisclosure<Content: View>: View {
    let title: String
    let identifier: String
    @ViewBuilder let content: Content

    var body: some View {
        DisclosureGroup {
            content.padding(.vertical, 12)
        } label: {
            Label(title, systemImage: "plus")
                .font(.body.weight(.medium))
                #if os(macOS)
                .frame(minHeight: 32, alignment: .leading)
                #else
                .frame(minHeight: 44, alignment: .leading)
                #endif
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }
}

struct ClinicalFormColumns<Leading: View, Trailing: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ViewBuilder let leading: Leading
    @ViewBuilder let trailing: Trailing

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            stackedColumns
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .top, spacing: 24) {
                    leading.frame(maxWidth: .infinity, alignment: .leading)
                    trailing.frame(maxWidth: .infinity, alignment: .leading)
                }.frame(minWidth: 560)
                stackedColumns
            }
        }
    }

    private var stackedColumns: some View {
        VStack(alignment: .leading, spacing: 20) { leading; trailing }
    }
}

extension View {
    func clinicalRegisterList() -> some View {
        listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(PlatformColors.chartCardSurface)
    }
}
