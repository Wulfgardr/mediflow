import SwiftUI

struct NativeFabricLocalExperience: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let function: NativeOrdinaryFunction
    @ObservedObject var model: NativeFabricModel
    @Environment(\.scenePhase) private var scenePhase
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(function.title).chartGroupHeading()
            Text(model.message).font(.callout).fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric-status")
            if let selection = model.selection {
                Text("\(selection.model) · \(selection.provider) · locale sull’host").font(.caption)
                DisclosureGroup("Provenienza") {
                    Text(selection.source == "saved_preference" ? "Preferenza salvata sull’host" : "Configurazione dell’host")
                    Text("Opzione: \(selection.modelOptionId)")
                    Text("Catalogo: \(selection.catalogRevision)")
                    Text("Nessuna uscita cloud; nessuna alternativa automatica.")
                }.font(.caption).textSelection(.enabled)
            }
            if model.isWorking { ProgressView("Verifica sull’host…") }
            if model.phase == .idle {
                Button("Prepara sul Mac") { model.prepare() }.disabled(!model.canPrepare)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric-prepare")
            }
            if model.phase == .ready {
                Button("Genera sul Mac") { model.generate() }.disabled(model.isWorking)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric-generate")
            }
            if [.preparing, .ready, .generating, .completed].contains(model.phase) {
                Button(model.phase == .completed ? "Chiudi proposta" : "Annulla e chiudi") { model.invalidate() }
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric-cancel")
            }
            if model.phase == .blocked { Button("Verifica la chiusura") { model.verifyClosure() }.disabled(model.isWorking) }
            if let proposal = model.proposal {
                NativeOrdinaryProposalView(function: function, result: proposal)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric-proposal")
                Text("Da verificare sulle fonti. Nessuna applicazione automatica né salvataggio clinico da questa vista.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.buttonStyle(.bordered).frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-fabric")
        .onAppear { model.observe(workspaceModel) }
        .onDisappear { model.invalidate() }
        #if DEBUG
        .onAppear { NativeFabricPresentationProbe.localModel?(model) }
        #endif
        .onChange(of: scenePhase) { if $0 == .background { model.invalidate() } }
    }
}
