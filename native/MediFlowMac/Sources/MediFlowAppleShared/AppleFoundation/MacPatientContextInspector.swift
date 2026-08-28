#if os(macOS)
import AppKit
import SwiftUI

/* @Codex */
enum MacInspectorPresentationMode: Equatable {
    case nativeInspector
    case sheetFallback

    static func resolve(forMajorVersion majorVersion: Int) -> Self {
        majorVersion == 27 ? .sheetFallback : .nativeInspector
    }

    static var current: Self {
        resolve(forMajorVersion: ProcessInfo.processInfo.operatingSystemVersion.majorVersion)
    }
}

/* @Codex */
enum MacClinicalContentSurfaceStyle {
    static var backgroundColor: NSColor { .controlBackgroundColor }
    static var separatorColor: NSColor { .separatorColor }
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
        birthYear = patient.birthDate.map {
            String(Calendar(identifier: .gregorian).component(.year, from: $0))
        } ?? "Non disponibile"
        recordState = patient.isArchived == true ? "Archiviata" : "Attiva"
        self.connectionState = connectionState.title
    }
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

            Grid(alignment: .leading, horizontalSpacing: 12, verticalSpacing: 10) {
                row("Paziente", snapshot.displayName, identifier: "clinical-workspace-inspector-patient-name")
                row("Codice", snapshot.taxCode)
                row("Anno", snapshot.birthYear)
                row("Cartella", snapshot.recordState)
                row("Origine", snapshot.connectionState)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(nsColor: MacClinicalContentSurfaceStyle.backgroundColor), in: surfaceShape)
            .overlay {
                surfaceShape.stroke(Color(nsColor: MacClinicalContentSurfaceStyle.separatorColor), lineWidth: 0.5)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }

    private var surfaceShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
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
struct MacPatientInspectorPresentationModifier: ViewModifier {
    let workspaceModel: PairedPatientsWorkspaceModel?
    @Binding var isPresented: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if MacInspectorPresentationMode.current == .sheetFallback {
            content.sheet(isPresented: $isPresented) {
                inspectorContent.frame(width: 320, height: 520)
            }
        } else if #available(macOS 14.0, *) {
            content.inspector(isPresented: $isPresented) {
                inspectorContent.inspectorColumnWidth(min: 270, ideal: 320, max: 420)
            }
        } else {
            content.sheet(isPresented: $isPresented) {
                inspectorContent.frame(width: 320, height: 520)
            }
        }
    }

    @ViewBuilder
    private var inspectorContent: some View {
        if let patient = workspaceModel?.selectedPatient {
            MacPatientInspectorContent(snapshot: MacPatientInspectorSnapshot(
                patient: patient,
                connectionState: workspaceModel?.connectionState ?? .notLoaded
            ))
        } else {
            Text("Seleziona un paziente per mostrare il contesto.")
                .foregroundStyle(.secondary)
                .padding(20)
        }
    }
}
#endif
