import SwiftUI
import Combine

struct MobileVisitWorkspaceView: View {
    @ObservedObject var model: MobileVisitModel
    let patientID: String?
    let online: (() throws -> any MobileVisitOnlineReading)?
    let freshLogin: (MobileVisitContext) async throws -> any MobileVisitOnlineReading
    let insertIntoOrdinaryComposer: (MobileVisitContext, String) throws -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmsPreparation = false
    @State private var reviewed = false
    private let expiryTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Visita senza rete").font(.title2.bold())
                Text("Prepara online il paziente scelto. La copia scade entro 24 ore; l’appunto resta sul dispositivo fino alla revisione online.")
                if model.isUnlocked {
                    Button("Blocca dossier", systemImage: "lock") { model.lock() }
                } else {
                    Button("Apri con autenticazione dispositivo", systemImage: "lock.open") {
                        Task { await model.unlock() }
                    }
                    .accessibilityIdentifier("mobile-visit-unlock")
                }
                if patientID != nil, online != nil {
                    Button("Prepara questo paziente per la visita", systemImage: "arrow.down.doc") {
                        confirmsPreparation = true
                    }
                    .accessibilityIdentifier("mobile-visit-prepare")
                }
                if model.isBusy { ProgressView("Verifica in corso") }
                if let error = model.errorMessage { Text(error).foregroundStyle(.red).accessibilityIdentifier("mobile-visit-error") }
                if let status = model.statusMessage { Text(status).font(.callout).accessibilityIdentifier("mobile-visit-status") }
                ForEach(model.dossiers) { dossier in
                    Button { model.open(dossier.id); reviewed = false } label: {
                        VStack(alignment: .leading) {
                            Text(dossier.patientName)
                            Text("Scade \(dossier.expiresAt.formatted(date: .numeric, time: .shortened))").font(.caption)
                        }
                    }
                    .accessibilityIdentifier("mobile-visit-open-\(dossier.id)")
                }
                if let dossier = model.onlineReview ?? model.selected {
                    dossierContent(dossier)
                }
                if model.selected != nil || model.onlineReview != nil {
                    Text("Appunto locale · non registrato in cartella").font(.headline)
                    if model.onlineReview != nil {
                        Text(model.noteText).textSelection(.disabled)
                        Toggle("Ho confrontato le fonti aggiornate e rivisto l’appunto", isOn: $reviewed)
                        Button("Importa nel compositore del diario") {
                            Task {
                                await model.importReviewedNote(confirmed: reviewed, freshLogin: freshLogin,
                                    insertIntoOrdinaryComposer: insertIntoOrdinaryComposer)
                                reviewed = false
                            }
                        }
                        .disabled(!reviewed || model.isBusy)
                        .accessibilityIdentifier("mobile-visit-import")
                    } else {
                        TextEditor(text: Binding(get: { model.noteText }, set: { model.saveNote($0) }))
                            .frame(minHeight: 180)
                            .autocorrectionDisabled()
                            .privacySensitive()
                            .accessibilityIdentifier("mobile-visit-note")
                    }
                }
                ForEach(model.retainedNoteIDs, id: \.self) { id in
                    Button("Rivedi appunto conservato con un nuovo accesso online") {
                        reviewed = false
                        Task { await model.reviewOnline(id: id, freshLogin: freshLogin) }
                    }
                    .accessibilityIdentifier("mobile-visit-review-\(id)")
                }
            }
            .padding()
        }
        .privacySensitive()
        .disabled(model.isBusy)
        .confirmationDialog("Preparare una copia riservata sul dispositivo?", isPresented: $confirmsPreparation,
                            titleVisibility: .visible) {
            Button("Acconsento e preparo il dossier") {
                guard let patientID, let online else { return }
                do {
                    let reader = try online()
                    Task { await model.prepare(patientID: patientID, online: reader, consent: true) }
                } catch { model.lock() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Dossier e appunti sono cifrati e non inclusi nel backup. Rimuovere il codice del dispositivo può rendere irrecuperabili gli appunti non registrati. Lo sblocco locale non è un accesso all’host. Le revoche sull’host saranno verificabili solo al ritorno online.")
        }
        .onReceive(expiryTimer) { _ in model.checkExpiry() }
        .onChange(of: scenePhase) { phase in if phase != .active { model.lock(); reviewed = false } }
        .onChange(of: model.onlineReview?.id) { _ in reviewed = false }
        .onDisappear { model.lock() }
    }

    private func dossierContent(_ dossier: MobileVisitDossier) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(dossier.patientName).font(.headline)
            Text("Acquisito \(dossier.acquiredAt.formatted(date: .numeric, time: .shortened)) · scade \(dossier.expiresAt.formatted(date: .numeric, time: .shortened))")
                .font(.caption)
            Text("Host: \(dossier.context.serverURL) · archivio: \(dossier.context.archiveGeneration) · operatore: \(dossier.context.operatorID) · ambulatorio: \(dossier.context.scopeID)")
                .font(.caption).foregroundStyle(.secondary)
            Text("Copia storica: variazioni dell’host successive all’acquisizione non verificate.").font(.callout)
            ForEach(dossier.sections) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(sectionTitle(section.id)).font(.headline)
                    Text(section.source).font(.caption).foregroundStyle(.secondary)
                    if let limitation = section.limitation { Text(limitation).font(.caption) }
                    if section.rows.isEmpty { Text("Nessuna voce restituita dalla fonte in questa acquisizione limitata.") }
                    ForEach(section.rows) { row in
                        VStack(alignment: .leading) {
                            Text(row.text)
                            Text("Versione \(row.version)").font(.caption).foregroundStyle(.secondary)
                        }
                    }
                }
            }
            Text("Non acquisiti: \(dossier.omissions.joined(separator: "; ")).").font(.callout)
        }
        .accessibilityIdentifier("mobile-visit-dossier")
    }

    private func sectionTitle(_ id: String) -> String {
        switch id {
        case "profile": return "Profilo"
        case "therapies": return "Terapie"
        case "diary": return "Diario"
        default: return "Sezione"
        }
    }
}
