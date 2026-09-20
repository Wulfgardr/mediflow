#if os(iOS)
import SwiftUI

/* @Codex: Presentation only; selection remains owned by the patient workspace. */
struct MobilePatientSectionNavigation: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Binding var selection: PatientWorkspaceSection
    var showsAllSections = false

    var body: some View {
        Group {
            if showsAllSections {
                ViewThatFits(in: .horizontal) {
                    sectionRow(PatientWorkspaceSection.allCases)
                    VStack(alignment: .leading, spacing: 0) {
                        sectionRow([.overview, .diary, .scales, .therapies])
                        sectionRow([.clinical, .prescriptions, .documents])
                    }
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(PatientWorkspaceSection.allCases) { sectionButton($0) }
                    }
                }
            } else if dynamicTypeSize.isAccessibilitySize {
                sectionMenu(showsCurrentTitle: true)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 4) {
                        sectionButton(.overview)
                        sectionButton(.diary)
                        sectionButton(.documents)
                        sectionMenu(showsCurrentTitle: false)
                    }
                    .fixedSize(horizontal: true, vertical: false)
                    sectionMenu(showsCurrentTitle: true)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sezioni della cartella")
        .accessibilityIdentifier("patient-section-navigation")
    }

    private func sectionRow(_ sections: [PatientWorkspaceSection]) -> some View {
        HStack(spacing: 4) {
            ForEach(sections) { sectionButton($0) }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func sectionButton(_ section: PatientWorkspaceSection) -> some View {
        Button { selection = section } label: {
            Text(shortTitle(section))
                .font(.subheadline.weight(selection == section ? .semibold : .regular))
                .foregroundStyle(selection == section ? .primary : .secondary)
                .padding(.horizontal, 8)
                .frame(minWidth: 44, minHeight: 44)
                .overlay(alignment: .bottom) {
                    Rectangle()
                        .fill(selection == section ? Color.accentColor : .clear)
                        .frame(height: 2)
                }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(section.title)
        .accessibilityAddTraits(selection == section ? .isSelected : [])
        .accessibilityIdentifier("patient-section-\(section.rawValue)")
    }

    private func sectionMenu(showsCurrentTitle: Bool) -> some View {
        Menu {
            Picker("Sezione clinica", selection: $selection) {
                ForEach(PatientWorkspaceSection.allCases) { section in
                    Label(section.title, systemImage: section.symbolName).tag(section)
                }
            }
        } label: {
            HStack(spacing: 8) {
                Text(showsCurrentTitle ? selection.title : menuTitle)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Image(systemName: "chevron.down").font(.caption)
            }
            .padding(.horizontal, 8)
            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .accessibilityLabel("Sezione clinica")
        .accessibilityValue(selection.title)
        .accessibilityHint("Mostra tutte le sette sezioni della cartella.")
        .accessibilityIdentifier("patient-section-picker")
    }

    private var menuTitle: String {
        [.overview, .diary, .documents].contains(selection) ? "Sezioni" : shortTitle(selection)
    }

    private func shortTitle(_ section: PatientWorkspaceSection) -> String {
        switch section {
        case .diary: "Diario"
        case .scales: "Scale"
        case .clinical: "Controlli"
        default: section.title
        }
    }
}
#endif
