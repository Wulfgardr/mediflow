import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct PairedPatientsWorkspaceView: View {
    @StateObject private var model = PairedPatientsWorkspaceModel()
    @State private var confirmsClearingPairing = false
    @State private var confirmsDeletingEntry = false
    @State private var deletionCandidateId: String?
    @State private var confirmsDeletingTherapy = false
    @State private var therapyDeletionCandidateId: String?
    @State private var confirmsDeletingCheckup = false
    @State private var checkupDeletionCandidateId: String?
    @State private var confirmsDeletingObservation = false
    @State private var observationDeletionCandidateId: String?
    @State private var patientQuery = ""
    @State private var patientViewMode: PatientListViewMode = .active
    @State private var patientSortMode: PatientListSortMode = .recent
    @State private var therapyStatusFilter: TherapyStatusFilter = .all
    @State private var checkupStatusFilter: CheckupStatusFilter = .all
    @State private var entryTypeFilter: EntryTypeFilter = .all
    private let actionColumns = [GridItem(.adaptive(minimum: 150), spacing: 8)]

    var body: some View {
        layoutBody
        .background(PlatformColors.groupedBackground)
        .task {
            await model.performAutomaticActionsIfNeeded()
        }
        .confirmationDialog(
            "Annullare questa voce diario?",
            isPresented: $confirmsDeletingEntry,
            titleVisibility: .visible
        ) {
            Button("Annulla voce", role: .destructive) {
                guard let deletionCandidateId else { return }
                self.deletionCandidateId = nil
                Task { await model.softDeleteEntry(id: deletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("La voce resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questa terapia?",
            isPresented: $confirmsDeletingTherapy,
            titleVisibility: .visible
        ) {
            Button("Annulla terapia", role: .destructive) {
                guard let therapyDeletionCandidateId else { return }
                self.therapyDeletionCandidateId = nil
                Task { await model.softDeleteTherapy(id: therapyDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("La terapia resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questo controllo?",
            isPresented: $confirmsDeletingCheckup,
            titleVisibility: .visible
        ) {
            Button("Annulla controllo", role: .destructive) {
                guard let checkupDeletionCandidateId else { return }
                self.checkupDeletionCandidateId = nil
                Task { await model.softDeleteCheckup(id: checkupDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("Il controllo resta nello storico come annullato. Nessun hard delete viene eseguito dal client mobile.")
        }
        .confirmationDialog(
            "Annullare questa osservazione?",
            isPresented: $confirmsDeletingObservation,
            titleVisibility: .visible
        ) {
            Button("Annulla osservazione", role: .destructive) {
                guard let observationDeletionCandidateId else { return }
                self.observationDeletionCandidateId = nil
                Task { await model.softDeleteObservation(id: observationDeletionCandidateId) }
            }
            Button("Mantieni", role: .cancel) {}
        } message: {
            Text("L'osservazione resta nello storico come annullata. Nessun hard delete viene eseguito dal client mobile.")
        }
    }

    #if os(iOS)
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    #endif

    private var usesSplitLayout: Bool {
        #if os(macOS)
        return true
        #else
        return horizontalSizeClass == .regular
        #endif
    }

    // Compact (iPhone): one column, list and selected-patient detail stacked.
    // Regular (iPad/macOS): true master-detail, patient list beside the open patient.
    @ViewBuilder
    private var layoutBody: some View {
        if usesSplitLayout {
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        credentialsCard
                        patientsListCard
                    }
                    .padding(20)
                }
                .frame(width: 360)

                Divider()

                ScrollView {
                    Group {
                        if let detail = model.selectedPatient {
                            patientDetailCard(detail)
                        } else {
                            emptyDetailState
                        }
                    }
                    .padding(20)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                .frame(maxWidth: .infinity)
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    credentialsCard
                    patientsCard
                }
                .padding(20)
            }
        }
    }

    private var emptyDetailState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.text.rectangle")
                .font(.largeTitle)
                .foregroundStyle(.secondary)
            Text("Seleziona un paziente")
                .font(.headline)
            Text("Scegli un paziente dall'elenco per vederne scheda, diario, terapie, controlli e osservazioni.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, minHeight: 320)
    }

    private var credentialsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Home-base paired")
                .font(.headline)
            Text("Usa credenziali paired generate dal Mac e una login operatore separata.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            TextField("Server HTTPS", text: $model.serverURL)
                .accessibilityIdentifier("homebase-server-url-field")
            TextField("Fingerprint SHA256 (opzionale)", text: $model.tlsPin)
                .accessibilityIdentifier("homebase-tls-pin-field")
            Button("Scopri in LAN") {
                Task { await model.discoverHomeBase() }
            }
            .accessibilityIdentifier("homebase-discover-button")
            .disabled(model.isWorking)
            .frame(maxWidth: .infinity, alignment: .leading)
            TextField("Paired client ID", text: $model.pairedClientId)
                .accessibilityIdentifier("homebase-paired-client-id-field")
            SecureField("Paired client token", text: $model.pairedClientToken)
                .accessibilityIdentifier("homebase-paired-client-token-field")
            TextField("Username (opzionale se utente unico)", text: $model.username)
                .accessibilityIdentifier("homebase-username-field")
            SecureField("PIN operatore", text: $model.password)
                .accessibilityIdentifier("homebase-password-field")
            TextField("Ambulatorio attivo (opzionale)", text: $model.ambulatoryId)
                .accessibilityIdentifier("homebase-ambulatory-field")
            if !model.availableAmbulatories.isEmpty {
                Menu {
                    ForEach(model.availableAmbulatories) { ambulatory in
                        Button(ambulatory.name) {
                            model.selectAmbulatory(ambulatory.id)
                        }
                    }
                } label: {
                    Label(activeAmbulatoryLabel, systemImage: "building.2")
                        .font(.caption)
                }
                .accessibilityIdentifier("ambulatory-scope-picker")
            }
            LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                Button("Accedi operatore") {
                    Task { await model.login() }
                }
                .accessibilityIdentifier("homebase-login-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Carica pazienti") {
                    Task { await model.loadPatients() }
                }
                .accessibilityIdentifier("homebase-load-patients-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Salva dispositivo") {
                    Task { await model.savePairing() }
                }
                .accessibilityIdentifier("homebase-save-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)

                Button("Dissocia") {
                    confirmsClearingPairing = true
                }
                .tint(.red)
                .accessibilityIdentifier("homebase-clear-pairing-button")
                .disabled(model.isWorking)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text("PIN operatore e sessione restano locali e vengono richiesti a ogni riapertura.")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let message = model.discoveryMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-discovery-message")
            }
            if let message = model.statusMessage {
                Text(message)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-status-message")
            }
            if let error = model.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("homebase-error-message")
            }
        }
        .cardStyle()
        .confirmationDialog(
            "Dissociare questo dispositivo?",
            isPresented: $confirmsClearingPairing,
            titleVisibility: .visible
        ) {
            Button("Dissocia dispositivo", role: .destructive) {
                Task { await model.clearPairing() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Rimuove credenziali paired e snapshot locale da questo dispositivo.")
        }
    }

    private var patientsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            patientsListContent
            if let detail = model.selectedPatient {
                Divider()
                selectedPatientSections(detail)
            }
        }
        .cardStyle()
    }

    // Master column (regular layout): patient list only.
    private var patientsListCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            patientsListContent
        }
        .cardStyle()
    }

    // Detail column (regular layout): the open patient's sections.
    private func patientDetailCard(_ detail: HomeBasePatientDetail) -> some View {
        selectedPatientSections(detail)
            .cardStyle()
    }

    @ViewBuilder
    private var patientsListContent: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("Consultazione mobile")
                .font(.headline)
            Spacer(minLength: 8)
            Label(model.connectionState.title, systemImage: model.connectionState.symbolName)
                .font(.caption.weight(.semibold))
                .foregroundStyle(model.connectionState.tintColor)
                .accessibilityIdentifier("homebase-connection-state")
        }
        Text(model.reconciliationLine)
            .font(.caption)
            .foregroundStyle(.secondary)
            .accessibilityIdentifier("homebase-reconciliation-state")
        if let presentation = model.conflictPresentation {
            conflictBanner(presentation)
        }
        if model.isWorking && model.patients.isEmpty {
            ProgressView()
        } else if model.patients.isEmpty {
            Text("Nessun paziente caricato.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        } else {
            patientSearchControls
            let results = filteredPatients
            if results.isEmpty {
                Text("Nessun paziente per questi filtri.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("patient-search-empty")
            } else {
                ForEach(results) { patient in
                    Button {
                        Task { await model.loadPatient(patient) }
                    } label: {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("\(patient.lastName) \(patient.firstName)")
                                    .font(.subheadline.weight(.semibold))
                                Text(patient.taxCode)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            if model.selectedPatient?.id == patient.id {
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tint)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("patient-cell-\(patient.id)")
                }
            }
        }
    }

    private var filteredPatients: [HomeBasePatientSummary] {
        PatientsFiltering.apply(
            patients: model.patients,
            query: patientQuery,
            viewMode: patientViewMode,
            sortMode: patientSortMode
        )
    }

    private var filteredDiaryEntries: [HomeBaseEntrySummary] {
        EntryFiltering.apply(model.entries, filter: entryTypeFilter)
    }

    private var patientSearchControls: some View {
        VStack(spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Cerca per nome o codice fiscale", text: $patientQuery)
                    .textFieldStyle(.plain)
                    .autocorrectionDisabled()
                    .accessibilityIdentifier("patient-search-field")
                if !patientQuery.isEmpty {
                    Button {
                        patientQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(.secondary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("patient-search-clear")
                }
            }
            HStack(spacing: 10) {
                Picker("Stato", selection: $patientViewMode) {
                    Text("Attivi").tag(PatientListViewMode.active)
                    Text("Archiviati").tag(PatientListViewMode.archived)
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("patient-view-mode")
                Menu {
                    Picker("Ordina", selection: $patientSortMode) {
                        Text("Recenti").tag(PatientListSortMode.recent)
                        Text("Alfabetico").tag(PatientListSortMode.alpha)
                    }
                } label: {
                    Image(systemName: "arrow.up.arrow.down")
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("patient-sort-menu")
            }
        }
    }

    @ViewBuilder
    private func selectedPatientSections(_ detail: HomeBasePatientDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            patientDetailSection(detail)
            diarySection
            therapiesSection
            checkupsSection
            observationsSection
        }
    }

    private func patientDetailSection(_ detail: HomeBasePatientDetail) -> some View {
        let exemptions = ExemptionCodesCodec.decode(detail.exemptions)
        return VStack(alignment: .leading, spacing: 8) {
            HStack {
                Label("Anagrafica", systemImage: "person.text.rectangle")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button {
                    model.startEditingPatient()
                } label: {
                    Label("Modifica", systemImage: "pencil")
                }
                .font(.caption)
                .disabled(model.isEditingPatient)
                .accessibilityIdentifier("edit-patient-button")
            }
            Text("\(detail.lastName) \(detail.firstName)")
                .font(.title3.weight(.semibold))
                .accessibilityIdentifier("patient-detail-name")
            if detail.isAdi == true || detail.isArchived == true {
                HStack(spacing: 6) {
                    if detail.isAdi == true { flagChip("ADI", tone: .info) }
                    if detail.isArchived == true { flagChip("Archiviato", tone: .neutral) }
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                InfoRow("Codice fiscale", detail.taxCode)
                if let birth = detail.birthDate {
                    InfoRow("Data di nascita", Self.birthDateFormatter.string(from: birth))
                }
                if let address = cleaned(detail.address) { InfoRow("Indirizzo", address) }
                if let phone = cleaned(detail.phone) { InfoRow("Telefono", phone) }
                if let caregiver = cleaned(detail.caregiver) { InfoRow("Caregiver", caregiver) }
                if let ambulatory = cleaned(detail.ambulatoryId) { InfoRow("Ambulatorio", ambulatory) }
                if let monitoring = cleaned(detail.monitoringProfile) { InfoRow("Monitoraggio", monitoring) }
            }
            if !exemptions.isEmpty {
                InfoRow("Esenzioni", exemptions.joined(separator: " · "))
                    .accessibilityIdentifier("patient-detail-exemptions")
            }
            if let aiSummary = cleaned(detail.aiSummary) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Sintesi AI", systemImage: "sparkles")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(aiSummary)
                        .font(.callout)
                }
                .accessibilityIdentifier("patient-detail-ai-summary")
            }
            if let documentInsights = cleaned(detail.documentInsights) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Analisi documenti", systemImage: "doc.text.magnifyingglass")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(documentInsights)
                        .font(.callout)
                }
                .accessibilityIdentifier("patient-detail-document-insights")
            }
            if let statusReason = cleaned(detail.statusReason) {
                Text(statusReason)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if let notes = cleaned(detail.notes) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Note")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(notes)
                        .font(.callout)
                }
            }
            if model.isEditingPatient {
                Divider()
                patientEditForm
            }
        }
    }

    private var patientEditForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modifica anagrafica")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Nome", text: $model.editPatientFirstName)
                .accessibilityIdentifier("edit-patient-firstName")
            TextField("Cognome", text: $model.editPatientLastName)
                .accessibilityIdentifier("edit-patient-lastName")
            TextField("Codice fiscale", text: $model.editPatientTaxCode)
                .accessibilityIdentifier("edit-patient-taxCode")
            TextField("Indirizzo", text: $model.editPatientAddress)
                .accessibilityIdentifier("edit-patient-address")
            TextField("Telefono", text: $model.editPatientPhone)
                .accessibilityIdentifier("edit-patient-phone")
            TextField("Caregiver", text: $model.editPatientCaregiver)
                .accessibilityIdentifier("edit-patient-caregiver")
            TextField("Note", text: $model.editPatientNotes, axis: .vertical)
                .accessibilityIdentifier("edit-patient-notes")
            Toggle("Archiviato", isOn: $model.editPatientIsArchived)
                .accessibilityIdentifier("edit-patient-archived")
            HStack(spacing: 10) {
                Button("Salva") {
                    Task { await model.savePatient() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)
                .accessibilityIdentifier("save-patient-button")
                Button("Annulla") {
                    model.cancelEditingPatient()
                }
                .accessibilityIdentifier("cancel-patient-button")
            }
        }
        .textFieldStyle(.roundedBorder)
    }

    private func cleaned(_ value: String?) -> String? {
        value.flatMap { $0.trimmedOrNil }
    }

    private var activeAmbulatoryLabel: String {
        if let match = model.availableAmbulatories.first(where: { $0.id == model.ambulatoryId }) {
            return "Scope: \(match.name)"
        }
        return model.ambulatoryId.isEmpty ? "Seleziona ambulatorio" : "Scope: \(model.ambulatoryId)"
    }

    // Reconciliation banner for a typed 409 conflict. Plain tinted card (no glass
    // nesting), warning tone. Offers a no-clobber reload, not an auto-overwrite.
    private func conflictBanner(_ presentation: VersionConflictPresentation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            // Identifier on the leaf title (not the container) so the inner buttons
            // stay individually queryable instead of collapsing into one element.
            Label(presentation.title, systemImage: "exclamationmark.triangle.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.orange)
                .accessibilityIdentifier("version-conflict-banner")
            Text(presentation.detail)
                .font(.caption)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Button("Ricarica i dati aggiornati") {
                    Task { await model.reloadAfterConflict() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking)
                .accessibilityIdentifier("reload-after-conflict-button")
                Button("Ignora") {
                    model.dismissConflict()
                }
                .accessibilityIdentifier("dismiss-conflict-button")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.orange.opacity(0.4)))
    }

    // Plain tinted capsule (no glass): glass inside the glass card would nest.
    private func flagChip(_ text: String, tone: VetroTone) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
            .foregroundStyle(VetroPalette.tint(for: tone))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(VetroPalette.tint(for: tone).opacity(0.12), in: Capsule())
    }

    private static let birthDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    private var diarySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Diario clinico", systemImage: "list.bullet.clipboard")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime 20 voci")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Task { await model.loadSelectedPatientEntries() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .font(.caption)
                .disabled(model.isWorking || model.selectedPatient == nil)
                .accessibilityIdentifier("homebase-refresh-entries-button")

                Menu {
                    Picker("Tipo voce", selection: $entryTypeFilter) {
                        ForEach(EntryTypeFilter.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Label(entryTypeFilter.title, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                }
                .accessibilityIdentifier("entry-type-filter")
            }

            if model.entries.isEmpty {
                Text("Nessuna voce diario caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if filteredDiaryEntries.isEmpty {
                Text("Nessuna voce per questo filtro.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(filteredDiaryEntries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline) {
                            Text(entry.title)
                                .font(.caption.weight(.semibold))
                            if let type = PairedDiaryEntryType(rawValue: entry.type) {
                                flagChip(type.title, tone: .info)
                            }
                            Spacer(minLength: 8)
                            Text(Self.entryDateFormatter.string(from: entry.date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(entry.content)
                            .font(.caption)
                            .foregroundStyle(entry.deletedAt == nil ? .primary : .secondary)
                            .lineLimit(4)
                        if entry.deletedAt != nil {
                            Text("Voce annullata")
                                .font(.caption2.weight(.semibold))
                                .foregroundStyle(.orange)
                        } else if model.canMutateEntry(entry) {
                            HStack(spacing: 8) {
                                Button {
                                    model.startEditingEntry(entry)
                                } label: {
                                    Label("Modifica", systemImage: "pencil")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("homebase-edit-entry-button-\(entry.id)")

                                Button(role: .destructive) {
                                    deletionCandidateId = entry.id
                                    confirmsDeletingEntry = true
                                } label: {
                                    Label("Annulla", systemImage: "xmark.circle")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("homebase-delete-entry-button-\(entry.id)")
                            }
                        }
                    }
                    .padding(.vertical, 6)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .accessibilityIdentifier("entry-row-\(entry.id)")
                }
            }

            if model.isEditingEntry {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Label("Modifica voce online", systemImage: "pencil")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    TextField("Titolo", text: $model.editEntryTitle)
                        .accessibilityIdentifier("homebase-edit-entry-title-field")
                    Picker("Tipo", selection: $model.editEntryType) {
                        ForEach(PairedDiaryEntryType.allCases) { type in
                            Text(type.title).tag(type)
                        }
                    }
                    .pickerStyle(.segmented)
                    .accessibilityIdentifier("homebase-edit-entry-type-picker")
                    TextEditor(text: $model.editEntryContent)
                        .frame(minHeight: 90)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(PlatformColors.separator, lineWidth: 1)
                        )
                        .accessibilityIdentifier("homebase-edit-entry-content-field")
                    HStack(spacing: 8) {
                        Text("\(model.editEntryContent.count)/2000")
                            .font(.caption2)
                            .foregroundStyle(model.editEntryContent.count <= 2000 ? Color.secondary : Color.red)
                        Spacer(minLength: 8)
                        Button("Annulla") {
                            model.cancelEditingEntry()
                        }
                        .font(.caption)
                        .accessibilityIdentifier("homebase-cancel-edit-entry-button")
                        Button {
                            Task { await model.updateEditingEntry() }
                        } label: {
                            Label("Salva modifiche", systemImage: "checkmark.circle")
                        }
                        .font(.caption)
                        .disabled(!model.canUpdateEditingEntry)
                        .accessibilityIdentifier("homebase-update-entry-button")
                    }
                    Text("Disponibile solo online. Se la versione non coincide, ricarica il diario prima di riprovare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            }

            Divider()

            VStack(alignment: .leading, spacing: 8) {
                Label("Nuova voce online", systemImage: "square.and.pencil")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                TextField("Titolo (opzionale)", text: $model.newEntryTitle)
                    .accessibilityIdentifier("homebase-new-entry-title-field")
                Picker("Tipo", selection: $model.newEntryType) {
                    ForEach(PairedDiaryEntryType.allCases) { type in
                        Text(type.title).tag(type)
                    }
                }
                .pickerStyle(.segmented)
                .accessibilityIdentifier("homebase-new-entry-type-picker")
                TextEditor(text: $model.newEntryContent)
                    .frame(minHeight: 90)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(PlatformColors.separator, lineWidth: 1)
                    )
                    .accessibilityIdentifier("homebase-new-entry-content-field")
                Text("\(model.newEntryContent.count)/2000")
                    .font(.caption2)
                    .foregroundStyle(model.newEntryContent.count <= 2000 ? Color.secondary : Color.red)
                Button {
                    Task { await model.createEntryForSelectedPatient() }
                } label: {
                    Label("Salva voce", systemImage: "checkmark.circle")
                }
                .disabled(!model.canCreateEntry)
                .accessibilityIdentifier("homebase-create-entry-button")
                Text("Disponibile solo online: se il Mac non risponde, la voce non viene accodata.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
    }

    /* @Codex */
    private var therapiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Terapie", systemImage: "pills")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime 20 terapie")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Button {
                    Task { await model.loadSelectedPatientTherapies() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .font(.caption)
                .disabled(model.isWorking || model.selectedPatient == nil)
                .accessibilityIdentifier("homebase-refresh-therapies-button")

                if !model.therapies.isEmpty {
                    ShareLink(item: TherapyPlanDocument.plainText(
                        patientName: model.selectedPatient.map { "\($0.firstName) \($0.lastName)" } ?? "Paziente",
                        therapies: model.therapies,
                        dateLabel: Self.entryDateFormatter.string(from: Date())
                    )) {
                        Label("Esporta", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("export-therapy-plan-button")
                }

                Menu {
                    Picker("Stato terapie", selection: $therapyStatusFilter) {
                        ForEach(TherapyStatusFilter.allCases) { option in
                            Text(option.title).tag(option)
                        }
                    }
                } label: {
                    Label(therapyStatusFilter.title, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.caption)
                }
                .accessibilityIdentifier("therapy-status-filter")
            }

            if model.therapies.isEmpty {
                Text("Nessuna terapia caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                let filteredTherapies = TherapyFiltering.apply(model.therapies, filter: therapyStatusFilter)
                if filteredTherapies.isEmpty {
                    Text("Nessuna terapia per questo filtro.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredTherapies, id: \.id) { therapy in
                        therapyRow(therapy)
                            .accessibilityIdentifier("therapy-row-\(therapy.id)")
                    }
                }
            }

            if model.isEditingTherapy {
                Divider()
                therapyForm(
                    title: "Modifica terapia online",
                    drugName: $model.editTherapyDrugName,
                    activePrinciple: $model.editTherapyActivePrinciple,
                    dosage: $model.editTherapyDosage,
                    motivation: $model.editTherapyMotivation,
                    status: $model.editTherapyStatus,
                    startDate: $model.editTherapyStartDate,
                    hasEndDate: $model.editTherapyHasEndDate,
                    endDate: $model.editTherapyEndDate,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-therapy-button",
                    canSubmit: model.canUpdateEditingTherapy,
                    onCancel: { model.cancelEditingTherapy() },
                    onSubmit: { Task { await model.updateEditingTherapy() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le terapie prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            therapyForm(
                title: "Nuova terapia online",
                drugName: $model.newTherapyDrugName,
                activePrinciple: $model.newTherapyActivePrinciple,
                dosage: $model.newTherapyDosage,
                motivation: $model.newTherapyMotivation,
                status: $model.newTherapyStatus,
                startDate: $model.newTherapyStartDate,
                hasEndDate: $model.newTherapyHasEndDate,
                endDate: $model.newTherapyEndDate,
                primaryLabel: "Salva terapia",
                primaryIdentifier: "homebase-create-therapy-button",
                canSubmit: model.canCreateTherapy,
                onCancel: nil,
                onSubmit: { Task { await model.createTherapyForSelectedPatient() } }
            )
            Text("Solo campi non-AI. Nessuna prescrizione SISS nativa o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // Semantic status color (Vetro Clinico tone), or attention if soft-deleted.
    // Kept as tinted text rather than a glass badge: Liquid Glass is for the
    // control/navigation layer, not every content row.
    private func therapyStatusColor(_ therapy: HomeBaseTherapySummary) -> Color {
        if therapy.deletedAt != nil { return VetroPalette.tint(for: .attention) }
        return VetroPalette.tint(for: PairedTherapyStatus(rawValue: therapy.status)?.tone ?? .neutral)
    }

    private func checkupStatusColor(_ checkup: HomeBaseCheckupSummary) -> Color {
        if checkup.deletedAt != nil { return VetroPalette.tint(for: .attention) }
        return VetroPalette.tint(for: PairedCheckupStatus(rawValue: checkup.status)?.tone ?? .neutral)
    }

    /* @Codex */
    private func therapyRow(_ therapy: HomeBaseTherapySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(therapy.drugName)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(PairedTherapyStatus(rawValue: therapy.status)?.title ?? therapy.status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(therapyStatusColor(therapy))
            }
            Text(therapy.dosage)
                .font(.caption)
                .foregroundStyle(therapy.deletedAt == nil ? .primary : .secondary)
                .lineLimit(2)
            if let activePrinciple = therapy.activePrinciple, !activePrinciple.isEmpty {
                Text(activePrinciple)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            if let motivation = therapy.motivation, !motivation.isEmpty {
                Text(motivation)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Text(Self.therapyDateLine(for: therapy))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if therapy.deletedAt != nil {
                Text("Terapia annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateTherapy(therapy) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingTherapy(therapy)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-therapy-button-\(therapy.id)")

                    Button(role: .destructive) {
                        therapyDeletionCandidateId = therapy.id
                        confirmsDeletingTherapy = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-therapy-button-\(therapy.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func therapyForm(
        title: String,
        drugName: Binding<String>,
        activePrinciple: Binding<String>,
        dosage: Binding<String>,
        motivation: Binding<String>,
        status: Binding<PairedTherapyStatus>,
        startDate: Binding<Date>,
        hasEndDate: Binding<Bool>,
        endDate: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "pills")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Farmaco", text: drugName)
                .accessibilityIdentifier("\(primaryIdentifier)-drug-name")
            TextField("Principio attivo (opzionale)", text: activePrinciple)
                .accessibilityIdentifier("\(primaryIdentifier)-active-principle")
            TextField("Posologia", text: dosage)
                .accessibilityIdentifier("\(primaryIdentifier)-dosage")
            TextField("Motivazione (opzionale)", text: motivation)
                .accessibilityIdentifier("\(primaryIdentifier)-motivation")
            Picker("Stato", selection: status) {
                ForEach(PairedTherapyStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Inizio", selection: startDate, displayedComponents: .date)
                .accessibilityIdentifier("\(primaryIdentifier)-start-date")
            Toggle("Fine terapia", isOn: hasEndDate)
                .accessibilityIdentifier("\(primaryIdentifier)-has-end-date")
            if hasEndDate.wrappedValue {
                DatePicker("Fine", selection: endDate, displayedComponents: .date)
                    .accessibilityIdentifier("\(primaryIdentifier)-end-date")
            }
            HStack(spacing: 8) {
                if let onCancel {
                    Button("Annulla") {
                        onCancel()
                    }
                    .font(.caption)
                }
                Button {
                    onSubmit()
                } label: {
                    Label(primaryLabel, systemImage: "checkmark.circle")
                }
                .font(.caption)
                .disabled(!canSubmit)
                .accessibilityIdentifier(primaryIdentifier)
            }
        }
    }

    /* @Codex */
    private var checkupsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Controlli",
                subtitle: "Ultimi 20 controlli",
                systemImage: "calendar.badge.clock",
                refreshIdentifier: "homebase-refresh-checkups-button"
            ) {
                Task { await model.loadSelectedPatientCheckups() }
            }

            if model.checkups.isEmpty {
                Text("Nessun controllo caricato.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                HStack {
                    Spacer(minLength: 8)
                    Menu {
                        Picker("Stato controlli", selection: $checkupStatusFilter) {
                            ForEach(CheckupStatusFilter.allCases) { option in
                                Text(option.title).tag(option)
                            }
                        }
                    } label: {
                        Label(checkupStatusFilter.title, systemImage: "line.3.horizontal.decrease.circle")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("checkup-status-filter")
                }
                let filteredCheckups = CheckupFiltering.apply(model.checkups, filter: checkupStatusFilter)
                if filteredCheckups.isEmpty {
                    Text("Nessun controllo per questo filtro.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(filteredCheckups, id: \.id) { checkup in
                        checkupRow(checkup)
                            .accessibilityIdentifier("checkup-row-\(checkup.id)")
                    }
                }
            }

            if model.isEditingCheckup {
                Divider()
                checkupForm(
                    title: "Modifica controllo online",
                    checkupTitle: $model.editCheckupTitle,
                    notes: $model.editCheckupNotes,
                    status: $model.editCheckupStatus,
                    date: $model.editCheckupDate,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-checkup-button",
                    canSubmit: model.canUpdateEditingCheckup,
                    onCancel: { model.cancelEditingCheckup() },
                    onSubmit: { Task { await model.updateEditingCheckup() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica i controlli prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            checkupForm(
                title: "Nuovo controllo online",
                checkupTitle: $model.newCheckupTitle,
                notes: $model.newCheckupNotes,
                status: $model.newCheckupStatus,
                date: $model.newCheckupDate,
                primaryLabel: "Salva controllo",
                primaryIdentifier: "homebase-create-checkup-button",
                canSubmit: model.canCreateCheckup,
                onCancel: nil,
                onSubmit: { Task { await model.createCheckupForSelectedPatient() } }
            )
            Text("Solo campi manuali non-AI. Nessuna coda offline o import documentale.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var observationsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Osservazioni",
                subtitle: "Ultime 20 osservazioni",
                systemImage: "waveform.path.ecg",
                refreshIdentifier: "homebase-refresh-observations-button"
            ) {
                Task { await model.loadSelectedPatientObservations() }
            }

            if model.observations.isEmpty {
                Text("Nessuna osservazione caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                let trends = ObservationTrendComputer.compute(model.observations)
                ForEach(model.observations, id: \.id) { observation in
                    observationRow(observation, trend: trends[observation.id] ?? .none)
                }
            }

            if model.isEditingObservation {
                Divider()
                observationForm(
                    title: "Modifica osservazione online",
                    display: $model.editObservationDisplay,
                    code: $model.editObservationCode,
                    value: $model.editObservationValue,
                    unitCode: $model.editObservationUnitCode,
                    notes: $model.editObservationNotes,
                    observedAt: $model.editObservationObservedAt,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-observation-button",
                    canSubmit: model.canUpdateEditingObservation,
                    onCancel: { model.cancelEditingObservation() },
                    onSubmit: { Task { await model.updateEditingObservation() } }
                )
                Text("Disponibile solo online. Se la versione non coincide, ricarica le osservazioni prima di riprovare.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            Divider()

            observationForm(
                title: "Nuova osservazione online",
                display: $model.newObservationDisplay,
                code: $model.newObservationCode,
                value: $model.newObservationValue,
                unitCode: $model.newObservationUnitCode,
                notes: $model.newObservationNotes,
                observedAt: $model.newObservationObservedAt,
                primaryLabel: "Salva osservazione",
                primaryIdentifier: "homebase-create-observation-button",
                canSubmit: model.canCreateObservation,
                onCancel: nil,
                onSubmit: { Task { await model.createObservationForSelectedPatient() } }
            )
            Text("LOINC + UCUM manuali. Nessun AI plane remoto, OCR o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private func pairedSectionHeader(
        title: String,
        subtitle: String,
        systemImage: String,
        refreshIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Label(title, systemImage: systemImage)
                    .font(.subheadline.weight(.semibold))
                Text(subtitle)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            Button(action: action) {
                Label("Aggiorna", systemImage: "arrow.clockwise")
            }
            .font(.caption)
            .disabled(model.isWorking || model.selectedPatient == nil)
            .accessibilityIdentifier(refreshIdentifier)
        }
    }

    /* @Codex */
    private func checkupRow(_ checkup: HomeBaseCheckupSummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(checkup.title)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                Text(PairedCheckupStatus(rawValue: checkup.status)?.title ?? checkup.status)
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(checkupStatusColor(checkup))
            }
            Text(Self.entryDateFormatter.string(from: checkup.date))
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let notes = checkup.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(checkup.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if checkup.deletedAt != nil {
                Text("Controllo annullato")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateCheckup(checkup) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingCheckup(checkup)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-checkup-button-\(checkup.id)")

                    Button(role: .destructive) {
                        checkupDeletionCandidateId = checkup.id
                        confirmsDeletingCheckup = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-checkup-button-\(checkup.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private func observationRow(_ observation: HomeBaseObservationSummary, trend: ObservationTrend) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(observation.display)
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                if observation.deletedAt == nil, let glyph = Self.trendGlyph(trend) {
                    Image(systemName: glyph.symbol)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("observation-trend-\(observation.id)")
                        .accessibilityLabel(glyph.label)
                }
                Text("\(observation.value) \(observation.unitCode)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(observation.deletedAt == nil ? Color.primary : Color.secondary)
            }
            Text("\(observation.codeSystem) \(observation.code) - \(Self.entryDateFormatter.string(from: observation.observedAt))")
                .font(.caption2)
                .foregroundStyle(.secondary)
            if let notes = observation.notes, !notes.isEmpty {
                Text(notes)
                    .font(.caption)
                    .foregroundStyle(observation.deletedAt == nil ? .primary : .secondary)
                    .lineLimit(3)
            }
            if observation.deletedAt != nil {
                Text("Osservazione annullata")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
            } else if model.canMutateObservation(observation) {
                HStack(spacing: 8) {
                    Button {
                        model.startEditingObservation(observation)
                    } label: {
                        Label("Modifica", systemImage: "pencil")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-edit-observation-button-\(observation.id)")

                    Button(role: .destructive) {
                        observationDeletionCandidateId = observation.id
                        confirmsDeletingObservation = true
                    } label: {
                        Label("Annulla", systemImage: "xmark.circle")
                    }
                    .font(.caption)
                    .accessibilityIdentifier("homebase-delete-observation-button-\(observation.id)")
                }
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// SF Symbol + accessibility label for an observation trend. Clinically neutral:
    /// a direction only, never a good/bad color. Returns nil for `.none` (no arrow).
    private static func trendGlyph(_ trend: ObservationTrend) -> (symbol: String, label: String)? {
        switch trend {
        case .rising:
            return ("arrow.up.right", "Valore in aumento rispetto alla rilevazione precedente")
        case .falling:
            return ("arrow.down.right", "Valore in diminuzione rispetto alla rilevazione precedente")
        case .steady:
            return ("arrow.right", "Valore stabile rispetto alla rilevazione precedente")
        case .none:
            return nil
        }
    }

    /* @Codex */
    private func checkupForm(
        title: String,
        checkupTitle: Binding<String>,
        notes: Binding<String>,
        status: Binding<PairedCheckupStatus>,
        date: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "calendar.badge.clock")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Titolo", text: checkupTitle)
                .accessibilityIdentifier("\(primaryIdentifier)-title")
            Picker("Stato", selection: status) {
                ForEach(PairedCheckupStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("\(primaryIdentifier)-status")
            DatePicker("Data", selection: date, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-date")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            pairedFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    private func observationForm(
        title: String,
        display: Binding<String>,
        code: Binding<String>,
        value: Binding<String>,
        unitCode: Binding<String>,
        notes: Binding<String>,
        observedAt: Binding<Date>,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "waveform.path.ecg")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Parametro LOINC", text: display)
                .accessibilityIdentifier("\(primaryIdentifier)-display")
            TextField("Codice LOINC", text: code)
                .accessibilityIdentifier("\(primaryIdentifier)-code")
            HStack(spacing: 8) {
                TextField("Valore", text: value)
                    .accessibilityIdentifier("\(primaryIdentifier)-value")
                TextField("Unita UCUM", text: unitCode)
                    .accessibilityIdentifier("\(primaryIdentifier)-unit-code")
            }
            DatePicker("Rilevata", selection: observedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("\(primaryIdentifier)-observed-at")
            TextField("Note (opzionale)", text: notes)
                .accessibilityIdentifier("\(primaryIdentifier)-notes")
            pairedFormButtons(
                primaryLabel: primaryLabel,
                primaryIdentifier: primaryIdentifier,
                canSubmit: canSubmit,
                onCancel: onCancel,
                onSubmit: onSubmit
            )
        }
    }

    /* @Codex */
    private func pairedFormButtons(
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 8) {
            if let onCancel {
                Button("Annulla") {
                    onCancel()
                }
                .font(.caption)
            }
            Button {
                onSubmit()
            } label: {
                Label(primaryLabel, systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!canSubmit)
            .accessibilityIdentifier(primaryIdentifier)
        }
    }

    private static let entryDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        return formatter
    }()

    /* @Codex */
    private static let therapyDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .none
        return formatter
    }()

    /* @Codex */
    private static func therapyDateLine(for therapy: HomeBaseTherapySummary) -> String {
        let start = therapyDayFormatter.string(from: therapy.startDate)
        guard let endDate = therapy.endDate else { return "Dal \(start)" }
        return "Dal \(start) al \(therapyDayFormatter.string(from: endDate))"
    }
}
