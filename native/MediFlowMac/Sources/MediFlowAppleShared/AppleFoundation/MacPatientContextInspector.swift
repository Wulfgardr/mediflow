#if os(macOS)
import AppKit
import SwiftUI

/* @Codex */
enum MacClinicalContentSurfaceStyle {
    static var backgroundColor: NSColor { .controlBackgroundColor }
    static var separatorColor: NSColor { .separatorColor }
}

/* @Codex */
struct MacClinicalContentSurface<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)

        content
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: MacClinicalContentSurfaceStyle.backgroundColor), in: shape)
            .overlay {
                shape.stroke(
                    Color(nsColor: MacClinicalContentSurfaceStyle.separatorColor),
                    lineWidth: 0.5
                )
            }
    }
}

/* @Codex */
struct MacPatientInspectorSnapshot: Equatable {
    let displayName: String
    let taxCode: String
    let birthYear: String
    let recordState: String
    let connectionState: String

    init(patient: HomeBasePatientDetail, connectionState: PairedPatientsConnectionState) {
        displayName = "\(patient.lastName) \(patient.firstName)"
        taxCode = PairedPatientsWorkspaceSupport.compactTaxCode(patient.taxCode)
        if let birthDate = patient.birthDate {
            birthYear = String(Calendar(identifier: .gregorian).component(.year, from: birthDate))
        } else {
            birthYear = "Non disponibile"
        }
        recordState = patient.isArchived == true ? "Archiviata" : "Attiva"
        self.connectionState = connectionState.title
    }

    #if DEBUG
    static let synthetic = MacPatientInspectorSnapshot(
        patient: HomeBasePatientDetail(
            id: "synthetic-patient-001",
            firstName: "Esempio",
            lastName: "Paziente",
            birthDate: Calendar(identifier: .gregorian).date(from: DateComponents(year: 1972, month: 4, day: 12)),
            taxCode: "SYNTHETIC-CF-001",
            address: nil, phone: nil, caregiver: nil, exemptions: nil,
            diagnoses: nil, monitoringProfile: nil, statusReason: nil, notes: nil,
            aiSummary: nil, documentInsights: nil, isAdi: false, isArchived: false,
            version: 1, ambulatoryId: "synthetic-ambulatory",
            createdAt: nil, updatedAt: nil
        ),
        connectionState: .cached
    )
    #endif
}

/* @Codex */
struct MacPatientInspectorContent: View {
    let snapshot: MacPatientInspectorSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Contesto paziente")
                .font(.title3.weight(.semibold))
                .accessibilityHeading(.h1)
                .accessibilityIdentifier("clinical-workspace-patient-inspector")

            MacClinicalContentSurface {
                inspectorRows
            }

            MacClinicalContentSurface {
                VStack(alignment: .leading, spacing: 8) {
                    Label("Autorità invariata", systemImage: "lock.shield")
                        .font(.headline)
                    Text("MediFlow Mini e gli strumenti da riga di comando non ricevono privilegi da questo pannello.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("clinical-workspace-inspector-authority")
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var inspectorRows: some View {
        Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
            row("Paziente", snapshot.displayName, identifier: "clinical-workspace-inspector-patient-name")
            row("Codice", snapshot.taxCode)
            row("Anno", snapshot.birthYear)
            row("Cartella", snapshot.recordState)
            row("Origine", snapshot.connectionState)
        }
    }

    private func row(_ label: String, _ value: String, identifier: String? = nil) -> some View {
        GridRow {
            Text(label).foregroundStyle(.secondary)
            Text(value).fontWeight(.medium).textSelection(.enabled)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label): \(value)")
        .accessibilityIdentifier(identifier ?? "")
    }
}

/* @Codex */
private struct MacPatientInspectorAttachedModifier: ViewModifier {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let section: ClinicalWorkspaceSection
    @Binding var isPresented: Bool

    private var isEnabled: Bool {
        section == .patients && workspaceModel.selectedPatient != nil
    }

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(macOS 27.0, *) {
            decorated(content)
                .sheet(isPresented: $isPresented) {
                    inspectorContent.frame(width: 320, height: 520)
                }
        } else if #available(macOS 14.0, *) {
            decorated(content)
                .inspector(isPresented: $isPresented) {
                    inspectorContent
                        .inspectorColumnWidth(min: 270, ideal: 320, max: 420)
                }
        } else {
            decorated(content)
                .sheet(isPresented: $isPresented) {
                    inspectorContent.frame(width: 320, height: 520)
                }
        }
    }

    private func decorated<Decorated: View>(_ content: Decorated) -> some View {
        content
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button {
                        isPresented.toggle()
                    } label: {
                        Label("Dettagli paziente", systemImage: "sidebar.trailing")
                    }
                    .help("Mostra o nascondi i dettagli del paziente")
                    .disabled(!isEnabled)
                    .accessibilityIdentifier("clinical-workspace-inspector-toggle")
                }
            }
            .focusedSceneValue(\.clinicalWorkspaceInspectorAction, ClinicalWorkspaceInspectorAction(
                isEnabled: isEnabled,
                isPresented: isPresented,
                toggle: { isPresented.toggle() }
            ))
            .onChange(of: section) { nextSection in
                if nextSection != .patients { isPresented = false }
            }
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if let patient = workspaceModel.selectedPatient {
            MacPatientInspectorContent(snapshot: MacPatientInspectorSnapshot(
                patient: patient,
                connectionState: workspaceModel.connectionState
            ))
        } else {
            Text("Seleziona un paziente per mostrare il contesto.")
                .foregroundStyle(.secondary)
                .padding(20)
        }
    }
}

/* @Codex */
struct MacPatientInspectorModifier: ViewModifier {
    let workspaceModel: PairedPatientsWorkspaceModel?
    let section: ClinicalWorkspaceSection
    @Binding var isPresented: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if let workspaceModel {
            content.modifier(MacPatientInspectorAttachedModifier(
                workspaceModel: workspaceModel,
                section: section,
                isPresented: $isPresented
            ))
        } else {
            content
        }
    }
}

#if DEBUG
#Preview("Inspector sintetico") {
    MacPatientInspectorContent(snapshot: .synthetic)
        .frame(width: 320, height: 520)
}
#endif
#endif
