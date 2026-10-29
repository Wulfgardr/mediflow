import SwiftUI
import Combine

struct MobileVisitWorkspaceView: View {
    @ObservedObject var workspace: PairedPatientsWorkspaceModel
    @ObservedObject var coordinator: MobileVisitProductCoordinator
    @ObservedObject var model: MobileVisitModel
    var onOpenComposer: () -> Void
    @Environment(\.scenePhase) private var scenePhase
    @State private var confirmsPreparation = false
    @State private var reviewed = false
    private let expiryTimer = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    init(workspace: PairedPatientsWorkspaceModel, coordinator: MobileVisitProductCoordinator, onOpenComposer: @escaping () -> Void) {
        self.workspace = workspace
        self.coordinator = coordinator
        self.model = coordinator.vault
        self.onOpenComposer = onOpenComposer
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                Text("Prepara una visita e conserva gli appunti sul dispositivo. La cartella originale resta sul computer che conserva l’archivio.")
                if coordinator.needsAuthentication {
                    authentication
                } else {
                    if model.isUnlocked {
                        Button("Blocca dossier e appunti", systemImage: "lock") { coordinator.lock() }
                    } else {
                        Button("Apri con autenticazione dispositivo", systemImage: "lock.open") {
                            Task { await model.unlock() }
                        }
                        .accessibilityIdentifier("mobile-visit-unlock")
                    }
                    preparation
                    ForEach(model.retainedNotes) { note in
                        Button { model.open(note.id); reviewed = false } label: {
                            VStack(alignment: .leading) {
                                Text(note.label)
                                Text("Appunto versione \(note.revision) · \(ClinicalDatePresentation.timestamp.string(from: note.updatedAt))")
                                    .font(.caption)
                            }
                        }
                        .accessibilityIdentifier("mobile-visit-open-note")
                    }
                    if let dossier = model.onlineReview ?? model.selected { dossierContent(dossier) }
                    if let note = model.selectedNote {
                        Text(note.label).font(.headline)
                        Text("Appunto dell’operatore · \(note.context.serverURL) · ambulatorio \(note.context.scopeID)")
                            .font(.caption)
                        if note.dossierExpired {
                            Text("Dossier scaduto: i suoi dati non sono disponibili. Puoi continuare a leggere e modificare il tuo appunto, che non è una voce della cartella.")
                                .accessibilityIdentifier("mobile-visit-dossier-expired")
                        }
                    }
                    if model.selectedNote != nil || model.onlineReview != nil {
                        Text("Appunto locale · non inviato automaticamente").font(.headline)
                        if model.onlineReview != nil {
                            Text(model.noteText)
                            Toggle("Ho confrontato le fonti aggiornate e rivisto l’appunto", isOn: $reviewed)
                            Button("Prepara una nuova voce del diario") {
                                Task {
                                    await coordinator.importNote(confirmed: reviewed)
                                    if workspace.mobileVisitDraft != nil { onOpenComposer() }
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
                    ForEach(model.retainedNotes.filter { model.retainedNoteIDs.contains($0.id) }) { note in
                        VStack(alignment: .leading, spacing: 10) {
                            Text(note.label).font(.headline)
                            ForEach(note.registrations, id: \.entryID) { registration in
                                Text(receiptLine(registration))
                                    .accessibilityIdentifier("mobile-visit-receipt")
                            }
                            Button("Rivedi online \(note.label)") { coordinator.requestOnlineReview(note.id) }
                                .accessibilityIdentifier("mobile-visit-review")
                            if note.registrations.contains(where: { $0.payload != nil && $0.phase != .registered }) {
                                Button("Verifica l’esito dell’invio") { Task { await coordinator.reconcile(note.id) } }
                                    .accessibilityIdentifier("mobile-visit-reconcile")
                            }
                        }
                    }
                }
                if model.isBusy || coordinator.isWorking { ProgressView("Verifica in corso") }
                if let error = model.errorMessage { Text(error).foregroundStyle(.red).accessibilityIdentifier("mobile-visit-error") }
                if let status = model.statusMessage { Text(status).font(.callout).accessibilityIdentifier("mobile-visit-status") }
                if let message = coordinator.message { Text(message).font(.callout) }
                if let error = workspace.errorMessage, coordinator.needsAuthentication { Text(error).foregroundStyle(.red) }
            }
            .padding()
        }
        .privacySensitive()
        .disabled(model.isBusy || coordinator.isWorking)
        .confirmationDialog("Preparare una copia riservata sul dispositivo?", isPresented: $confirmsPreparation,
                            titleVisibility: .visible) {
            Button("Acconsento e preparo il dossier") { Task { await coordinator.prepare() } }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Dossier e appunti sono cifrati e non inclusi nel backup. Rimuovere il codice del dispositivo può rendere irrecuperabili gli appunti non registrati. Il dossier scade entro 24 ore; gli appunti restano fino a una tua decisione esplicita. Lo sblocco del dispositivo non accede al computer dell’archivio. Le variazioni dei permessi sono verificabili solo online.")
        }
        .onDisappear { coordinator.dismiss() }
        .onReceive(expiryTimer) { _ in model.checkExpiry() }
        .onChange(of: model.onlineReview?.id) { _ in reviewed = false }
        .overlay {
            if scenePhase != .active {
                Rectangle().fill(.background).overlay { Label("Dati protetti", systemImage: "lock") }
            }
        }
    }

    private var authentication: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Nuovo accesso online").font(.headline)
            Text("Dopo l’accesso verrà richiesto un nuovo sblocco locale. Nessun appunto viene inviato.")
            TextField("Utente", text: $workspace.username).accessibilityIdentifier("mobile-visit-username")
            SecureField("Passphrase o PIN precedente", text: $workspace.password)
                .accessibilityIdentifier("mobile-visit-password")
            Button("Accedi e continua la revisione") { Task { await coordinator.authenticateAndReview() } }
                .accessibilityIdentifier("mobile-visit-authenticate")
            Button("Annulla", role: .cancel) { coordinator.lock() }
        }
        .textFieldStyle(.roundedBorder)
    }

    @ViewBuilder private var preparation: some View {
        if workspace.connectionState == .pairedOnline {
            Menu("Scegli il paziente per la visita") {
                ForEach(workspace.patients.filter { $0.deletedAt == nil }) { patient in
                    Button("\(patient.lastName) \(patient.firstName)") { Task { await coordinator.selectPatient(patient) } }
                }
            }
            .accessibilityIdentifier("mobile-visit-choose-patient")
            if let patient = workspace.selectedPatient {
                Text("Paziente scelto: \(patient.lastName) \(patient.firstName)")
                Button("Prepara questo paziente per la visita", systemImage: "arrow.down.doc") { confirmsPreparation = true }
                    .disabled(workspace.isWorking)
                    .hidden()
                    .accessibilityIdentifier("mobile-visit-prepare")
            }
        }
    }

    private func receiptLine(_ registration: MobileVisitRegistration) -> String {
        switch registration.phase {
        case .draft: return "Appunto versione \(registration.noteRevision): preparato per il diario, registrazione non confermata."
        case .uncertain: return "Appunto versione \(registration.noteRevision): esito incerto. Verifica online prima di qualsiasi nuovo invio."
        case .registered: return "Appunto versione \(registration.noteRevision): registrato in cartella e confermato con rilettura online (versione della voce \(registration.acknowledgedVersion.map(String.init) ?? "?"))."
        }
    }

    private func dossierContent(_ dossier: MobileVisitDossier) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(dossier.patientName).font(.headline)
            Text("Acquisito \(ClinicalDatePresentation.timestamp.string(from: dossier.acquiredAt)) · scade \(ClinicalDatePresentation.timestamp.string(from: dossier.expiresAt))").font(.caption)
            Text("Copia storica: variazioni dell’archivio successive all’acquisizione non verificate.")
            ForEach(dossier.sections) { section in
                VStack(alignment: .leading, spacing: 8) {
                    Text(section.id == "profile" ? "Profilo" : section.id == "therapies" ? "Terapie" : "Diario").font(.headline)
                    DisclosureGroup("Dettagli della fonte") { Text(section.source).font(.caption).foregroundStyle(.secondary) }
                    if let limitation = section.limitation { Text(limitation).font(.caption) }
                    if section.rows.isEmpty { Text("Nessuna voce restituita dalla fonte in questa acquisizione limitata.") }
                    ForEach(section.rows) { row in
                        Text(row.text)
                        Text("Versione \(row.version)").font(.caption)
                    }
                }
            }
            Text("Non acquisiti: \(dossier.omissions.joined(separator: "; ")).").font(.callout)
        }
        .accessibilityIdentifier("mobile-visit-dossier")
    }
}
