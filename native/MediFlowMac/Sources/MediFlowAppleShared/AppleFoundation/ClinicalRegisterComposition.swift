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
        .accessibilityIdentifier(identifier)
    }
}

extension View {
    func clinicalRegisterList() -> some View {
        listStyle(.plain)
            .scrollContentBackground(.hidden)
            .background(PlatformColors.chartCardSurface)
    }
}
