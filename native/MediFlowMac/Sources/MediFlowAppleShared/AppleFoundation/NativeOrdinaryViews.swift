/* @Codex — original function surfaces, no settings copy or apply action. */
#if os(macOS)
import SwiftUI

struct NativePatientInsightView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeOrdinaryExperience(workspaceModel: workspaceModel, function: .patientInsight) }
}
struct NativeSmartImportView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeOrdinaryExperience(workspaceModel: workspaceModel, function: .smartImport) }
}
struct NativeTreatmentReasoningView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    var body: some View { NativeOrdinaryExperience(workspaceModel: workspaceModel, function: .treatmentReasoning) }
}
struct NativeDocumentSynthesisView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @State private var attachmentId = ""
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker("Documento da sintetizzare", selection: $attachmentId) {
                Text("Scegli un documento").tag("")
                ForEach(workspaceModel.attachments.filter { $0.patientId == workspaceModel.selectedPatientID }, id: \.id) { attachment in
                    Text(attachment.name).tag(attachment.id)
                }
            }.accessibilityIdentifier("clinical-workspace-document-synthesis-document")
            NativeOrdinaryExperience(workspaceModel: workspaceModel, function: .documentSynthesis,
                attachmentId: attachmentId.isEmpty ? nil : attachmentId).id(attachmentId)
            Text("Il documento deve essere estraibile localmente dall’host. File non supportati o cifrati senza una lettura autorizzata non vengono inviati.")
                .font(.caption).foregroundStyle(.secondary)
        }.onChange(of: workspaceModel.selectedPatientID) { _ in attachmentId = "" }
    }
}
private struct NativeOrdinaryExperience: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    let function: NativeOrdinaryFunction
    @StateObject private var model: NativeOrdinaryModel
    @AccessibilityFocusState private var statusFocused: Bool
    init(workspaceModel: PairedPatientsWorkspaceModel, function: NativeOrdinaryFunction, attachmentId: String? = nil) {
        self.workspaceModel = workspaceModel; self.function = function
        _model = StateObject(wrappedValue: NativeOrdinaryModel(function: function, snapshot: {
            try NativeOrdinaryInputs.build(function, workspace: workspaceModel, attachmentId: attachmentId)
        }))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("\(function.title) con OpenAI").font(.headline)
            Text(model.message).font(.callout).accessibilityFocused($statusFocused)
                .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-status")
            if model.isWorking { ProgressView(model.phase == .generating ? "Elaborazione e chiusura…" : "Verifica in corso…") }
            if model.phase == .needsConsent, let disclosure = model.disclosure {
                Text("Autorizzi l’invio a OpenAI dei contenuti preparati e oscurati per questa sola proposta. Si applicano le condizioni del servizio ChatGPT; la proposta non modifica la cartella.")
                Text("Funzione: \(function.title). L’autorizzazione scade con questa operazione; un nuovo contenuto richiede un nuovo consenso.")
                    .font(.caption).foregroundStyle(.secondary)
                DisclosureGroup("Dettagli dell’invio") {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Dimensione: \(disclosure.payloadBytes) byte")
                        Text("Impronta dei contenuti: \(disclosure.sourceSha256)")
                        Text("Impronta dell’invio: \(disclosure.payloadSha256)")
                        Text("Destinazioni: auth.openai.com e chatgpt.com")
                    }.font(.caption).textSelection(.enabled)
                }
                Button("Autorizza questi contenuti") { model.consent() }.disabled(model.isWorking)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-consent")
            }
            if let challenge = model.challenge, let url = challenge.safeURL {
                Text("Codice di accesso: \(challenge.userCode)").textSelection(.enabled)
                Link("Apri la pagina di accesso OpenAI", destination: url)
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-login-link")
            }
            if let catalog = model.catalog {
                Picker("Modello e ragionamento", selection: $model.selectedOptionId) {
                    Text("Scegli dal catalogo dell’operazione").tag("")
                    ForEach(catalog.choices) { choice in Text(choice.label).tag(choice.optionId) }
                }.disabled(model.isWorking).accessibilityIdentifier("clinical-workspace-\(function.rawValue)-model")
            }
            HStack {
                switch model.phase {
                case .idle, .completed:
                    Button(model.phase == .completed ? "Prepara una nuova proposta" : "Prepara proposta") { model.prepare() }
                        .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-prepare")
                case .consented:
                    Button("Accedi a OpenAI per questa proposta") { model.startLogin() }
                case .awaitingLogin:
                    Button("Ho completato l’accesso: verifica") { model.completeLogin() }
                case .connected:
                    Button("Leggi i modelli disponibili") { model.loadModels() }
                case .ready:
                    Button("Genera proposta") { model.generate() }.disabled(model.selectedOptionId.isEmpty)
                        .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-generate")
                    Button("Aggiorna catalogo") { model.loadModels() }
                case .blocked:
                    Button("Verifica la chiusura") { model.verifyClosure() }
                default: EmptyView()
                }
            }.disabled(model.isWorking)
            if ![.idle, .completed, .closing, .blocked].contains(model.phase) {
                Button("Annulla e chiudi") { model.cancel() }
                    .accessibilityIdentifier("clinical-workspace-\(function.rawValue)-cancel")
            }
            if let proposal = model.proposal {
                Divider()
                NativeOrdinaryProposalView(function: function, result: proposal)
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
        .onChange(of: model.phase) { _ in statusFocused = true }
    }
}
private struct NativeOrdinaryProposalView: View {
    let function: NativeOrdinaryFunction
    let result: NativeOrdinaryJSON
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Proposta da rivedere").font(.headline)
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
                let value = result["value"], data = value["data"]
                paragraph(value["summary"]); paragraph(data["recommendation"])
                lines("Elementi a sostegno", data["keyEvidence"])
                lines("Ragionamento", data["reasoning"])
                lines("Limiti", data["caveats"])
                lines("Sicurezza", data["safetyFlags"])
                lines("Azioni da valutare", data["suggestedActions"])
                lines("Limiti dichiarati", data["trace"]["limitations"])
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
        }.textSelection(.enabled)
    }
    @ViewBuilder private func paragraph(_ value: NativeOrdinaryJSON) -> some View {
        if let text = value.string, !text.isEmpty { Text(text) }
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
#endif
