/* original function surfaces, no settings copy or apply action. */
import SwiftUI
import Combine
#if os(iOS)
import SafariServices
#endif

#if DEBUG
@MainActor
enum NativeFabricPresentationProbe {
    static var documentPicker: ((Binding<String>) -> Void)?
    static var venuePicker: ((Binding<Bool>) -> Void)?
    static var localModel: ((NativeFabricModel) -> Void)?
    static var ordinaryModel: ((NativeOrdinaryModel) -> Void)?
    static var localServices: NativeFabricModel.Services?
    static var ordinaryServices: NativeOrdinaryModel.Services?
}
#endif

struct NativePatientInsightView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeFabricExperience(workspaceModel: workspaceModel, function: .patientInsight) }
}
struct NativeSmartImportView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeFabricExperience(workspaceModel: workspaceModel, function: .smartImport) }
}
struct NativeTreatmentReasoningView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeFabricExperience(workspaceModel: workspaceModel, function: .treatmentReasoning) }
}
struct NativeDocumentSynthesisView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeFabricExperience(workspaceModel: workspaceModel, function: .documentSynthesis) }
}
@MainActor
private final class NativeFabricPresentationOwner: ObservableObject {
    private final class Input {
        var requestedAttachmentId: String?
        var acceptedAttachmentId: String?
    }
    let local: NativeFabricModel
    let ordinary: NativeOrdinaryModel
    @Published private(set) var attachmentId: String?
    private let input: Input
    private var subscriptions = Set<AnyCancellable>()
    var canChangeVenue: Bool {
        local.canPrepare && ordinary.canPrepare && input.requestedAttachmentId == input.acceptedAttachmentId
    }
    init(workspace: PairedPatientsWorkspaceModel, function: NativeOrdinaryFunction) {
        let input = Input()
        self.input = input
        let snapshot = {
            guard input.requestedAttachmentId == input.acceptedAttachmentId else { throw NativeOrdinaryContractError.stale }
            return try NativeOrdinaryInputs.build(function, workspace: workspace, attachmentId: input.acceptedAttachmentId)
        }
        #if DEBUG
        let localServices = NativeFabricPresentationProbe.localServices ?? .live
        let ordinaryServices = NativeFabricPresentationProbe.ordinaryServices ?? .live
        #else
        let localServices = NativeFabricModel.Services.live
        let ordinaryServices = NativeOrdinaryModel.Services.live
        #endif
        local = NativeFabricModel(function: function, snapshot: snapshot, services: localServices)
        ordinary = NativeOrdinaryModel(function: function, snapshot: snapshot, services: ordinaryServices)
        for publisher in [local.objectWillChange, ordinary.objectWillChange] {
            publisher.sink { [weak self] _ in
                Task { @MainActor [weak self] in self?.reconcileSelection() }
            }.store(in: &subscriptions)
        }
    }
    func selectDocument(_ value: String?) {
        let value = value.flatMap { $0.isEmpty ? nil : $0 }
        guard input.requestedAttachmentId != value else { return }
        input.requestedAttachmentId = value
        attachmentId = value
        local.invalidate()
        ordinary.invalidate()
        reconcileSelection()
    }
    private func reconcileSelection() {
        if local.canPrepare && ordinary.canPrepare { input.acceptedAttachmentId = input.requestedAttachmentId }
        objectWillChange.send()
    }
}
private struct NativeFabricExperience: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let function: NativeOrdinaryFunction
    @State private var useChatGPT = false
    @StateObject private var owner: NativeFabricPresentationOwner
    init(workspaceModel: PairedPatientsWorkspaceModel, function: NativeOrdinaryFunction) {
        self.workspaceModel = workspaceModel
        self.function = function
        _owner = StateObject(wrappedValue: NativeFabricPresentationOwner(workspace: workspaceModel, function: function))
    }
    private var venue: Binding<Bool> {
        Binding(get: { useChatGPT }, set: { if owner.canChangeVenue { useChatGPT = $0 } })
    }
    private var document: Binding<String> {
        Binding(get: { owner.attachmentId ?? "" }, set: { owner.selectDocument($0) })
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if function == .documentSynthesis {
                Text("Documento da sintetizzare").chartGroupHeading()
                Picker("Documento da sintetizzare", selection: document) {
                    Text("Scegli un documento").tag("")
                    ForEach(workspaceModel.attachments.filter { $0.patientId == workspaceModel.selectedPatientID }, id: \.id) { attachment in
                        Text(attachment.name).tag(attachment.id)
                    }
                }.labelsHidden().accessibilityIdentifier("clinical-workspace-document-synthesis-document")
            }
            Picker("Esegui la funzione", selection: venue) {
                Text("Locale sull’host").tag(false)
                Text("ChatGPT").tag(true)
            }.disabled(!owner.canChangeVenue)
                .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-venue")
            if useChatGPT {
                NativeOrdinaryExperience(workspaceModel: workspaceModel, function: function, model: owner.ordinary)
            } else {
                NativeFabricLocalExperience(workspaceModel: workspaceModel, function: function, model: owner.local)
            }
            if function == .documentSynthesis {
                Text("Il documento deve essere estraibile localmente dall’host. File non supportati o cifrati senza una lettura autorizzata non vengono inviati.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }.onChange(of: workspaceModel.selectedPatientID) { _ in owner.selectDocument(nil) }
        #if DEBUG
        .onAppear {
            NativeFabricPresentationProbe.venuePicker?(venue)
            if function == .documentSynthesis { NativeFabricPresentationProbe.documentPicker?(document) }
        }
        #endif
    }
}
private struct NativeOrdinaryExperience: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let function: NativeOrdinaryFunction
    @ObservedObject var model: NativeOrdinaryModel
    @Environment(\.scenePhase) private var scenePhase
    @AccessibilityFocusState private var statusFocused: Bool
    #if os(iOS)
    @State private var loginPage: NativeOrdinaryLoginPage?
    #endif
    var body: some View {
        VStack(alignment: .leading, spacing: function == .treatmentReasoning ? 16 : 10) {
            if function == .treatmentReasoning {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Proposte").chartGroupHeading()
                    Text(function.title).inkRegister(weight: .semibold)
                    Text("Con l’abbonamento ChatGPT").chartMetadata()
                }.padding(.bottom, 8)
            } else {
                Text("\(function.title) con OpenAI").font(.headline)
            }
            Text(model.message).font(.callout).fixedSize(horizontal: false, vertical: true).accessibilityFocused($statusFocused)
                .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-status")
            if model.isWorking { ProgressView(model.phase == .generating ? "Elaborazione e chiusura…" : "Verifica in corso…") }
            if model.phase == .needsConsent, let disclosure = model.disclosure {
                Text("Autorizzi l’invio a OpenAI dei contenuti preparati e oscurati per questa sola proposta. Si applicano le condizioni del servizio ChatGPT; la proposta non modifica la cartella.")
                Text("Funzione: \(function.title). L’autorizzazione scade con questa operazione; un nuovo contenuto richiede un nuovo consenso.")
                    .font(.caption).foregroundStyle(.secondary)
                if function == .treatmentReasoning {
                    Text("Destinazioni: auth.openai.com e chatgpt.com").chartMetadata()
                }
                DisclosureGroup("Dettagli dell’invio") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Dimensione: \(disclosure.payloadBytes) byte")
                        Text("Impronta dei contenuti: \(disclosure.sourceSha256)")
                        Text("Impronta dell’invio: \(disclosure.payloadSha256)")
                        if function != .treatmentReasoning { Text("Destinazioni: auth.openai.com e chatgpt.com") }
                    }.font(.caption).textSelection(.enabled)
                }
                primaryAction {
                    Button("Autorizza questi contenuti") { model.consent() }.disabled(model.isWorking)
                        .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-consent")
                }
            }
            if let challenge = model.challenge, let url = challenge.safeURL {
                Text("Codice di accesso: \(challenge.userCode)").textSelection(.enabled)
                #if os(iOS)
                Button("Apri la pagina di accesso OpenAI") { loginPage = NativeOrdinaryLoginPage(url: url) }
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-login-link")
                #else
                Link("Apri la pagina di accesso OpenAI", destination: url)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-login-link")
                #endif
            }
            if let catalog = model.catalog {
                Picker(function == .treatmentReasoning ? "Modello per la proposta" : "Modello e ragionamento", selection: $model.selectedOptionId) {
                    Text("Scegli dal catalogo dell’operazione").tag("")
                    ForEach(catalog.choices) { choice in Text(choice.label).tag(choice.optionId) }
                }.disabled(model.isWorking).accessibilityIdentifier("clinical-workspace-\(function.rawValue)-model")
            }
            if function == .treatmentReasoning {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { phaseActions }
                    VStack(alignment: .leading, spacing: 12) { phaseActions }
                }.padding(.vertical, 8).disabled(model.isWorking)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack { phaseActions }
                    VStack(alignment: .leading, spacing: 12) { phaseActions }
                }.disabled(model.isWorking)
            }
            if ![.idle, .completed, .closing, .blocked].contains(model.phase) {
                Button("Annulla e chiudi") { model.cancel() }
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-cancel")
            }
            if let proposal = model.proposal {
                Divider()
                Group {
                    if function == .treatmentReasoning {
                        TreatmentReasoningProposalView(result: proposal)
                    } else {
                        NativeOrdinaryProposalView(function: function, result: proposal)
                    }
                }
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-proposal")
                Text("Da verificare sulle fonti. Nessuna applicazione automatica né salvataggio clinico da questa vista.")
                    .font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).buttonStyle(.bordered)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-ordinary")
        .onAppear { model.observe(workspaceModel) }
        .onDisappear { model.invalidate() }
        #if DEBUG
        .onAppear { NativeFabricPresentationProbe.ordinaryModel?(model) }
        #endif
        .onChange(of: model.phase) { _ in statusFocused = true }
        .onChange(of: scenePhase) { phase in
            if phase == .background { model.invalidate() }
        }
        #if os(iOS)
        .sheet(item: $loginPage) { page in NativeOrdinaryLoginBrowser(url: page.url) }
        .onChange(of: model.challenge?.userCode) { code in
            if code == nil { loginPage = nil }
        }
        #endif
    }
    @ViewBuilder private func primaryAction<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        if function == .treatmentReasoning { content().buttonStyle(.borderedProminent) }
        else { content() }
    }

    @ViewBuilder private var phaseActions: some View {
        switch model.phase {
        case .idle, .completed:
            primaryAction {
                Button(model.phase == .completed ? "Prepara una nuova proposta" : "Prepara proposta") { model.prepare() }.disabled(!model.canPrepare)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-prepare")
            }
        case .consented:
            primaryAction { Button("Accedi a OpenAI per questa proposta") { model.startLogin() } }
        case .awaitingLogin:
            primaryAction { Button("Ho completato l’accesso: verifica") { model.completeLogin() } }
        case .connected:
            primaryAction { Button("Leggi i modelli disponibili") { model.loadModels() } }
        case .ready:
            primaryAction {
                Button("Genera proposta") { model.generate() }.disabled(model.selectedOptionId.isEmpty)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-generate")
            }
            Button("Aggiorna catalogo") { model.loadModels() }
        case .blocked:
            primaryAction { Button("Verifica la chiusura") { model.verifyClosure() } }
        default: EmptyView()
        }
    }

}
struct NativeOrdinaryProposalView: View {
    let function: NativeOrdinaryFunction
    let result: NativeOrdinaryJSON
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Proposta da rivedere", systemImage: "circle").font(.subheadline.weight(.semibold))
            switch function {
            case .patientInsight:
                let proposal = result["preview"]["proposal"]
                paragraph(proposal["summary"])
                lines("Quadro attuale", proposal["currentState"])
                lines("Elementi di attenzione", proposal["alerts"])
                lines("Passi da valutare", proposal["nextSteps"])
                lines("Informazioni mancanti", proposal["gaps"])
            case .smartImport:
                let proposal = result["preview"]["proposal"]
                paragraph(proposal["summary"])
                candidates("Diagnosi candidate", proposal["diagnoses"], label: "label")
                candidates("Terapie candidate", proposal["therapies"], label: "drugMention")
                candidates("Prestazioni candidate", proposal["servicePrescriptions"], label: "serviceName")
            case .treatmentReasoning:
                TreatmentReasoningProposalView(result: result)
            case .documentSynthesis:
                let publication = result["publication"]
                paragraph(publication["output"]["summary"])
                documentData(publication["output"]["data"])
                Text("Citazioni dal documento").font(.subheadline.bold())
                ForEach(Array(publication["citations"].array.enumerated()), id: \.offset) { _, citation in
                    VStack(alignment: .leading, spacing: 4) {
                        Text(citation["label"].string ?? "Citazione").font(.caption.bold())
                        paragraph(citation["quote"])
                    }
                }
            }
        }.foregroundStyle(PlatformColors.pencil).textSelection(.enabled)
    }
    @ViewBuilder private func paragraph(_ value: NativeOrdinaryJSON) -> some View {
        if let text = value.string, !text.isEmpty { Text(text).chartProse() }
    }
    @ViewBuilder private func lines(_ title: String, _ value: NativeOrdinaryJSON) -> some View {
        if !value.array.isEmpty {
            Text(title).font(.subheadline.bold())
            ForEach(Array(value.array.enumerated()), id: \.offset) { _, item in
                if let text = item.string { Text(text) }
                else {
                    paragraph(item["text"]); paragraph(item["label"]); paragraph(item["reason"])
                    paragraph(item["statement"]); paragraph(item["rationale"])
                    if !item["evidenceRefs"].array.isEmpty {
                        Text("Riferimenti: " + item["evidenceRefs"].array.compactMap(\.string).joined(separator: ", "))
                            .font(.caption).foregroundStyle(.secondary)
                    }
                }
            }
        } else { paragraph(value) }
    }
    @ViewBuilder private func documentData(_ data: NativeOrdinaryJSON) -> some View {
        paragraph(data["qualityReason"])
        lines("Farmaci citati", data["medications"])
        candidates("Diagnosi riportate", data["diagnoses"], label: "description")
        candidates("Problemi da verificare", data["problemStatements"], label: "label")
        candidates("Terapie candidate", data["therapyCandidates"], label: "drugMention")
        candidates("Prestazioni candidate", data["servicePrescriptions"], label: "serviceName")
    }
    @ViewBuilder private func candidates(_ title: String, _ value: NativeOrdinaryJSON, label: String) -> some View {
        if !value.array.isEmpty {
            Text(title).font(.subheadline.bold())
            ForEach(Array(value.array.enumerated()), id: \.offset) { _, item in
                VStack(alignment: .leading, spacing: 4) {
                    paragraph(item[label]); paragraph(item["evidence"])
                    paragraph(item["reviewNote"])
                    paragraph(item["code"]); paragraph(item["explicitCode"])
                    paragraph(item["dosage"]); paragraph(item["motivation"])
                    paragraph(item["clinicalQuestion"])
                }
            }
        }
    }
}

#if os(iOS)
private struct NativeOrdinaryLoginPage: Identifiable {
    let id = UUID()
    let url: URL
}
private struct NativeOrdinaryLoginBrowser: UIViewControllerRepresentable {
    let url: URL
    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }
    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}
#endif
