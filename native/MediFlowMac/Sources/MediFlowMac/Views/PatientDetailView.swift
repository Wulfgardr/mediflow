// Codex: created 2026-02-01
import SwiftUI

/* @Codex */
private func normalizedTherapyStatus(_ status: String) -> String {
    switch status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "active":
        return "active"
    case "suspended", "paused":
        return "suspended"
    case "completed", "stopped", "interrupted":
        return "completed"
    default:
        return "active"
    }
}

/* @Codex */
private func normalizedCheckupStatus(_ status: String) -> String {
    switch status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
    case "pending":
        return "pending"
    case "completed", "done":
        return "completed"
    case "cancelled", "canceled":
        return "cancelled"
    default:
        return "pending"
    }
}

/* @Codex */
private func therapyStatusLabel(for status: String) -> String {
    switch normalizedTherapyStatus(status) {
    case "active":
        return "Attiva"
    case "suspended":
        return "Sospesa"
    case "completed":
        return "Completata"
    default:
        return status.capitalized
    }
}

/* @Codex */
private func checkupStatusLabel(for status: String) -> String {
    switch normalizedCheckupStatus(status) {
    case "pending":
        return "In attesa"
    case "completed":
        return "Completato"
    case "cancelled":
        return "Annullato"
    default:
        return status.capitalized
    }
}

/* @Codex */
struct PatientDetailView: View {
    let patientId: String

    @EnvironmentObject private var security: SecuritySession
    @State private var detail: PatientDetail?
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var entries: [EntrySummary] = []
    @State private var therapies: [TherapySummary] = []
    @State private var checkups: [CheckupSummary] = []
    @State private var observations: [ObservationSummary] = []
    @State private var entriesErrorMessage: String?
    @State private var therapiesErrorMessage: String?
    @State private var checkupsErrorMessage: String?
    @State private var observationsErrorMessage: String?
    @State private var showingNewEntry = false
    @State private var showingNewTherapy = false
    @State private var showingNewCheckup = false
    @State private var showingNewObservation = false
    @State private var showingAIStudio = false
    @State private var aiPrompt = ""
    @State private var aiResponse = ""
    @State private var aiErrorMessage: String?
    @State private var isAILoading = false
    @State private var revealIslands = false
    /* @Codex */
    @State private var entryTypeFilter = "all"
    /* @Codex */
    @State private var therapyStatusFilter = "all"
    /* @Codex */
    @State private var checkupStatusFilter = "all"
    /* @Codex */
    @State private var editingEntry: EntrySummary?
    /* @Codex */
    @State private var editingTherapy: TherapySummary?
    /* @Codex */
    @State private var editingCheckup: CheckupSummary?
    /* @Codex */
    @State private var editingObservation: ObservationSummary?
    /* @Codex */
    @State private var pendingDeleteEntry: EntrySummary?
    /* @Codex */
    @State private var pendingDeleteTherapy: TherapySummary?
    /* @Codex */
    @State private var pendingDeleteCheckup: CheckupSummary?
    /* @Codex */
    @State private var pendingDeleteObservation: ObservationSummary?

    var body: some View {
        Group {
            if isLoading {
                ProgressView("Caricamento...")
            } else if let detail {
                ZStack {
                    PatientDetailBackdrop()

                    ScrollView {
                        VStack(alignment: .leading, spacing: 16) {
                            PatientHeroIsland(detail: detail, ageText: ageText(from: detail.birthDate))
                                .modifier(IslandMotion(index: 0, isRevealed: revealIslands))

                            ConceptIsland(title: "Anagrafica", subtitle: "Identita e stato cartella", icon: "person.text.rectangle", accent: .blue) {
                                InfoGrid(rows: [
                                    InfoRow(label: "Nome", value: "\(detail.firstName) \(detail.lastName)"),
                                    InfoRow(label: "Codice fiscale", value: detail.taxCode),
                                    InfoRow(label: "Data di nascita", value: formatted(date: detail.birthDate)),
                                    InfoRow(label: "Eta", value: ageText(from: detail.birthDate)),
                                    InfoRow(label: "ADI", value: detail.isAdi == true ? "Si" : "No"),
                                    InfoRow(label: "Archiviato", value: detail.isArchived == true ? "Si" : "No")
                                ])
                            }
                            .modifier(IslandMotion(index: 1, isRevealed: revealIslands))

                            ConceptIsland(title: "Contatti", subtitle: "Riferimenti utili", icon: "phone.arrow.up.right", accent: .teal) {
                                InfoGrid(rows: [
                                    InfoRow(label: "Telefono", value: displayValue(detail.phone)),
                                    InfoRow(label: "Indirizzo", value: displayValue(detail.address)),
                                    InfoRow(label: "Caregiver", value: displayValue(detail.caregiver))
                                ])
                            }
                            .modifier(IslandMotion(index: 2, isRevealed: revealIslands))

                            /* @Codex */
                            ConceptIsland(title: "Esenzioni", subtitle: "Codici associati alla scheda", icon: "ticket", accent: .purple) {
                                exemptionCodesBlock(raw: detail.exemptions)
                            }
                            .modifier(IslandMotion(index: 3, isRevealed: revealIslands))

                            ConceptIsland(title: "Note", subtitle: "Sintesi clinica rapida", icon: "note.text", accent: .mint) {
                                Text(displayNotes(detail.notes))
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .modifier(IslandMotion(index: 4, isRevealed: revealIslands))

                            ConceptIsland(title: "Diario clinico", subtitle: "Ultime voci registrate", icon: "stethoscope", accent: .indigo) {
                                entriesBlock
                            }
                            .modifier(IslandMotion(index: 5, isRevealed: revealIslands))

                            ConceptIsland(title: "Terapie", subtitle: "Farmaci e posologia", icon: "pills", accent: .green) {
                                therapiesBlock
                            }
                            .modifier(IslandMotion(index: 6, isRevealed: revealIslands))

                            ConceptIsland(title: "Appuntamenti", subtitle: "Agenda e follow-up", icon: "calendar.badge.clock", accent: .orange) {
                                checkupsBlock
                            }
                            .modifier(IslandMotion(index: 7, isRevealed: revealIslands))

                            /* @Codex */
                            ConceptIsland(title: "Osservazioni", subtitle: "Rilevazioni codificate LOINC + UCUM", icon: "waveform.path.ecg", accent: .pink) {
                                observationsBlock
                            }
                            .modifier(IslandMotion(index: 8, isRevealed: revealIslands))

                            ConceptIsland(title: "AI Assist", subtitle: "Prompt contestuale e analisi", icon: "sparkles", accent: .purple) {
                                aiInlineBlock
                            }
                            .modifier(IslandMotion(index: 9, isRevealed: revealIslands))

                            ConceptIsland(title: "Metadati", subtitle: "Tracciabilita record", icon: "tray.full", accent: .gray) {
                                InfoGrid(rows: [
                                    InfoRow(label: "ID", value: detail.id),
                                    InfoRow(label: "Creato il", value: formatted(date: detail.createdAt)),
                                    InfoRow(label: "Aggiornato il", value: formatted(date: detail.updatedAt))
                                ])
                            }
                            .modifier(IslandMotion(index: 10, isRevealed: revealIslands))
                        }
                        .padding(24)
                    }
                }
            } else if let errorMessage {
                VStack(spacing: 8) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Errore")
                        .font(.headline)
                    Text(errorMessage)
                        .foregroundStyle(.secondary)
                }
            } else {
                VStack(spacing: 8) {
                    Image(systemName: "person")
                        .font(.largeTitle)
                        .foregroundStyle(.secondary)
                    Text("Nessun dato")
                        .foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(detail?.lastName ?? "Dettaglio")
        .toolbar {
            Button("Nuova voce") {
                showingNewEntry = true
            }
            .accessibilityIdentifier("patient-detail-new-entry-button")
            Button("Nuova terapia") {
                showingNewTherapy = true
            }
            .accessibilityIdentifier("patient-detail-new-therapy-button")
            Button("Nuovo appuntamento") {
                showingNewCheckup = true
            }
            .accessibilityIdentifier("patient-detail-new-checkup-button")
            /* @Codex */
            Button("Nuova osservazione") {
                showingNewObservation = true
            }
            .accessibilityIdentifier("patient-detail-new-observation-button")
            Button("AI Studio") {
                showingAIStudio = true
            }
            .accessibilityIdentifier("patient-detail-ai-studio-button")
        }
        .sheet(isPresented: $showingNewEntry) {
            GlassPanelWindow(
                title: "Nuova voce clinica",
                subtitle: "Visita, nota, esame o telemedicina",
                minSize: CGSize(width: 640, height: 700),
                expandedSize: CGSize(width: 860, height: 860)
            ) {
                NewEntryView(patientId: patientId) {
                    Task { await loadClinicalSections() }
                }
                .environmentObject(security)
            }
        }
        .sheet(isPresented: $showingNewTherapy) {
            GlassPanelWindow(
                title: "Nuova terapia",
                subtitle: "Farmaco, dosaggio e timeline",
                minSize: CGSize(width: 620, height: 640),
                expandedSize: CGSize(width: 840, height: 820)
            ) {
                NewTherapyView(patientId: patientId) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        .sheet(isPresented: $showingNewCheckup) {
            GlassPanelWindow(
                title: "Nuovo appuntamento",
                subtitle: "Programmazione follow-up",
                minSize: CGSize(width: 620, height: 520),
                expandedSize: CGSize(width: 760, height: 700)
            ) {
                NewCheckupView(patientId: patientId) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        /* @Codex */
        .sheet(isPresented: $showingNewObservation) {
            GlassPanelWindow(
                title: "Nuova osservazione",
                subtitle: "Rilevazione strutturata LOINC + UCUM",
                minSize: CGSize(width: 620, height: 620),
                expandedSize: CGSize(width: 860, height: 820)
            ) {
                NewObservationView(patientId: patientId) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        .sheet(isPresented: $showingAIStudio) {
            GlassPanelWindow(
                title: "AI Clinical Studio",
                subtitle: "Analisi contestuale cartella",
                minSize: CGSize(width: 860, height: 680),
                expandedSize: CGSize(width: 1120, height: 860)
            ) {
                aiStudioBlock
            }
        }
        /* @Codex */
        .sheet(item: $editingEntry) { entry in
            GlassPanelWindow(
                title: "Modifica voce clinica",
                subtitle: "Aggiorna contenuti e classificazione",
                minSize: CGSize(width: 620, height: 620),
                expandedSize: CGSize(width: 860, height: 820)
            ) {
                EditEntryView(
                    patientId: patientId,
                    entry: entry,
                    initialContent: decryptOrPlain(entry.content) ?? ""
                ) {
                    Task { await loadClinicalSections() }
                }
                .environmentObject(security)
            }
        }
        /* @Codex */
        .sheet(item: $editingTherapy) { therapy in
            GlassPanelWindow(
                title: "Modifica terapia",
                subtitle: "Aggiorna farmaco, stato e timeline",
                minSize: CGSize(width: 620, height: 620),
                expandedSize: CGSize(width: 860, height: 820)
            ) {
                EditTherapyView(
                    patientId: patientId,
                    therapy: therapy
                ) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        /* @Codex */
        .sheet(item: $editingCheckup) { checkup in
            GlassPanelWindow(
                title: "Modifica appuntamento",
                subtitle: "Aggiorna data, stato e titolo",
                minSize: CGSize(width: 600, height: 520),
                expandedSize: CGSize(width: 820, height: 700)
            ) {
                EditCheckupView(
                    patientId: patientId,
                    checkup: checkup
                ) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        /* @Codex */
        .sheet(item: $editingObservation) { observation in
            GlassPanelWindow(
                title: "Modifica osservazione",
                subtitle: "Aggiorna coding, valore e contesto clinico",
                minSize: CGSize(width: 620, height: 620),
                expandedSize: CGSize(width: 860, height: 820)
            ) {
                EditObservationView(
                    patientId: patientId,
                    observation: observation
                ) {
                    Task { await loadClinicalSections() }
                }
            }
        }
        /* @Codex */
        .alert(
            "Eliminare questa voce clinica?",
            isPresented: Binding(
                get: { pendingDeleteEntry != nil },
                set: { if !$0 { pendingDeleteEntry = nil } }
            )
        ) {
            Button("Elimina", role: .destructive) {
                guard let entry = pendingDeleteEntry else { return }
                Task { await deleteEntry(entry) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("L'operazione è irreversibile.")
        }
        /* @Codex */
        .alert(
            "Eliminare questa terapia?",
            isPresented: Binding(
                get: { pendingDeleteTherapy != nil },
                set: { if !$0 { pendingDeleteTherapy = nil } }
            )
        ) {
            Button("Elimina", role: .destructive) {
                guard let therapy = pendingDeleteTherapy else { return }
                Task { await deleteTherapy(therapy) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("L'operazione è irreversibile.")
        }
        /* @Codex */
        .alert(
            "Eliminare questo appuntamento?",
            isPresented: Binding(
                get: { pendingDeleteCheckup != nil },
                set: { if !$0 { pendingDeleteCheckup = nil } }
            )
        ) {
            Button("Elimina", role: .destructive) {
                guard let checkup = pendingDeleteCheckup else { return }
                Task { await deleteCheckup(checkup) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("L'operazione è irreversibile.")
        }
        /* @Codex */
        .alert(
            "Eliminare questa osservazione?",
            isPresented: Binding(
                get: { pendingDeleteObservation != nil },
                set: { if !$0 { pendingDeleteObservation = nil } }
            )
        ) {
            Button("Elimina", role: .destructive) {
                guard let observation = pendingDeleteObservation else { return }
                Task { await deleteObservation(observation) }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("L'operazione è irreversibile.")
        }
        .task(id: patientId) {
            revealIslands = false
            await load()
            revealIslands = true
        }
        /* @Codex */
        .onChange(of: entryTypeFilter) { _ in
            Task { await loadClinicalSections() }
        }
        /* @Codex */
        .onChange(of: therapyStatusFilter) { _ in
            Task { await loadClinicalSections() }
        }
        /* @Codex */
        .onChange(of: checkupStatusFilter) { _ in
            Task { await loadClinicalSections() }
        }
    }

    private var entriesBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            /* @Codex */
            HStack(spacing: 10) {
                Text("Filtro")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Tipo voce", selection: $entryTypeFilter) {
                    ForEach(entryTypeFilterOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("patient-detail-entry-filter")
                Spacer()
            }
            if let entriesErrorMessage {
                Text(entriesErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            } else if entries.isEmpty {
                Text("Nessuna voce registrata.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(entries) { entry in
                    EntryRowView(
                        entry: entry,
                        content: displayValue(entry.content),
                        onEdit: { editingEntry = entry },
                        onDelete: { pendingDeleteEntry = entry }
                    )
                    if entry.id != entries.last?.id {
                        Divider()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var therapiesBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            /* @Codex */
            HStack(spacing: 10) {
                Text("Filtro")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Stato terapia", selection: $therapyStatusFilter) {
                    ForEach(therapyStatusFilterOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("patient-detail-therapy-filter")
                Spacer()
            }
            if let therapiesErrorMessage {
                Text(therapiesErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            } else if therapies.isEmpty {
                Text("Nessuna terapia attiva.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(therapies) { therapy in
                    TherapyRowView(
                        therapy: therapy,
                        onEdit: { editingTherapy = therapy },
                        onDelete: { pendingDeleteTherapy = therapy }
                    )
                    if therapy.id != therapies.last?.id {
                        Divider()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var checkupsBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            /* @Codex */
            HStack(spacing: 10) {
                Text("Filtro")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                Picker("Stato appuntamento", selection: $checkupStatusFilter) {
                    ForEach(checkupStatusFilterOptions, id: \.value) { option in
                        Text(option.label).tag(option.value)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("patient-detail-checkup-filter")
                Spacer()
            }
            if let checkupsErrorMessage {
                Text(checkupsErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            } else if checkups.isEmpty {
                Text("Nessun appuntamento.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(checkups) { checkup in
                    CheckupRowView(
                        checkup: checkup,
                        onEdit: { editingCheckup = checkup },
                        onDelete: { pendingDeleteCheckup = checkup }
                    )
                    if checkup.id != checkups.last?.id {
                        Divider()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private var observationsBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let observationsErrorMessage {
                Text(observationsErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            } else if observations.isEmpty {
                Text("Nessuna osservazione codificata.")
                    .foregroundStyle(.secondary)
            } else {
                ForEach(observations) { observation in
                    ObservationRowView(
                        observation: observation,
                        onEdit: { editingObservation = observation },
                        onDelete: { pendingDeleteObservation = observation }
                    )
                    if observation.id != observations.last?.id {
                        Divider()
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var aiInlineBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Contesto pronto")
                    .font(.subheadline.weight(.semibold))
                Text(promptPreview())
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(5)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.5))
                    )
            }

            HStack(spacing: 10) {
                Button("Apri AI Studio") {
                    showingAIStudio = true
                }
                .buttonStyle(.borderedProminent)

                Button("Aggiorna contesto") {
                    updateAIPromptIfNeeded(force: true)
                }
                .buttonStyle(.bordered)

                if isAILoading {
                    ProgressView()
                        .controlSize(.small)
                }

                Spacer()
            }

            if let aiErrorMessage {
                Text(aiErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            if aiResponse.isEmpty {
                Text("Nessuna risposta AI salvata.")
                    .foregroundStyle(.secondary)
                    .font(.caption)
            } else {
                Text(aiResponse)
                    .font(.callout)
                    .lineLimit(6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(10)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.42))
                    )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var aiStudioBlock: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Prompt Clinico")
                    .font(.headline)
                Spacer()
                Button("Rigenera contesto") {
                    updateAIPromptIfNeeded(force: true)
                }
                .buttonStyle(.bordered)
            }

            TextEditor(text: $aiPrompt)
                .font(.body)
                .frame(minHeight: 190)
                .padding(8)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.5))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.4), lineWidth: 1)
                )

            HStack {
                Button(isAILoading ? "Elaborazione..." : "Genera risposta") {
                    Task { await runAI() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isAILoading || aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Spacer()

                if isAILoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            if let aiErrorMessage {
                Text(aiErrorMessage)
                    .foregroundStyle(.red)
                    .font(.caption)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Risposta")
                    .font(.headline)
                ScrollView {
                    Text(aiResponse.isEmpty ? "Nessuna risposta" : aiResponse)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(10)
                }
                .frame(minHeight: 220)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(Color.white.opacity(0.42))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color.white.opacity(0.32), lineWidth: 1)
                )
            }
        }
    }

    private func promptPreview() -> String {
        let cleaned = aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
        if cleaned.isEmpty {
            return "Contesto non ancora inizializzato."
        }
        if cleaned.count <= 360 {
            return cleaned
        }
        let limitIndex = cleaned.index(cleaned.startIndex, offsetBy: 360)
        return String(cleaned[..<limitIndex]) + "..."
    }

    private func load() async {
        if isLoading { return }
        isLoading = true
        defer { isLoading = false }

        entries = []
        therapies = []
        checkups = []
        observations = []
        entriesErrorMessage = nil
        therapiesErrorMessage = nil
        checkupsErrorMessage = nil
        observationsErrorMessage = nil

        do {
            detail = try await LocalAPIClient.shared.fetchPatient(id: patientId)
            errorMessage = nil
        } catch {
            if let localError = error as? LocalAPIError {
                errorMessage = localError.localizedDescription
            } else {
                errorMessage = "Impossibile caricare il dettaglio."
            }
            return
        }

        await loadClinicalSections()
    }

    private func loadClinicalSections() async {
        /* @Codex */
        let entryType = entryTypeFilter == "all" ? nil : entryTypeFilter
        /* @Codex */
        let therapyStatus = therapyStatusFilter == "all" ? nil : therapyStatusFilter
        /* @Codex */
        let checkupStatus = checkupStatusFilter == "all" ? nil : checkupStatusFilter

        do {
            entries = try await LocalAPIClient.shared.fetchEntries(
                patientId: patientId,
                limit: 50,
                type: entryType
            )
            entriesErrorMessage = nil
        } catch {
            entries = []
            entriesErrorMessage = message(for: error, fallback: "Impossibile caricare il diario clinico.")
        }

        do {
            therapies = try await LocalAPIClient.shared.fetchTherapies(
                patientId: patientId,
                limit: 50,
                status: therapyStatus
            )
            therapiesErrorMessage = nil
        } catch {
            therapies = []
            therapiesErrorMessage = message(for: error, fallback: "Impossibile caricare le terapie.")
        }

        do {
            checkups = try await LocalAPIClient.shared.fetchCheckups(
                patientId: patientId,
                limit: 50,
                status: checkupStatus
            )
            checkupsErrorMessage = nil
        } catch {
            checkups = []
            checkupsErrorMessage = message(for: error, fallback: "Impossibile caricare gli appuntamenti.")
        }

        do {
            observations = try await LocalAPIClient.shared.fetchObservations(
                patientId: patientId,
                limit: 50
            )
            observationsErrorMessage = nil
        } catch {
            observations = []
            observationsErrorMessage = message(for: error, fallback: "Impossibile caricare le osservazioni.")
        }

        updateAIPromptIfNeeded()
    }

    /* @Codex */
    @MainActor
    private func deleteEntry(_ entry: EntrySummary) async {
        pendingDeleteEntry = nil
        do {
            try await LocalAPIClient.shared.deleteEntry(patientId: patientId, entryId: entry.id)
            await loadClinicalSections()
        } catch {
            entriesErrorMessage = message(for: error, fallback: "Impossibile eliminare la voce clinica.")
        }
    }

    /* @Codex */
    @MainActor
    private func deleteTherapy(_ therapy: TherapySummary) async {
        pendingDeleteTherapy = nil
        do {
            try await LocalAPIClient.shared.deleteTherapy(patientId: patientId, therapyId: therapy.id)
            await loadClinicalSections()
        } catch {
            therapiesErrorMessage = message(for: error, fallback: "Impossibile eliminare la terapia.")
        }
    }

    /* @Codex */
    @MainActor
    private func deleteCheckup(_ checkup: CheckupSummary) async {
        pendingDeleteCheckup = nil
        do {
            try await LocalAPIClient.shared.deleteCheckup(patientId: patientId, checkupId: checkup.id)
            await loadClinicalSections()
        } catch {
            checkupsErrorMessage = message(for: error, fallback: "Impossibile eliminare l'appuntamento.")
        }
    }

    /* @Codex */
    @MainActor
    private func deleteObservation(_ observation: ObservationSummary) async {
        pendingDeleteObservation = nil
        do {
            try await LocalAPIClient.shared.deleteObservation(patientId: patientId, observationId: observation.id)
            await loadClinicalSections()
        } catch {
            observationsErrorMessage = message(for: error, fallback: "Impossibile eliminare l'osservazione.")
        }
    }

    @MainActor
    private func runAI() async {
        if isAILoading { return }
        isAILoading = true
        aiErrorMessage = nil
        defer { isAILoading = false }

        do {
            let provider = await AISettingsResolver.resolveProvider(for: .clinical)
            let config = try await AISettingsResolver.resolveClinicalConfig()
            /* @Codex */
            let cleanPrompt = aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleanPrompt.isEmpty else {
                aiErrorMessage = "Prompt vuoto: rigenera il contesto clinico."
                return
            }
            /* @Codex */
            let guardedPrompt = """
            Rispondi solo con output finale in italiano.
            Non includere tag <think>, <unused94>, <unused95> o ragionamento interno.

            \(cleanPrompt)
            """
            let raw = try await LocalAPIClient.shared.aiChat(prompt: guardedPrompt, model: config.model, baseURL: config.baseURL)
            let cleaned = cleanAIResponse(raw)
            /* @Codex */
            if cleaned.isEmpty {
                aiErrorMessage = "Il modello ha restituito una risposta vuota. Prova con \"Rigenera contesto\" o un modello diverso."
                aiResponse = "Provider: \(provider.uppercased())\nModello: \(config.model)\nEndpoint: \(config.baseURL)\n\n[Nessun contenuto utile generato]"
                return
            }
            aiResponse = "Provider: \(provider.uppercased())\nModello: \(config.model)\nEndpoint: \(config.baseURL)\n\n" + cleaned
        } catch {
            if let urlError = error as? URLError, urlError.code == .badServerResponse {
                aiErrorMessage = "Errore AI: autorizzazione o endpoint non valido."
            } else {
                aiErrorMessage = "Errore AI: verifica provider, modelli e connettivita locale."
            }
        }
    }

    private func cleanAIResponse(_ value: String) -> String {
        /* @Codex */
        var output = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !output.isEmpty else { return "" }

        output = removePairedBlocks(in: output, startMarker: "<unused94>", endMarker: "<unused95>")
        output = removePairedBlocks(in: output, startMarker: "<think>", endMarker: "</think>")
        output = output.replacingOccurrences(of: "<unused94>", with: "")
        output = output.replacingOccurrences(of: "<unused95>", with: "")
        output = output.replacingOccurrences(of: "<think>", with: "")
        output = output.replacingOccurrences(of: "</think>", with: "")
        output = output.replacingOccurrences(of: "```thinking", with: "")
        output = output.replacingOccurrences(of: "```", with: "")
        output = output.trimmingCharacters(in: .whitespacesAndNewlines)

        if !output.isEmpty {
            return output
        }

        let fallback = value
            .replacingOccurrences(of: "<unused94>", with: "")
            .replacingOccurrences(of: "<unused95>", with: "")
            .replacingOccurrences(of: "<think>", with: "")
            .replacingOccurrences(of: "</think>", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return fallback
    }

    private func updateAIPromptIfNeeded(force: Bool = false) {
        if !force {
            guard aiPrompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        }
        guard let detail else { return }

        var lines: [String] = []
        let age = ageText(from: detail.birthDate)
        lines.append("Paziente: \(detail.firstName) \(detail.lastName), \(age).")

        /* @Codex */
        if let summary = decryptOrPlain(detail.aiSummary),
           !summary.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            lines.append("Riassunto AI corrente:")
            lines.append(summary.trimmingCharacters(in: .whitespacesAndNewlines))
        } else if (detail.aiSummary ?? "").hasPrefix("ENC:") {
            /* @Codex */
            lines.append("Riassunto AI corrente: [contenuto cifrato non decifrabile in questa sessione]")
        }

        if let notes = decryptOrPlain(detail.notes), !notes.isEmpty {
            lines.append("Note: \(notes)")
        }

        /* @Codex */
        let insightSummaries = extractDocumentInsightSummaries(from: detail.documentInsights)
        if !insightSummaries.isEmpty {
            lines.append("Documenti analizzati:")
            for summary in insightSummaries.prefix(3) {
                lines.append("- \(summary)")
            }
        }

        if !entries.isEmpty {
            lines.append("Ultime voci cliniche:")
            for entry in entries.prefix(3) {
                let content = decryptOrPlain(entry.content) ?? "[cifrato]"
                lines.append("- \(formatted(date: entry.date)): \(content)")
            }
        }

        if !therapies.isEmpty {
            lines.append("Terapie:")
            for therapy in therapies.prefix(3) {
                lines.append("- \(therapy.drugName) (\(therapy.dosage)) [\(therapy.status)]")
            }
        }

        if !checkups.isEmpty {
            lines.append("Appuntamenti:")
            for checkup in checkups.prefix(3) {
                lines.append("- \(formatted(date: checkup.date)): \(checkup.title) [\(checkup.status)]")
            }
        }

        lines.append("Fornisci un riassunto clinico sintetico e punti di attenzione.")
        aiPrompt = lines.joined(separator: "\n")
    }

    /* @Codex */
    private func removePairedBlocks(in text: String, startMarker: String, endMarker: String) -> String {
        var result = text
        while let start = result.range(of: startMarker),
              let end = result.range(of: endMarker, range: start.lowerBound..<result.endIndex) {
            result.removeSubrange(start.lowerBound..<end.upperBound)
        }
        return result
    }

    /* @Codex */
    private func decryptOrPlain(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }

        if trimmed.hasPrefix("ENC:") {
            /* @Codex */
            guard let decrypted = security.decryptString(trimmed) else {
                return nil
            }
            let clean = decrypted.trimmingCharacters(in: .whitespacesAndNewlines)
            return clean.isEmpty ? nil : clean
        }
        return trimmed
    }

    /* @Codex */
    private func extractDocumentInsightSummaries(from raw: String?) -> [String] {
        guard let payload = decryptOrPlain(raw),
              let data = payload.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data, options: []),
              let items = json as? [[String: Any]] else {
            return []
        }

        return items.compactMap { item in
            let summary = (item["summary"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let fileName = (item["fileName"] as? String)?
                .trimmingCharacters(in: .whitespacesAndNewlines)

            guard let summary, !summary.isEmpty else { return nil }
            if let fileName, !fileName.isEmpty {
                return "\(summary) (\(fileName))"
            }
            return summary
        }
    }

    private func formatted(date: Date?) -> String {
        guard let date else { return "n/d" }
        return Self.dateFormatter.string(from: date)
    }

    private func message(for error: Error, fallback: String) -> String {
        if let localError = error as? LocalAPIError {
            return localError.localizedDescription
        }
        return fallback
    }

    private func displayValue(_ encrypted: String?) -> String {
        if let decrypted = security.decryptString(encrypted) {
            return decrypted
        }
        guard let value = encrypted, !value.isEmpty else { return "n/d" }
        /* @Codex */
        if value.hasPrefix("ENC:") { return "[Dati cifrati]" }
        return value
    }

    private func displayNotes(_ encrypted: String?) -> String {
        let value = displayValue(encrypted)
        if value == "n/d" || value == "[Dati cifrati]" { return value }
        return value.isEmpty ? "Nessuna nota" : value
    }

    /* @Codex */
    @ViewBuilder
    private func exemptionCodesBlock(raw: String?) -> some View {
        let decrypted = decryptOrPlain(raw)
        let codes = decrypted == "[Dati cifrati]" ? [] : ExemptionCodesCodec.decode(decrypted)

        if codes.isEmpty {
            Text("Nessun codice esenzione registrato.")
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(codes, id: \.self) { code in
                    Text(code)
                        .font(.system(.caption, design: .monospaced))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(Color.white.opacity(0.45))
                        )
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /* @Codex */
    private func ageText(from date: Date?) -> String {
        guard let date else { return "n/d" }
        let years = Calendar.current.dateComponents([.year], from: date, to: Date()).year
        if let years, years >= 0 {
            return "\(years) anni"
        }
        return "n/d"
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    /* @Codex */
    private var entryTypeFilterOptions: [(label: String, value: String)] {
        [
            ("Tutti", "all"),
            ("Visita", "visit"),
            ("Telefonata", "phone"),
            ("Esame", "exam"),
            ("Ricovero", "hospitalization"),
            ("Accesso", "access"),
            ("Nota", "note"),
            ("Scala", "scale"),
            ("Telemedicina", "remote")
        ]
    }

    /* @Codex */
    private var therapyStatusFilterOptions: [(label: String, value: String)] {
        [
            ("Tutti", "all"),
            ("Attiva", "active"),
            ("Sospesa", "suspended"),
            ("Completata", "completed")
        ]
    }

    /* @Codex */
    private var checkupStatusFilterOptions: [(label: String, value: String)] {
        [
            ("Tutti", "all"),
            ("In attesa", "pending"),
            ("Completato", "completed"),
            ("Annullato", "cancelled")
        ]
    }
}

/* @Codex */
private struct PatientDetailBackdrop: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var drift = false

    var body: some View {
        LinearGradient(
            colors: [
                Color(red: 0.955, green: 0.97, blue: 0.995),
                Color(red: 0.985, green: 0.985, blue: 0.992)
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(Color.cyan.opacity(0.14))
                .frame(width: 280, height: 280)
                .blur(radius: 34)
                .offset(x: drift ? 96 : 122, y: drift ? -108 : -128)
        }
        .overlay(alignment: .bottomLeading) {
            Circle()
                .fill(Color.indigo.opacity(0.08))
                .frame(width: 260, height: 260)
                .blur(radius: 42)
                .offset(x: drift ? -76 : -102, y: drift ? 74 : 104)
        }
        .ignoresSafeArea()
        .onAppear {
            if reduceMotion { return }
            withAnimation(.easeInOut(duration: 8).repeatForever(autoreverses: true)) {
                drift = true
            }
        }
    }
}

/* @Codex */
private struct PatientHeroIsland: View {
    let detail: PatientDetail
    let ageText: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text("\(detail.lastName) \(detail.firstName)")
                    .font(.system(size: 32, weight: .semibold, design: .rounded))

                Spacer()

                HStack(spacing: 8) {
                    if detail.isAdi == true {
                        TagView(text: "ADI", tone: .accentColor)
                    }
                    if detail.isArchived == true {
                        TagView(text: "Archiviato", tone: .orange)
                    }
                }
            }

            HStack(spacing: 14) {
                Label("CF \(detail.taxCode)", systemImage: "number")
                Label(ageText, systemImage: "calendar")
                if let birthDate = detail.birthDate {
                    Label(dateFormatter.string(from: birthDate), systemImage: "birthday.cake")
                }
            }
            .font(.callout)
            .foregroundStyle(.secondary)
        }
        .padding(22)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(.thickMaterial)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .stroke(Color.white.opacity(0.28), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 14, x: 0, y: 8)
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

/* @Codex */
private struct ConceptIsland<Content: View>: View {
    let title: String
    let subtitle: String
    let icon: String
    let accent: Color
    let content: Content

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isHovering = false

    init(title: String, subtitle: String, icon: String, accent: Color, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.icon = icon
        self.accent = accent
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(title)
                            .font(.headline)
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } icon: {
                    ZStack {
                        Circle()
                            .fill(accent.opacity(0.18))
                        Image(systemName: icon)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(accent)
                    }
                    .frame(width: 28, height: 28)
                }

                Spacer()
            }

            content
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(.thinMaterial)
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(accent.opacity(0.018))
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .stroke(Color.white.opacity(0.2), lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.06), radius: 12, x: 0, y: 7)
        .scaleEffect(isHovering ? 1.012 : 1)
        .offset(y: isHovering ? -1 : 0)
        .animation(
            reduceMotion ? .easeOut(duration: 0.12) : .spring(response: 0.24, dampingFraction: 0.72),
            value: isHovering
        )
        .onHover { hovering in
            isHovering = hovering
        }
    }
}

/* @Codex */
private struct IslandMotion: ViewModifier {
    let index: Int
    let isRevealed: Bool
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func body(content: Content) -> some View {
        content
            .offset(y: isRevealed ? 0 : 14)
            .opacity(isRevealed ? 1 : 0)
            .animation(
                (reduceMotion ? Animation.easeInOut(duration: 0.12) : Animation.spring(response: 0.44, dampingFraction: 0.88))
                    .delay(Double(index) * 0.028),
                value: isRevealed
            )
    }
}

private struct InfoRow: Identifiable {
    let id = UUID()
    let label: String
    let value: String
}

private struct InfoGrid: View {
    let rows: [InfoRow]

    var body: some View {
        Grid(alignment: .leading, horizontalSpacing: 24, verticalSpacing: 10) {
            ForEach(rows) { row in
                GridRow {
                    Text(row.label)
                        .foregroundStyle(.secondary)
                    Text(row.value)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
        }
    }
}

private struct EntryRowView: View {
    let entry: EntrySummary
    let content: String
    /* @Codex */
    let onEdit: (() -> Void)?
    /* @Codex */
    let onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: iconName(for: entry.type))
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(label(for: entry.type))
                        .font(.headline)
                    Spacer()
                    Text(dateFormatter.string(from: entry.date))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Text(content)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .lineLimit(3)
            }

            /* @Codex */
            if onEdit != nil || onDelete != nil {
                Menu {
                    if let onEdit {
                        Button("Modifica", action: onEdit)
                    }
                    if let onDelete {
                        Button("Elimina", role: .destructive, action: onDelete)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
            }
        }
    }

    private func label(for type: String) -> String {
        switch type {
        case "visit": return "Visita"
        case "phone": return "Telefonata"
        case "exam": return "Esame"
        case "hospitalization": return "Ricovero"
        case "access": return "Accesso"
        case "note": return "Nota"
        case "scale": return "Scala"
        case "remote": return "Telemedicina"
        default: return type.capitalized
        }
    }

    private func iconName(for type: String) -> String {
        switch type {
        case "visit": return "stethoscope"
        case "phone": return "phone"
        case "exam": return "testtube.2"
        case "hospitalization": return "cross.case"
        case "access": return "door.left.hand.open"
        case "note": return "note.text"
        case "scale": return "chart.bar"
        case "remote": return "video"
        default: return "doc.text"
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

private struct TherapyRowView: View {
    let therapy: TherapySummary
    /* @Codex */
    let onEdit: (() -> Void)?
    /* @Codex */
    let onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "pills")
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(therapy.drugName)
                        .font(.headline)
                    Spacer()
                    TagView(text: therapyStatusLabel(for: therapy.status), tone: tone(for: therapy.status))
                }
                Text(therapy.dosage)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text(dateRange(for: therapy))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            /* @Codex */
            if onEdit != nil || onDelete != nil {
                Menu {
                    if let onEdit {
                        Button("Modifica", action: onEdit)
                    }
                    if let onDelete {
                        Button("Elimina", role: .destructive, action: onDelete)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
            }
        }
    }

    private func dateRange(for therapy: TherapySummary) -> String {
        let start = dateFormatter.string(from: therapy.startDate)
        if let end = therapy.endDate {
            return "\(start) -> \(dateFormatter.string(from: end))"
        }
        return "\(start) -> in corso"
    }

    private func tone(for status: String) -> Color {
        switch status.lowercased() {
        case "active": return .green
        case "suspended", "paused": return .orange
        case "completed", "stopped", "interrupted": return .red
        default: return .secondary
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

private struct CheckupRowView: View {
    let checkup: CheckupSummary
    /* @Codex */
    let onEdit: (() -> Void)?
    /* @Codex */
    let onDelete: (() -> Void)?

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "calendar")
                .font(.title3)
                .foregroundColor(.accentColor)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(checkup.title)
                        .font(.headline)
                    Spacer()
                    TagView(text: checkupStatusLabel(for: checkup.status), tone: tone(for: checkup.status))
                }
                Text(dateFormatter.string(from: checkup.date))
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            /* @Codex */
            if onEdit != nil || onDelete != nil {
                Menu {
                    if let onEdit {
                        Button("Modifica", action: onEdit)
                    }
                    if let onDelete {
                        Button("Elimina", role: .destructive, action: onDelete)
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                }
                .menuStyle(.borderlessButton)
            }
        }
    }

    private func tone(for status: String) -> Color {
        switch status.lowercased() {
        case "pending": return .orange
        case "completed", "done": return .green
        case "cancelled": return .red
        default: return .secondary
        }
    }

    private var dateFormatter: DateFormatter {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }
}

/* @Codex */
private struct EditEntryView: View {
    @EnvironmentObject private var security: SecuritySession
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let entry: EntrySummary
    let initialContent: String
    let onSaved: () -> Void

    @State private var entryType: String
    @State private var date: Date
    @State private var content: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(patientId: String, entry: EntrySummary, initialContent: String, onSaved: @escaping () -> Void) {
        self.patientId = patientId
        self.entry = entry
        self.initialContent = initialContent
        self.onSaved = onSaved
        _entryType = State(initialValue: entry.type)
        _date = State(initialValue: entry.date)
        _content = State(initialValue: initialContent)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Dettagli") {
                    Picker("Tipo", selection: $entryType) {
                        ForEach(entryTypes, id: \.value) { item in
                            Text(item.label).tag(item.value)
                        }
                    }
                    DatePicker("Data", selection: $date, displayedComponents: .date)
                    TextEditor(text: $content)
                        .frame(minHeight: 180)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") { dismiss() }
                Spacer()
                Button(isSaving ? "Salvataggio..." : "Salva modifiche") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 540, minHeight: 560)
    }

    private var entryTypes: [(label: String, value: String)] {
        [
            ("Visita", "visit"),
            ("Telefonata", "phone"),
            ("Esame", "exam"),
            ("Ricovero", "hospitalization"),
            ("Accesso", "access"),
            ("Nota", "note"),
            ("Scala", "scale"),
            ("Telemedicina", "remote")
        ]
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let trimmed = content.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            errorMessage = "Contenuto richiesto"
            return
        }

        do {
            guard let encryptedContent = try security.encryptString(trimmed) else {
                errorMessage = "Impossibile cifrare il contenuto"
                return
            }

            let payload = UpdateEntryPayload(
                type: entryType,
                date: date,
                content: encryptedContent
            )
            try await LocalAPIClient.shared.updateEntry(patientId: patientId, entryId: entry.id, payload: payload)
            onSaved()
            dismiss()
        } catch {
            if let cryptoError = error as? CryptoService.CryptoError {
                errorMessage = cryptoError.message
            } else {
                errorMessage = "Aggiornamento fallito"
            }
        }
    }
}

/* @Codex */
private struct EditTherapyView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let therapy: TherapySummary
    let onSaved: () -> Void

    @State private var drugName: String
    @State private var dosage: String
    @State private var status: String
    @State private var startDate: Date
    @State private var includeEndDate: Bool
    @State private var endDate: Date
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(patientId: String, therapy: TherapySummary, onSaved: @escaping () -> Void) {
        self.patientId = patientId
        self.therapy = therapy
        self.onSaved = onSaved
        _drugName = State(initialValue: therapy.drugName)
        _dosage = State(initialValue: therapy.dosage)
        _status = State(initialValue: normalizedTherapyStatus(therapy.status))
        _startDate = State(initialValue: therapy.startDate)
        _includeEndDate = State(initialValue: therapy.endDate != nil)
        _endDate = State(initialValue: therapy.endDate ?? Date())
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Farmaco") {
                    TextField("Nome farmaco", text: $drugName)
                    TextField("Dosaggio", text: $dosage)
                }

                Section("Stato") {
                    Picker("Stato", selection: $status) {
                        ForEach(statusOptions, id: \.value) { option in
                            Text(option.label).tag(option.value)
                        }
                    }
                    .pickerStyle(.menu)
                }

                Section("Date") {
                    DatePicker("Inizio", selection: $startDate, displayedComponents: .date)
                    Toggle("Data fine", isOn: $includeEndDate)
                    if includeEndDate {
                        DatePicker("", selection: $endDate, displayedComponents: .date)
                            .labelsHidden()
                    }
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") { dismiss() }
                Spacer()
                Button(isSaving ? "Salvataggio..." : "Salva modifiche") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || drugName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 560)
    }

    private var statusOptions: [(label: String, value: String)] {
        [
            ("Attiva", "active"),
            ("Sospesa", "suspended"),
            ("Completata", "completed")
        ]
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let trimmedDrugName = drugName.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDosage = dosage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedDrugName.isEmpty else {
            errorMessage = "Nome farmaco richiesto"
            return
        }

        do {
            let payload = UpdateTherapyPayload(
                drugName: trimmedDrugName,
                /* @Codex */
                aic: therapy.aic.map(PatchValue.value) ?? .omit,
                /* @Codex */
                atc: therapy.atc.map(PatchValue.value) ?? .omit,
                dosage: trimmedDosage.isEmpty ? "n/d" : trimmedDosage,
                status: status,
                startDate: startDate,
                endDate: includeEndDate ? .value(endDate) : .null
            )
            try await LocalAPIClient.shared.updateTherapy(patientId: patientId, therapyId: therapy.id, payload: payload)
            onSaved()
            dismiss()
        } catch {
            errorMessage = "Aggiornamento fallito"
        }
    }
}

/* @Codex */
private struct EditCheckupView: View {
    @Environment(\.dismiss) private var dismiss

    let patientId: String
    let checkup: CheckupSummary
    let onSaved: () -> Void

    @State private var title: String
    @State private var date: Date
    @State private var status: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(patientId: String, checkup: CheckupSummary, onSaved: @escaping () -> Void) {
        self.patientId = patientId
        self.checkup = checkup
        self.onSaved = onSaved
        _title = State(initialValue: checkup.title)
        _date = State(initialValue: checkup.date)
        _status = State(initialValue: normalizedCheckupStatus(checkup.status))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Form {
                Section("Dettagli") {
                    TextField("Titolo", text: $title)
                    DatePicker("Data", selection: $date, displayedComponents: .date)
                    Picker("Stato", selection: $status) {
                        Text("In attesa").tag("pending")
                        Text("Completato").tag("completed")
                        Text("Annullato").tag("cancelled")
                    }
                    .pickerStyle(.segmented)
                }
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            HStack {
                Button("Annulla") { dismiss() }
                Spacer()
                Button(isSaving ? "Salvataggio..." : "Salva modifiche") {
                    Task { await save() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isSaving || title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(24)
        .frame(minWidth: 520, minHeight: 420)
    }

    @MainActor
    private func save() async {
        if isSaving { return }
        isSaving = true
        defer { isSaving = false }

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedTitle.isEmpty else {
            errorMessage = "Titolo richiesto"
            return
        }

        do {
            let payload = UpdateCheckupPayload(date: date, title: trimmedTitle, status: status)
            try await LocalAPIClient.shared.updateCheckup(patientId: patientId, checkupId: checkup.id, payload: payload)
            onSaved()
            dismiss()
        } catch {
            errorMessage = "Aggiornamento fallito"
        }
    }
}
