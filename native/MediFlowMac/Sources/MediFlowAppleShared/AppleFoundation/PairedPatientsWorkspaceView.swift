import SwiftUI
import Charts
import PhotosUI
import UniformTypeIdentifiers
#if os(macOS)
import AppKit
#else
import UIKit
#endif

struct PairedPatientsWorkspaceView: View {
    @Environment(\.scenePhase) private var scenePhase
    @ObservedObject private var model: PairedPatientsWorkspaceModel
    // S6 (D7-bis): gates the new document surfaces on the effective capability
    // matrix returned for this pairing. The server downgrades host-supported but
    // ungranted keys to unavailable, so a legacy pairing gets proactive re-pair
    // guidance before a data-plane call can fail with 403.
    @ObservedObject private var capabilities: ClinicalWorkspaceCapabilitiesStore
    @State private var confirmsClearingPairing = false
    @State private var entryDeletionCandidate: HomeBaseEntrySummary?
    @State private var confirmsDeletingTherapy = false
    @State private var therapyDeletionCandidateId: String?
    @State private var confirmsDeletingCheckup = false
    @State private var checkupDeletionCandidateId: String?
    @State private var confirmsDeletingObservation = false
    @State private var observationDeletionCandidateId: String?
    @State private var patientLifecycleSheet: PatientLifecycleSheet?
    @State private var patientQuery = ""
    @State private var patientViewMode: PatientListViewMode = .active
    @State private var patientSortMode: PatientListSortMode = .recent
    @State private var therapyStatusFilter: TherapyStatusFilter = .all
    @State private var checkupStatusFilter: CheckupStatusFilter = .all
    @State private var entryTypeFilter: EntryTypeFilter = .all
    @State private var showsDeletedDiaryEntries = false
    @State private var confirmsReplacingEntryTemplate = false
    @State private var confirmsFHIRExport = false
    @State private var presentingScale: ClinicalScaleDefinition?
    @State private var icdQuery = ""
    // S6 (Wave 5): documents archive, upload, FSE single-record validation.
    @State private var attachmentDetailCandidate: HomeBaseAttachmentSummary?
    @State private var isPickingAttachmentFile = false
    @State private var pickedPhotoItem: PhotosPickerItem?
    @State private var attachmentPickerError: String?
    @State private var fseValidationKind: FseValidationRecordKind = .therapy
    @State private var selectedFseTherapyId: String?
    @State private var selectedFseObservationId: String?
    @State private var expandedInsightId: String?
    private let actionColumns = [GridItem(.adaptive(minimum: 150), spacing: 8)]

    init(model: PairedPatientsWorkspaceModel, capabilities: ClinicalWorkspaceCapabilitiesStore) {
        self.model = model
        self.capabilities = capabilities
    }

    var body: some View {
        layoutBody
        .background(PlatformColors.groupedBackground)
        .task {
            await model.performAutomaticActionsIfNeeded()
            #if DEBUG
            // Screenshot/UI-test affordance: auto-present a clinical scale sheet so
            // the live-scored form can be captured. Debug-only, never in release.
            if ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_PRESENT_SCALE"] == "adl" {
                presentingScale = ClinicalScales.adl
            }
            #endif
        }
        .sheet(item: $presentingScale) { scale in
            ClinicalScaleFormView(
                definition: scale,
                onSubmit: { answers in
                    Task { await model.submitScale(scale, answers: answers) }
                    presentingScale = nil
                },
                onCancel: { presentingScale = nil }
            )
        }
        .sheet(isPresented: $model.isCreatingPatient) {
            createPatientForm
        }
        .sheet(item: $entryDeletionCandidate) { entry in
            PairedDiaryDeleteSheet(entry: entry, model: model)
        }
        .sheet(item: $patientLifecycleSheet) { sheet in
            switch sheet {
            case .archive:
                PairedPatientArchiveSheet(model: model, isArchived: true)
            case .unarchive:
                PairedPatientArchiveSheet(model: model, isArchived: false)
            case .delete:
                PairedPatientDeleteSheet(model: model)
            }
        }
        .onChange(of: patientViewMode) { newValue in
            guard newValue == .trash else { return }
            Task { await model.loadPatientTrash() }
        }
        .onChange(of: scenePhase) { newValue in
            guard newValue == .active else { return }
            Task { await model.checkNetworkRevisionOnForeground() }
        }
        .confirmationDialog(
            "Esportare dati FHIR?",
            isPresented: $confirmsFHIRExport,
            titleVisibility: .visible
        ) {
            Button("Valida ed esporta") {
                Task { await model.prepareFHIRExport() }
            }
            Button("Annulla", role: .cancel) {}
        } message: {
            Text("Include anagrafica, diagnosi, diario non eliminato, terapie e osservazioni già decifrati nella scheda. I controlli non fanno parte del bundle FHIR. Non invia dati al FSE e non pubblica nulla fuori dal dispositivo.")
        }
        .confirmationDialog(
            "Validazione FSE con avvisi",
            isPresented: Binding(
                get: { model.pendingFHIRWarningValidation != nil },
                set: { if !$0 { model.dismissFHIRWarningValidation() } }
            ),
            titleVisibility: .visible
        ) {
            Button("Esporta comunque") {
                Task { await model.prepareFHIRExport(confirmWarnings: true) }
            }
            Button("Annulla", role: .cancel) {
                model.dismissFHIRWarningValidation()
            }
        } message: {
            if let validation = model.pendingFHIRWarningValidation {
                Text("\(validation.totalWarningCount) avvisi FSE. Errori: \(validation.totalErrorCount). Controlla terapie e osservazioni prima di condividere se non sei sicuro.")
            }
        }
        .confirmationDialog(
            "Sostituire il contenuto?",
            isPresented: $confirmsReplacingEntryTemplate,
            titleVisibility: .visible
        ) {
            Button("Sostituisci con template", role: .destructive) {
                model.insertNewEntrySOAPTemplate()
            }
            Button("Mantieni contenuto", role: .cancel) {}
        } message: {
            Text("Il campo contiene gia testo. Il template S/O/A/P sostituisce il contenuto corrente.")
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
                    #if DEBUG
                    if focusedDetailOnly, let detail = model.selectedPatient {
                        selectedPatientSections(detail)
                    } else {
                        credentialsCard
                        patientsCard
                    }
                    #else
                    credentialsCard
                    patientsCard
                    #endif
                }
                .padding(20)
            }
        }
    }

    #if DEBUG
    // Screenshot/UI-test affordance: render only the open patient's clinical
    // sections (skip the pairing card) so the detail view can be captured from
    // the top without scrolling. Debug-only, never compiled into release.
    private var focusedDetailOnly: Bool {
        ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_FOCUS_DETAIL"] == "1"
    }
    #endif

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
        Button {
            model.startCreatingPatient()
        } label: {
            Label("Nuovo paziente", systemImage: "person.badge.plus")
        }
        .font(.caption)
        .disabled(model.isWorking)
        .accessibilityIdentifier("new-patient-button")
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
                Text(patientViewMode == .trash ? "Nessun paziente nel cestino." : "Nessun paziente per questi filtri.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("patient-search-empty")
            } else {
                ForEach(results) { patient in
                    if patientViewMode == .trash {
                        HStack(spacing: 8) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Text("\(patient.lastName) \(patient.firstName)")
                                        .font(.subheadline.weight(.semibold))
                                    flagChip("Nel cestino", tone: .attention)
                                }
                                HStack(spacing: 6) {
                                    Text(patient.taxCode)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                    if let deletedAt = patient.deletedAt {
                                        Text("Eliminato il \(Self.birthDateFormatter.string(from: deletedAt))")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                if let reason = cleaned(patient.deletionReason) {
                                    Text("Motivo: \(reason)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            Spacer(minLength: 8)
                            if model.canRestorePatient(patient) {
                                Button {
                                    Task { await model.restorePatient(patient) }
                                } label: {
                                    Label("Ripristina", systemImage: "arrow.uturn.backward.circle")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("restore-patient-button-\(patient.id)")
                            }
                        }
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .accessibilityIdentifier("patient-trash-row-\(patient.id)")
                    } else {
                        Button {
                            Task { await model.loadPatient(patient) }
                        } label: {
                            HStack(spacing: 8) {
                                VStack(alignment: .leading, spacing: 4) {
                                    HStack(spacing: 6) {
                                        Text("\(patient.lastName) \(patient.firstName)")
                                            .font(.subheadline.weight(.semibold))
                                        if patient.isAdi == true { flagChip("ADI", tone: .info) }
                                        if patient.isArchived == true { flagChip("Archiviato", tone: .neutral) }
                                    }
                                    HStack(spacing: 6) {
                                        Text(patient.taxCode)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                        if let age = Self.age(from: patient.birthDate) {
                                            Text("· \(age) anni")
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                                .accessibilityIdentifier("patient-cell-age-\(patient.id)")
                                        }
                                    }
                                }
                                Spacer(minLength: 8)
                                VStack(alignment: .trailing, spacing: 4) {
                                    if let updated = patient.updatedAt {
                                        Text(Self.relativeUpdated(updated))
                                            .font(.caption2)
                                            .foregroundStyle(.tertiary)
                                            .accessibilityIdentifier("patient-cell-updated-\(patient.id)")
                                    }
                                    if model.selectedPatient?.id == patient.id {
                                        Image(systemName: "chevron.right")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(.tint)
                                    }
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
        EntryFiltering.apply(model.entries, filter: entryTypeFilter, includeDeleted: showsDeletedDiaryEntries)
    }

    private var createPatientForm: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Nome", text: $model.newPatientFirstName)
                        .accessibilityIdentifier("new-patient-first-name")
                    TextField("Cognome", text: $model.newPatientLastName)
                        .accessibilityIdentifier("new-patient-last-name")
                    TextField("Codice fiscale", text: $model.newPatientTaxCode)
                        .accessibilityIdentifier("new-patient-tax-code")
                }
                Section {
                    Toggle("Data di nascita", isOn: $model.newPatientHasBirthDate)
                        .accessibilityIdentifier("new-patient-has-birth-date")
                    if model.newPatientHasBirthDate {
                        DatePicker("Nascita", selection: $model.newPatientBirthDate, displayedComponents: .date)
                            .accessibilityIdentifier("new-patient-birth-date")
                    }
                    TextField("Indirizzo (opzionale)", text: $model.newPatientAddress)
                        .accessibilityIdentifier("new-patient-address")
                    TextField("Telefono (opzionale)", text: $model.newPatientPhone)
                        .accessibilityIdentifier("new-patient-phone")
                    TextField("Caregiver (opzionale)", text: $model.newPatientCaregiver)
                        .accessibilityIdentifier("new-patient-caregiver")
                }
                Text("Crea in locale quando l'autorità on-device è attiva, oppure tramite l'home-base collegato se il permesso è concesso. Richiede il PIN operatore per cifrare i campi.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .navigationTitle("Nuovo paziente")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Annulla") { model.cancelCreatingPatient() }
                        .accessibilityIdentifier("cancel-new-patient-button")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Crea") { Task { await model.createPatient() } }
                        .disabled(!model.canCreatePatient)
                        .accessibilityIdentifier("create-patient-button")
                }
            }
        }
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
                    Text("Cestino").tag(PatientListViewMode.trash)
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
            scalesSection
            therapiesSection
            checkupsSection
            observationsSection
            servicePrescriptionsSection
            prostheticPrescriptionsSection
            documentsSection
            documentInsightsSection
            followupSuggestionsSection
            fseDocumentValidationSection
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
                if detail.isArchived == true {
                    Button {
                        patientLifecycleSheet = .unarchive
                    } label: {
                        Label("Riattiva", systemImage: "archivebox")
                    }
                    .font(.caption)
                    .disabled(!model.canUnarchivePatient)
                    .accessibilityIdentifier("unarchive-patient-button")
                } else {
                    Button {
                        patientLifecycleSheet = .archive
                    } label: {
                        Label("Archivia", systemImage: "archivebox")
                    }
                    .font(.caption)
                    .disabled(!model.canArchivePatient)
                    .accessibilityIdentifier("archive-patient-button")
                }
                Button(role: .destructive) {
                    patientLifecycleSheet = .delete
                } label: {
                    Label("Elimina", systemImage: "trash")
                }
                .font(.caption)
                .disabled(!model.canSoftDeletePatient)
                .accessibilityIdentifier("soft-delete-patient-button")
                Button {
                    confirmsFHIRExport = true
                } label: {
                    Label("Esporta FHIR", systemImage: "doc.badge.arrow.up")
                }
                .font(.caption)
                .disabled(!model.canPrepareFHIRExport)
                .accessibilityIdentifier("patient-export-fhir-button")
                if let fhirURL = model.patientFHIRExportURL {
                    ShareLink(item: fhirURL) {
                        Label("Condividi FHIR", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("patient-share-fhir-button")
                }
                Button {
                    Task { await model.openPrregHandoff() }
                } label: {
                    Label("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
                }
                .font(.caption)
                .accessibilityIdentifier("patient-prreg-handoff-button")
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
            patientSignals(detail, exemptionsCount: exemptions.count)
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
            let diagnoses = DiagnosesCodec.decode(detail.diagnoses)
            if !diagnoses.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Diagnosi")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(Array(diagnoses.enumerated()), id: \.offset) { _, diagnosis in
                        Text(diagnosis.displayText)
                            .font(.callout)
                    }
                }
                .accessibilityIdentifier("patient-detail-diagnoses")
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
            Toggle("ADI (assistenza domiciliare)", isOn: $model.editPatientIsAdi)
                .accessibilityIdentifier("edit-patient-adi")

            VStack(alignment: .leading, spacing: 4) {
                Text("Diagnosi")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(Array(model.editPatientDiagnoses.enumerated()), id: \.offset) { index, diagnosis in
                    HStack {
                        Text(diagnosis.displayText)
                            .font(.callout)
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeDiagnosis(at: IndexSet(integer: index))
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-diagnosis-\(index)")
                    }
                }
                // A14: in-app ICD search (ADR 0070), no external proxy. Tapping a
                // result adds the coded diagnosis with its system.
                TextField("Cerca ICD (in-app)", text: $icdQuery)
                    .accessibilityIdentifier("icd-search-field")
                if !icdQuery.isEmpty {
                    ForEach(ICDCatalog.search(icdQuery, limit: 6)) { icd in
                        Button {
                            model.addDiagnosis(code: icd.code, description: icd.description, system: icd.system)
                            icdQuery = ""
                        } label: {
                            HStack(alignment: .firstTextBaseline) {
                                Text("\(icd.code)  \(icd.description)")
                                    .font(.caption)
                                    .multilineTextAlignment(.leading)
                                Spacer(minLength: 4)
                                Image(systemName: "plus.circle")
                            }
                        }
                        .accessibilityIdentifier("icd-result-\(icd.code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice", text: $model.newDiagnosisCode)
                        .accessibilityIdentifier("new-diagnosis-code")
                        .frame(maxWidth: 120)
                    TextField("Descrizione", text: $model.newDiagnosisDescription)
                        .accessibilityIdentifier("new-diagnosis-description")
                    Button {
                        model.addDiagnosis()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-diagnosis-button")
                }
            }

            VStack(alignment: .leading, spacing: 4) {
                Text("Esenzioni")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if model.editPatientExemptions.isEmpty {
                    Text("Nessuna esenzione")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                ForEach(model.editPatientExemptions, id: \.self) { code in
                    HStack {
                        Text(code)
                            .font(.callout)
                        Spacer(minLength: 8)
                        Button(role: .destructive) {
                            model.removeExemption(code)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .accessibilityIdentifier("remove-exemption-\(code)")
                    }
                }
                HStack(spacing: 6) {
                    TextField("Codice esenzione", text: $model.newExemptionCode)
                        .accessibilityIdentifier("new-exemption-code")
                        .frame(maxWidth: 160)
                        .onChange(of: model.newExemptionCode) { _ in
                            model.scheduleExemptionCatalogSearch()
                        }
                    Button {
                        model.addExemption()
                    } label: {
                        Image(systemName: "plus.circle")
                    }
                    .accessibilityIdentifier("add-exemption-button")
                }
                exemptionCatalogResultsList
            }

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

    /* @Codex */
    @ViewBuilder
    private var exemptionCatalogResultsList: some View {
        if model.isSearchingExemptionCatalog
            || model.exemptionCatalogStatusMessage != nil
            || !model.exemptionCatalogResults.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if model.isSearchingExemptionCatalog {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca catalogo esenzioni")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let status = model.exemptionCatalogStatusMessage {
                    Text(status)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(model.exemptionCatalogResults) { exemption in
                    Button {
                        model.selectExemptionCatalogResult(exemption)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(exemption.code)
                                .font(.caption.monospaced().weight(.semibold))
                            Text(exemption.description)
                                .font(.caption)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            Image(systemName: "plus.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("exemption-catalog-result-\(exemption.code)")
                }
            }
        }
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

    // Clinical lists are fetched capped by the paired boundary, so a count that
    // hits the cap is a floor, shown as "N+".
    static let clinicalPreviewCap = HomeBaseClinicalListLimit.boundaryMaximum

    private func signalTile(_ icon: String, _ signal: ClinicalSignalCount, _ label: String) -> some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                Image(systemName: icon)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(signal.displayText)
                    .font(.callout.weight(.semibold))
                    .monospacedDigit()
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
    }

    // Quadro clinical-signals strip (parity with the web "segnali clinici"): counts
    // derived from the already-loaded collections + the next upcoming follow-up.
    @ViewBuilder
    private func patientSignals(_ detail: HomeBasePatientDetail, exemptionsCount: Int) -> some View {
        let cap = Self.clinicalPreviewCap
        let problemi = DiagnosesCodec.decode(detail.diagnoses).count
        let terapie = model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }.count
        let parametri = model.observations.filter { $0.deletedAt == nil }.count
        let diario = model.entries.filter { $0.deletedAt == nil }.count
        let scale = model.entries.filter { $0.deletedAt == nil && $0.type == "scale" }.count
        let nextCheckup = model.checkups
            .filter { $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() }
            .min(by: { $0.date < $1.date })
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                signalTile("cross.case", .exact(problemi), "Problemi")
                signalTile(
                    "pills",
                    .fromLoadedList(count: terapie, loadedCount: model.therapies.count, limit: cap),
                    "Terapie"
                )
                signalTile(
                    "waveform.path.ecg",
                    .fromLoadedList(count: parametri, loadedCount: model.observations.count, limit: cap),
                    "Parametri"
                )
                signalTile(
                    "list.bullet.clipboard",
                    .fromLoadedList(count: diario, loadedCount: model.entries.count, limit: cap),
                    "Diario"
                )
                signalTile(
                    "checklist",
                    .fromLoadedList(count: scale, loadedCount: model.entries.count, limit: cap),
                    "Scale"
                )
                signalTile("seal", .exact(exemptionsCount), "Esenzioni")
            }
            .accessibilityIdentifier("patient-clinical-signals")
            if let next = nextCheckup {
                HStack(spacing: 6) {
                    Image(systemName: "calendar.badge.clock")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    Text("Prossimo follow-up: \(Self.birthDateFormatter.string(from: next.date)) · \(next.title)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .accessibilityIdentifier("patient-next-followup")
            }
        }
    }

    private static let birthDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter
    }()

    // Age in whole years from a birth date; nil when absent or implausible.
    static func age(from birthDate: Date?) -> Int? {
        guard let birthDate else { return nil }
        let years = Calendar.current.dateComponents([.year], from: birthDate, to: Date()).year
        guard let years, years >= 0, years < 140 else { return nil }
        return years
    }

    private static let relativeUpdatedFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.unitsStyle = .short
        return formatter
    }()

    // Relative "aggiornato" label (e.g. "2 h fa", "ieri") in Italian.
    static func relativeUpdated(_ date: Date) -> String {
        relativeUpdatedFormatter.localizedString(for: date, relativeTo: Date())
    }

    private var diarySection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Diario clinico", systemImage: "list.bullet.clipboard")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime \(Self.clinicalPreviewCap) voci")
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
                    ForEach(ClinicalScales.all) { scale in
                        Button {
                            presentingScale = scale
                        } label: {
                            Text("\(scale.title) (\(scale.questions.count) domande)")
                        }
                        .accessibilityIdentifier("new-scale-option-\(scale.id)")
                    }
                } label: {
                    Label("Valutazione", systemImage: "checklist")
                        .font(.caption)
                }
                .disabled(model.selectedPatient == nil)
                .accessibilityIdentifier("new-scale-button")

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

                Toggle("Mostra eliminate", isOn: $showsDeletedDiaryEntries)
                    .font(.caption)
                    .disabled(model.entries.allSatisfy { $0.deletedAt == nil })
                    .accessibilityIdentifier("show-deleted-entries-toggle")
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
                                .strikethrough(entry.deletedAt != nil, color: .secondary)
                            if let type = PairedDiaryEntryType(rawValue: entry.type) {
                                flagChip(type.title, tone: .info)
                            }
                            if entry.deletedAt != nil {
                                flagChip("Eliminata", tone: .attention)
                            }
                            Spacer(minLength: 8)
                            Text(Self.entryDateFormatter.string(from: entry.date))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Text(ClinicalContentRendering.attributedString(from: entry.content))
                            .font(.caption)
                            .foregroundStyle(entry.deletedAt == nil ? .primary : .secondary)
                            .lineLimit(4)
                        // S7 (D4): resolves the entry's referenced attachment ids
                        // against the loaded patient attachment list (S6), same
                        // pairing as the web timeline-entry-card. An id that does
                        // not resolve (Documenti section not loaded yet, or the
                        // attachment is gone) is simply omitted, never shown raw.
                        let entryAttachments = model.referencedAttachments(for: entry)
                        if !entryAttachments.isEmpty {
                            HStack(spacing: 6) {
                                Image(systemName: "paperclip")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                ForEach(entryAttachments) { attachment in
                                    Text("\(attachment.name.isEmpty ? "Documento" : attachment.name) (\(attachment.type))")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                            }
                            .accessibilityIdentifier("entry-row-attachments-\(entry.id)")
                        }
                        if let deletedAt = entry.deletedAt {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Eliminata il \(Self.entryDateFormatter.string(from: deletedAt))")
                                    .font(.caption2.weight(.semibold))
                                    .foregroundStyle(.orange)
                                if let reason = entry.deletionReason?.trimmedOrNil {
                                    Text("Motivo: \(reason)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            if model.canRestoreEntry(entry) {
                                Button {
                                    Task { await model.restoreEntry(id: entry.id) }
                                } label: {
                                    Label("Ripristina", systemImage: "arrow.uturn.backward.circle")
                                }
                                .font(.caption)
                                .accessibilityIdentifier("homebase-restore-entry-button-\(entry.id)")
                            }
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
                                    entryDeletionCandidate = entry
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
                    ClinicalRichTextEditorView(
                        document: $model.editEntryEditorDocument,
                        accessibilityPrefix: "homebase-edit-entry-content"
                    )
                    .accessibilityIdentifier("homebase-edit-entry-content-field")
                    if capabilities.hasCapability("network.replica.readonly-documents") {
                        EntryAttachmentReferencePicker(
                            attachments: model.attachments,
                            selectedIds: $model.editEntryAttachmentIds,
                            accessibilityPrefix: "homebase-edit-entry-attachments"
                        )
                    }
                    HStack(spacing: 8) {
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
                Button {
                    if model.newEntryEditorDocument.isEffectivelyEmpty {
                        model.insertNewEntrySOAPTemplate()
                    } else {
                        confirmsReplacingEntryTemplate = true
                    }
                } label: {
                    Label("Template S/O/A/P", systemImage: "doc.text")
                }
                .font(.caption)
                .disabled(model.isWorking)
                .accessibilityIdentifier("homebase-new-entry-soap-template-button")
                ClinicalRichTextEditorView(
                    document: $model.newEntryEditorDocument,
                    accessibilityPrefix: "homebase-new-entry-content"
                )
                .accessibilityIdentifier("homebase-new-entry-content-field")
                if capabilities.hasCapability("network.replica.readonly-documents") {
                    Divider()
                    EntryAttachmentReferencePicker(
                        attachments: model.attachments,
                        selectedIds: $model.newEntryAttachmentIds,
                        accessibilityPrefix: "homebase-new-entry-attachments"
                    )
                }
                if capabilities.hasCapability("network.compute.visit-draft") {
                    Divider()
                    VisitDraftComposerView(model: model)
                } else if let message = capabilities.unavailableMessage(for: "network.compute.visit-draft") {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
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
        // S7 (D4): loads the patient's attachment list so the reference picker
        // and the entry rows' resolved attachment chips have names to show,
        // even if the operator never opens the separate Documenti section.
        .task(id: model.selectedPatient?.id) {
            guard capabilities.hasCapability("network.replica.readonly-documents") else { return }
            await model.loadSelectedPatientAttachments()
        }
    }

    /* @Codex */
    private var scalesSection: some View {
        PairedScalesSection(
            entries: model.entries,
            isWorking: model.isWorking,
            hasSelectedPatient: model.selectedPatient != nil,
            onRefresh: {
                Task { await model.loadSelectedPatientEntries() }
            },
            onStartScale: { scale in
                presentingScale = scale
            }
        )
    }

    /* @Codex */
    private var therapiesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Terapie", systemImage: "pills")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime \(Self.clinicalPreviewCap) terapie")
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

                Button {
                    model.generatePatientReportPDF()
                } label: {
                    Label("Report PDF", systemImage: "doc.richtext")
                        .font(.caption)
                }
                .disabled(model.selectedPatient == nil)
                .accessibilityIdentifier("patient-report-pdf-button")

                if let reportURL = model.patientReportURL {
                    ShareLink(item: reportURL) {
                        Label("Condividi", systemImage: "square.and.arrow.up")
                            .font(.caption)
                    }
                    .accessibilityIdentifier("share-patient-report-pdf-button")
                }

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
                    aic: $model.editTherapyAIC,
                    atc: $model.editTherapyATC,
                    activePrinciple: $model.editTherapyActivePrinciple,
                    dosage: $model.editTherapyDosage,
                    motivation: $model.editTherapyMotivation,
                    status: $model.editTherapyStatus,
                    startDate: $model.editTherapyStartDate,
                    hasEndDate: $model.editTherapyHasEndDate,
                    endDate: $model.editTherapyEndDate,
                    diagnosisCode: $model.editTherapyDiagnosisCode,
                    diagnosisOptions: model.currentPatientDiagnoses,
                    drugCatalogResults: model.editTherapyDrugCatalogResults,
                    isSearchingDrugCatalog: model.isSearchingEditTherapyDrugCatalog,
                    drugCatalogStatusMessage: model.drugCatalogStatusMessage,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-therapy-button",
                    canSubmit: model.canUpdateEditingTherapy,
                    onDrugQueryChanged: { model.scheduleEditTherapyDrugCatalogSearch() },
                    onSelectDrug: { model.selectEditTherapyDrugCatalogResult($0) },
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
                aic: $model.newTherapyAIC,
                atc: $model.newTherapyATC,
                activePrinciple: $model.newTherapyActivePrinciple,
                dosage: $model.newTherapyDosage,
                motivation: $model.newTherapyMotivation,
                status: $model.newTherapyStatus,
                startDate: $model.newTherapyStartDate,
                hasEndDate: $model.newTherapyHasEndDate,
                endDate: $model.newTherapyEndDate,
                diagnosisCode: $model.newTherapyDiagnosisCode,
                diagnosisOptions: model.currentPatientDiagnoses,
                drugCatalogResults: model.newTherapyDrugCatalogResults,
                isSearchingDrugCatalog: model.isSearchingNewTherapyDrugCatalog,
                drugCatalogStatusMessage: model.drugCatalogStatusMessage,
                primaryLabel: "Salva terapia",
                primaryIdentifier: "homebase-create-therapy-button",
                canSubmit: model.canCreateTherapy,
                onDrugQueryChanged: { model.scheduleNewTherapyDrugCatalogSearch() },
                onSelectDrug: { model.selectNewTherapyDrugCatalogResult($0) },
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
            if therapy.aic?.trimmedOrNil != nil || therapy.atc?.trimmedOrNil != nil {
                HStack(spacing: 6) {
                    if let aic = therapy.aic?.trimmedOrNil {
                        Text("AIC \(aic)")
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                    if let atc = therapy.atc?.trimmedOrNil {
                        Text("ATC \(atc)")
                            .font(.caption2.monospaced().weight(.semibold))
                            .foregroundStyle(.secondary)
                    }
                }
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
        aic: Binding<String>,
        atc: Binding<String>,
        activePrinciple: Binding<String>,
        dosage: Binding<String>,
        motivation: Binding<String>,
        status: Binding<PairedTherapyStatus>,
        startDate: Binding<Date>,
        hasEndDate: Binding<Bool>,
        endDate: Binding<Date>,
        diagnosisCode: Binding<String>,
        diagnosisOptions: [ClinicalDiagnosis],
        drugCatalogResults: [HomeBaseDrugSummary],
        isSearchingDrugCatalog: Bool,
        drugCatalogStatusMessage: String?,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onDrugQueryChanged: @escaping () -> Void,
        onSelectDrug: @escaping (HomeBaseDrugSummary) -> Void,
        onCancel: (() -> Void)?,
        onSubmit: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: "pills")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Farmaco", text: drugName)
                .accessibilityIdentifier("\(primaryIdentifier)-drug-name")
                .onChange(of: drugName.wrappedValue) { _ in
                    onDrugQueryChanged()
                }
            drugCatalogResultsList(
                results: drugCatalogResults,
                isLoading: isSearchingDrugCatalog,
                statusMessage: drugCatalogStatusMessage,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectDrug
            )
            TextField("Codice AIC (opzionale)", text: aic)
                .autocorrectionDisabled()
                .accessibilityIdentifier("\(primaryIdentifier)-aic")
            TextField("Codice ATC (opzionale)", text: atc)
                .autocorrectionDisabled()
                .accessibilityIdentifier("\(primaryIdentifier)-atc")
            TextField("Principio attivo (opzionale)", text: activePrinciple)
                .accessibilityIdentifier("\(primaryIdentifier)-active-principle")
            TextField("Posologia", text: dosage)
                .accessibilityIdentifier("\(primaryIdentifier)-dosage")
            TextField("Motivazione (opzionale)", text: motivation)
                .accessibilityIdentifier("\(primaryIdentifier)-motivation")
            if !diagnosisOptions.isEmpty {
                Picker("Diagnosi collegata", selection: diagnosisCode) {
                    Text("Nessuna").tag("")
                    ForEach(diagnosisOptions, id: \.code) { diagnosis in
                        Text(diagnosis.displayText).tag(diagnosis.code)
                    }
                }
                .pickerStyle(.menu)
                .accessibilityIdentifier("\(primaryIdentifier)-diagnosis")
            }
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
    @ViewBuilder
    private func drugCatalogResultsList(
        results: [HomeBaseDrugSummary],
        isLoading: Bool,
        statusMessage: String?,
        primaryIdentifier: String,
        onSelect: @escaping (HomeBaseDrugSummary) -> Void
    ) -> some View {
        if isLoading || statusMessage != nil || !results.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if isLoading {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca catalogo AIFA")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let statusMessage {
                    Text(statusMessage)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                ForEach(results) { drug in
                    Button {
                        onSelect(drug)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(drug.name)
                                    .font(.caption.weight(.semibold))
                                    .lineLimit(2)
                                if let principle = drug.activePrinciple?.trimmedOrNil {
                                    Text(principle)
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                HStack(spacing: 6) {
                                    Text("AIC \(drug.aic)")
                                    if let atc = drug.atc?.trimmedOrNil {
                                        Text("ATC \(atc)")
                                    }
                                }
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 4)
                            Image(systemName: "checkmark.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(primaryIdentifier)-drug-catalog-result-\(drug.aic)")
                }
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
                subtitle: "Ultime \(Self.clinicalPreviewCap) osservazioni",
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
                    codeResults: model.editObservationCodeTerminologyResults,
                    unitResults: model.editObservationUnitTerminologyResults,
                    isSearchingCode: model.isSearchingEditObservationCodeTerminology,
                    isSearchingUnit: model.isSearchingEditObservationUnitTerminology,
                    primaryLabel: "Salva modifiche",
                    primaryIdentifier: "homebase-update-observation-button",
                    canSubmit: model.canUpdateEditingObservation,
                    onCodeQueryChanged: { model.scheduleEditObservationCodeTerminologySearch() },
                    onUnitQueryChanged: { model.scheduleEditObservationUnitTerminologySearch() },
                    onSelectCode: { model.selectEditObservationCodeTerminology($0) },
                    onSelectUnit: { model.selectEditObservationUnitTerminology($0) },
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
                codeResults: model.newObservationCodeTerminologyResults,
                unitResults: model.newObservationUnitTerminologyResults,
                isSearchingCode: model.isSearchingNewObservationCodeTerminology,
                isSearchingUnit: model.isSearchingNewObservationUnitTerminology,
                primaryLabel: "Salva osservazione",
                primaryIdentifier: "homebase-create-observation-button",
                canSubmit: model.canCreateObservation,
                onCodeQueryChanged: { model.scheduleNewObservationCodeTerminologySearch() },
                onUnitQueryChanged: { model.scheduleNewObservationUnitTerminologySearch() },
                onSelectCode: { model.selectNewObservationCodeTerminology($0) },
                onSelectUnit: { model.selectNewObservationUnitTerminology($0) },
                onCancel: nil,
                onSubmit: { Task { await model.createObservationForSelectedPatient() } }
            )
            Text("LOINC + UCUM manuali. Nessun AI plane remoto, OCR o coda offline.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var servicePrescriptionsSection: some View {
        let counters = ServicePrescriptionFiltering.counters(
            prescriptions: model.servicePrescriptions,
            items: model.servicePrescriptionItems
        )
        return VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Prestazioni",
                subtitle: "Prescrizioni ordinate per data",
                systemImage: "cross.case",
                refreshIdentifier: "homebase-refresh-services-button"
            ) {
                Task { await model.loadSelectedPatientServicePrescriptions() }
            }
            counterStrip([
                ("Totale", counters.total),
                ("Voci", counters.items),
                ("Aperte", counters.open),
                ("Referti", counters.reports),
            ], identifier: "service-prescription-counters")

            if model.servicePrescriptions.isEmpty {
                Text("Nessuna prestazione registrata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.servicePrescriptions) { prescription in
                    servicePrescriptionRow(prescription)
                        .accessibilityIdentifier("service-prescription-row-\(prescription.id)")
                }
            }

            Divider()
            servicePrescriptionForm
            Text("Creazione unica. Dopo il salvataggio la modifica testuale resta sul web; dal client nativo sono disponibili solo le transizioni di stato previste.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    /* @Codex */
    private var prostheticPrescriptionsSection: some View {
        let counters = ProstheticPrescriptionFiltering.counters(model.prostheticPrescriptions)
        return VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Protesica",
                subtitle: "Prescrizioni e collaudi",
                systemImage: "figure.walk.motion",
                refreshIdentifier: "homebase-refresh-prosthetics-button"
            ) {
                Task { await model.loadSelectedPatientProstheticPrescriptions() }
            }
            counterStrip([
                ("Totale", counters.total),
                ("Collaudi", counters.tests),
            ], identifier: "prosthetic-prescription-counters")

            if model.prostheticPrescriptions.isEmpty {
                Text("Nessuna prescrizione protesica.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(model.prostheticPrescriptions) { prescription in
                    prostheticPrescriptionRow(prescription)
                        .accessibilityIdentifier("prosthetic-prescription-row-\(prescription.id)")
                }
            }

            Divider()
            prostheticPrescriptionForm
            Text("Creazione manuale completa. Nessun edit post-create e nessun hard delete dal client nativo.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    // MARK: - S6 (Wave 5): documenti, archivio intelligente, follow-up, FSE

    /* @Codex */
    private var documentsSection: some View {
        Group {
            if capabilities.hasCapability("network.replica.readonly-documents") {
                documentsContent
            } else {
                ClinicalCapabilityGateView(store: capabilities, capability: "network.replica.readonly-documents")
            }
        }
    }

    private var documentsContent: some View {
        VStack(alignment: .leading, spacing: 10) {
            pairedSectionHeader(
                title: "Documenti",
                subtitle: "Archivio allegati del paziente",
                systemImage: "doc.text",
                refreshIdentifier: "homebase-refresh-attachments-button"
            ) {
                Task { await model.loadSelectedPatientAttachments() }
            }

            if model.attachments.isEmpty {
                Text("Nessun documento caricato per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("documents-empty-state")
            } else {
                ForEach(model.attachments) { attachment in
                    attachmentRow(attachment)
                        .accessibilityIdentifier("attachment-row-\(attachment.id)")
                }
            }

            Divider()

            if capabilities.hasCapability("network.replica.write-documents") {
                attachmentUploadControls
            } else if let message = capabilities.unavailableMessage(for: "network.replica.write-documents") {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }

            if let pickerError = attachmentPickerError {
                Text(pickerError)
                    .font(.caption2)
                    .foregroundStyle(.red)
            }
        }
        .task(id: model.selectedPatient?.id) {
            guard capabilities.hasCapability("network.replica.readonly-documents") else { return }
            await model.loadSelectedPatientAttachments()
        }
        .fileImporter(isPresented: $isPickingAttachmentFile, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            handlePickedAttachmentFile(result)
        }
        .onChange(of: pickedPhotoItem) { newItem in
            guard let newItem, let patientId = model.selectedPatient?.id else { return }
            Task { await handlePickedAttachmentPhoto(newItem, patientId: patientId) }
        }
        .sheet(item: $attachmentDetailCandidate, onDismiss: { model.dismissAttachmentDetail() }) { summary in
            attachmentDetailSheet(summary)
        }
    }

    private var attachmentUploadControls: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Carica documento")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 10) {
                Button {
                    isPickingAttachmentFile = true
                } label: {
                    Label("Scegli file", systemImage: "folder")
                }
                .font(.caption)
                .disabled(!model.canUploadAttachment)
                .accessibilityIdentifier("attachment-upload-file-button")

                PhotosPicker(selection: $pickedPhotoItem, matching: .images) {
                    Label("Scegli foto", systemImage: "photo")
                }
                .font(.caption)
                .disabled(!model.canUploadAttachment)
                .accessibilityIdentifier("attachment-upload-photo-button")
            }
            Text("Solo caricamento manuale. OCR e sintesi restano sull'home-base: il documento entra in coda in attesa.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Disponibile solo online: se il Mac non risponde, il documento non viene accodato.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func handlePickedAttachmentFile(_ result: Result<[URL], Error>) {
        attachmentPickerError = nil
        switch result {
        case .failure(let error):
            attachmentPickerError = "Selezione del file non riuscita: \(error.localizedDescription)"
        case .success(let urls):
            guard let url = urls.first, let patientId = model.selectedPatient?.id else { return }
            let accessedScopedResource = url.startAccessingSecurityScopedResource()
            defer { if accessedScopedResource { url.stopAccessingSecurityScopedResource() } }
            do {
                let rawData = try Data(contentsOf: url)
                let mimeType = Self.mimeType(forPathExtension: url.pathExtension)
                let fileName = url.lastPathComponent
                Task {
                    await model.uploadAttachmentForSelectedPatient(
                        patientId: patientId,
                        fileName: fileName,
                        mimeType: mimeType,
                        rawData: rawData
                    )
                }
            } catch {
                attachmentPickerError = "Lettura del file non riuscita: \(error.localizedDescription)"
            }
        }
    }

    private func handlePickedAttachmentPhoto(_ item: PhotosPickerItem, patientId: String) async {
        defer { pickedPhotoItem = nil }
        do {
            guard let rawData = try await item.loadTransferable(type: Data.self) else {
                attachmentPickerError = "Lettura della foto non riuscita."
                return
            }
            attachmentPickerError = nil
            let contentType = item.supportedContentTypes.first
            let mimeType = contentType?.preferredMIMEType ?? "image/jpeg"
            let fileExtension = contentType?.preferredFilenameExtension ?? "jpg"
            let fileName = "foto-\(Int(Date().timeIntervalSince1970)).\(fileExtension)"
            await model.uploadAttachmentForSelectedPatient(
                patientId: patientId,
                fileName: fileName,
                mimeType: mimeType,
                rawData: rawData
            )
        } catch {
            attachmentPickerError = "Lettura della foto non riuscita: \(error.localizedDescription)"
        }
    }

    private static func mimeType(forPathExtension pathExtension: String) -> String {
        UTType(filenameExtension: pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func attachmentRow(_ attachment: HomeBaseAttachmentSummary) -> some View {
        Button {
            attachmentDetailCandidate = attachment
            Task { await model.openAttachmentDetail(attachment) }
        } label: {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline) {
                    Text(attachment.name.isEmpty ? "Documento senza nome" : attachment.name)
                        .font(.caption.weight(.semibold))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(Self.byteCountFormatter.string(fromByteCount: Int64(attachment.size)))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                HStack(spacing: 6) {
                    Text(attachment.type)
                    if let createdAt = attachment.createdAt {
                        Text(Self.entryDateFormatter.string(from: createdAt))
                    }
                    if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: attachment.ocrQueueState, reason: attachment.ocrQueueReason) {
                        Text(queueLabel)
                            .foregroundStyle(.orange)
                    }
                }
                .font(.caption2)
                .foregroundStyle(.secondary)
            }
        }
        .buttonStyle(.plain)
    }

    private func attachmentDetailSheet(_ summary: HomeBaseAttachmentSummary) -> some View {
        NavigationStack {
            Group {
                if let detail = model.selectedAttachmentDetail, detail.id == summary.id {
                    ScrollView {
                        VStack(alignment: .leading, spacing: 12) {
                            PairedAttachmentPreviewView(detail: detail)
                            VStack(alignment: .leading, spacing: 4) {
                                InfoRow("Nome", detail.name)
                                InfoRow("Tipo", detail.type)
                                InfoRow("Dimensione", Self.byteCountFormatter.string(fromByteCount: Int64(detail.size)))
                                if let createdAt = detail.createdAt {
                                    InfoRow("Caricato il", Self.entryDateFormatter.string(from: createdAt))
                                }
                                if let queueLabel = HomeBaseDocumentOcrQueuePresentation.describe(state: detail.ocrQueueState, reason: detail.ocrQueueReason) {
                                    InfoRow("Stato coda OCR", queueLabel)
                                }
                                if let summarySnapshot = cleaned(detail.summarySnapshot) {
                                    InfoRow("Sintesi", summarySnapshot)
                                }
                            }
                            if let shareURL = model.attachmentShareURL {
                                ShareLink(item: shareURL) {
                                    Label("Condividi", systemImage: "square.and.arrow.up")
                                }
                                .accessibilityIdentifier("attachment-share-link")
                            } else {
                                Button {
                                    model.prepareAttachmentShareFile()
                                } label: {
                                    Label("Prepara condivisione", systemImage: "square.and.arrow.up")
                                }
                                .accessibilityIdentifier("attachment-prepare-share-button")
                            }
                        }
                        .padding(20)
                    }
                } else if model.isWorking {
                    ProgressView("Caricamento documento...")
                        .padding(20)
                } else {
                    Text("Documento non disponibile.")
                        .foregroundStyle(.secondary)
                        .padding(20)
                }
            }
            .navigationTitle(summary.name.isEmpty ? "Documento" : summary.name)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Chiudi") { attachmentDetailCandidate = nil }
                }
            }
        }
    }

    /* @Codex */
    private var documentInsightsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Archivio Intelligente", systemImage: "text.magnifyingglass")
                .font(.subheadline.weight(.semibold))
            if model.documentInsights.isEmpty {
                Text("Nessun documento analizzato per questo paziente.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("document-insights-empty-state")
            } else {
                Text("Ultimi \(model.documentInsights.count) documenti analizzati")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                ForEach(model.documentInsights) { insight in
                    documentInsightRow(insight)
                        .accessibilityIdentifier("document-insight-row-\(insight.id)")
                }
            }

            if !model.evidenceStackInsights.isEmpty {
                Divider()
                Text("Referti recenti")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                ForEach(model.evidenceStackInsights) { insight in
                    evidenceStackTile(insight)
                        .accessibilityIdentifier("evidence-stack-tile-\(insight.id)")
                }
            }

            Text("Sintesi generata da IA locale sull'host. Verificare sempre. Nessuna azione di scrittura disponibile da qui: curation e cancellazione restano sul web.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func documentInsightRow(_ insight: ClinicalDocumentInsight) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                expandedInsightId = expandedInsightId == insight.id ? nil : insight.id
            } label: {
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(insight.fileName)
                            .font(.caption.weight(.semibold))
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            if let dateLabel = Self.insightDateLabel(insight) {
                                Text(dateLabel)
                            }
                            if let quality = insight.qualityLevel {
                                Text(Self.documentQualityLabel(quality))
                            }
                        }
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: expandedInsightId == insight.id ? "chevron.up" : "chevron.down")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if expandedInsightId == insight.id {
                VStack(alignment: .leading, spacing: 4) {
                    if !insight.extractedDiagnoses.isEmpty {
                        Text(insight.extractedDiagnoses
                            .map { "\($0.system.map { s in "\(s) " } ?? "")\($0.code) - \($0.description)" }
                            .joined(separator: " \u{00B7} "))
                            .font(.caption2)
                    }
                    if !insight.extractedMedications.isEmpty {
                        Text("Terapie: \(insight.extractedMedications.joined(separator: ", "))")
                            .font(.caption2)
                    }
                    if let reason = insight.qualityReason {
                        Text("Qualita documento: \(reason)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if !insight.appliedDiagnoses.isEmpty {
                        Text("Diagnosi aggiunte alla scheda: \(insight.appliedDiagnoses.joined(separator: ", "))")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(.green)
                    }
                    if !insight.summary.isEmpty {
                        Text(insight.summary)
                            .font(.caption)
                    }
                }
                .padding(.leading, 8)
            }
        }
    }

    private func evidenceStackTile(_ insight: ClinicalDocumentInsight) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(insight.fileName)
                    .font(.caption.weight(.semibold))
                    .lineLimit(1)
                Spacer(minLength: 8)
                if let quality = insight.qualityLevel {
                    Text(Self.documentQualityLabel(quality))
                        .font(.caption2.weight(.semibold))
                }
            }
            if let dateLabel = Self.insightDateLabel(insight) {
                Text(dateLabel)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Text(insight.summary.isEmpty ? "Documento acquisito e pronto per revisione contestuale." : insight.summary)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(3)
            HStack(spacing: 8) {
                Text("\(insight.extractedDiagnoses.count) diagnosi")
                Text("\(insight.extractedMedications.count) terapie")
            }
            .font(.caption2)
            .foregroundStyle(.secondary)
        }
        .padding(10)
        .background(PlatformColors.groupedBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    /* @Codex */
    private var followupSuggestionsSection: some View {
        Group {
            if !model.followupSuggestions.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Trovati nei documenti, da valutare")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                    ForEach(model.followupSuggestions) { suggestion in
                        followupSuggestionRow(suggestion)
                            .accessibilityIdentifier("followup-suggestion-row-\(suggestion.id)")
                    }
                }
            }
        }
    }

    private func followupSuggestionRow(_ suggestion: FollowupSuggestion) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(suggestion.label)
                .font(.caption.weight(.semibold))
            if !suggestion.excerpt.isEmpty {
                Text(suggestion.excerpt)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            HStack {
                Text("Trovato in \(suggestion.citation.fileName)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Spacer(minLength: 8)
                Button {
                    model.prefillNewCheckupFromFollowup(suggestion)
                } label: {
                    Label("Crea follow-up", systemImage: "calendar.badge.plus")
                }
                .font(.caption)
                .accessibilityIdentifier("followup-create-checkup-button-\(suggestion.id)")
            }
        }
        .padding(10)
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.secondary.opacity(0.2)))
    }

    /* @Codex */
    private var fseDocumentValidationSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Verifica FSE documento singolo", systemImage: "checkmark.seal")
                .font(.subheadline.weight(.semibold))
            Text("Controlla una terapia o un'osservazione gia caricata contro il profilo FSE corrispondente, prima dell'export completo.")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("Disponibile solo online.")
                .font(.caption2)
                .foregroundStyle(.secondary)

            Picker("Tipo record", selection: $fseValidationKind) {
                ForEach(FseValidationRecordKind.allCases) { kind in
                    Text(kind.title).tag(kind)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("fse-document-validation-kind")
            .onChange(of: fseValidationKind) { _ in model.dismissFseDocumentValidation() }

            switch fseValidationKind {
            case .therapy:
                if model.therapies.isEmpty {
                    Text("Nessuna terapia caricata da verificare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Terapia", selection: $selectedFseTherapyId) {
                        Text("Seleziona...").tag(String?.none)
                        ForEach(model.therapies) { therapy in
                            Text(therapy.drugName).tag(Optional(therapy.id))
                        }
                    }
                    .accessibilityIdentifier("fse-document-validation-therapy-picker")
                    Button("Verifica") {
                        guard let therapy = model.therapies.first(where: { $0.id == selectedFseTherapyId }) else { return }
                        Task { await model.validateFseTherapy(therapy) }
                    }
                    .font(.caption)
                    .disabled(selectedFseTherapyId == nil || model.isWorking || model.connectionState != .pairedOnline)
                    .accessibilityIdentifier("fse-document-validation-run-button")
                }
            case .observation:
                if model.observations.isEmpty {
                    Text("Nessuna osservazione caricata da verificare.")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                } else {
                    Picker("Osservazione", selection: $selectedFseObservationId) {
                        Text("Seleziona...").tag(String?.none)
                        ForEach(model.observations) { observation in
                            Text(observation.display).tag(Optional(observation.id))
                        }
                    }
                    .accessibilityIdentifier("fse-document-validation-observation-picker")
                    Button("Verifica") {
                        guard let observation = model.observations.first(where: { $0.id == selectedFseObservationId }) else { return }
                        Task { await model.validateFseObservation(observation) }
                    }
                    .font(.caption)
                    .disabled(selectedFseObservationId == nil || model.isWorking || model.connectionState != .pairedOnline)
                    .accessibilityIdentifier("fse-document-validation-run-button")
                }
            }

            if let result = model.fseDocumentValidationResult {
                fseDocumentValidationResultView(result)
            }
        }
    }

    private func fseDocumentValidationResultView(_ result: HomeBaseFseDocumentValidationResponse) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: result.ok ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                    .foregroundStyle(result.ok ? .green : .orange)
                Text(model.fseDocumentValidationTargetLabel ?? result.profile)
                    .font(.caption.weight(.semibold))
            }
            if result.errors.isEmpty && result.warnings.isEmpty {
                Text("Nessun errore o avviso per il profilo \(result.profile).")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            } else {
                ForEach(Array(result.errors.enumerated()), id: \.offset) { _, issue in
                    Text("Errore: \(issue.message)")
                        .font(.caption2)
                        .foregroundStyle(.red)
                }
                ForEach(Array(result.warnings.enumerated()), id: \.offset) { _, issue in
                    Text("Avviso: \(issue.message)")
                        .font(.caption2)
                        .foregroundStyle(.orange)
                }
            }
        }
        .accessibilityIdentifier("fse-document-validation-result")
    }

    private static func documentQualityLabel(_ level: String) -> String {
        switch level.lowercased() {
        case "green": return "Buona"
        case "yellow": return "Da verificare"
        case "red": return "Critica"
        default: return level
        }
    }

    private static func insightDateLabel(_ insight: ClinicalDocumentInsight) -> String? {
        let raw = insight.documentDate ?? insight.date
        guard !raw.isEmpty else { return nil }
        guard let parsed = HomeBaseDateCoding.parseISO8601(raw) else { return raw }
        return Self.entryDateFormatter.string(from: parsed)
    }

    private static let byteCountFormatter: ByteCountFormatter = {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        return formatter
    }()

    /* @Codex */
    private func counterStrip(_ values: [(String, Int)], identifier: String) -> some View {
        HStack(spacing: 8) {
            ForEach(values, id: \.0) { label, value in
                VStack(spacing: 2) {
                    Text("\(value)")
                        .font(.caption.weight(.semibold))
                        .monospacedDigit()
                    Text(label)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                .frame(minWidth: 58)
                .padding(.vertical, 6)
                .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
            }
        }
        .accessibilityIdentifier(identifier)
    }

    /* @Codex */
    private func servicePrescriptionRow(_ prescription: HomeBaseServicePrescriptionSummary) -> some View {
        let children = model.servicePrescriptionItems.filter { $0.prescriptionId == prescription.id }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(prescription.serviceName)
                        .font(.caption.weight(.semibold))
                    Text(Self.entryDateFormatter.string(from: prescription.prescribedAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                flagChip(
                    PairedServicePrescriptionStatus.title(for: prescription.status),
                    tone: PairedServicePrescriptionStatus.tone(for: prescription.status)
                )
            }
            HStack(spacing: 6) {
                flagChip(prescription.category, tone: .neutral)
                if let priority = prescription.priority?.trimmedOrNil {
                    flagChip("Priorità \(priority.uppercased())", tone: .info)
                }
                if let code = prescription.serviceCode?.trimmedOrNil {
                    Text(code)
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            if let question = prescription.clinicalQuestion?.trimmedOrNil {
                Text(question)
                    .font(.caption)
                    .lineLimit(2)
            }
            if let provider = prescription.provider?.trimmedOrNil {
                Text("Erogatore: \(provider)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            serviceDatesLine(prescription)
            ForEach(children) { item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(item.ordinal).")
                        .font(.caption2.monospaced())
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(item.serviceName)
                            .font(.caption)
                        if let code = item.serviceCode?.trimmedOrNil {
                            Text(code)
                                .font(.caption2.monospaced())
                                .foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 6)
                    flagChip(Self.serviceMatchLabel(item.matchStatus), tone: .info)
                }
                .accessibilityIdentifier("service-prescription-item-row-\(item.id)")
            }
            LazyVGrid(columns: actionColumns, alignment: .leading, spacing: 8) {
                Button("Prenota") {
                    Task { await model.bookServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canBookServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-book-\(prescription.id)")
                Button("Esegui") {
                    Task { await model.performServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canPerformServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-perform-\(prescription.id)")
                Button("Referto ricevuto") {
                    Task { await model.receiveServicePrescriptionReport(prescription) }
                }
                .font(.caption)
                .disabled(!model.canReceiveReportServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-report-\(prescription.id)")
                Button("Annulla") {
                    Task { await model.cancelServicePrescription(prescription) }
                }
                .font(.caption)
                .disabled(!model.canCancelServicePrescription(prescription))
                .accessibilityIdentifier("service-prescription-cancel-\(prescription.id)")
            }
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private var servicePrescriptionForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Nuova prestazione", systemImage: "cross.case")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Prestazione principale", text: $model.newServiceName)
                .accessibilityIdentifier("new-service-name")
            HStack(spacing: 8) {
                TextField("Sistema codice", text: $model.newServiceCodeSystem)
                    .accessibilityIdentifier("new-service-code-system")
                TextField("Codice", text: $model.newServiceCode)
                    .accessibilityIdentifier("new-service-code")
            }
            Picker("Stato", selection: $model.newServiceStatus) {
                ForEach(PairedServicePrescriptionStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("new-service-status")
            HStack(spacing: 8) {
                Picker("Categoria", selection: $model.newServiceCategory) {
                    ForEach(PairedServicePrescriptionCategory.allCases) { category in
                        Text(category.title).tag(category)
                    }
                }
                .accessibilityIdentifier("new-service-category")
                Picker("Priorità", selection: $model.newServicePriority) {
                    ForEach(PairedServicePrescriptionPriority.allCases) { priority in
                        Text(priority.title).tag(priority)
                    }
                }
                .accessibilityIdentifier("new-service-priority")
            }
            DatePicker("Prescritta", selection: $model.newServicePrescribedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("new-service-prescribed-at")
            TextField("Quesito clinico", text: $model.newServiceClinicalQuestion)
                .accessibilityIdentifier("new-service-clinical-question")
            TextField("Erogatore", text: $model.newServiceProvider)
                .accessibilityIdentifier("new-service-provider")
            Toggle("Prenotata", isOn: $model.newServiceHasScheduledAt)
                .accessibilityIdentifier("new-service-has-scheduled-at")
            if model.newServiceHasScheduledAt {
                DatePicker("Prenotazione", selection: $model.newServiceScheduledAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-scheduled-at")
            }
            Toggle("Eseguita", isOn: $model.newServiceHasPerformedAt)
                .accessibilityIdentifier("new-service-has-performed-at")
            if model.newServiceHasPerformedAt {
                DatePicker("Esecuzione", selection: $model.newServicePerformedAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-performed-at")
            }
            Toggle("Referto ricevuto", isOn: $model.newServiceHasReportReceivedAt)
                .accessibilityIdentifier("new-service-has-report-at")
            if model.newServiceHasReportReceivedAt {
                DatePicker("Referto", selection: $model.newServiceReportReceivedAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-service-report-at")
            }
            TextField("Esito o note referto", text: $model.newServiceOutcomeNote)
                .accessibilityIdentifier("new-service-outcome")
            TextField("Numero richiesta", text: $model.newServiceRequestReference)
                .accessibilityIdentifier("new-service-request-reference")
            Picker("Fonte", selection: $model.newServiceSource) {
                ForEach(PairedPrescriptionSource.allCases) { source in
                    Text(source.title).tag(source)
                }
            }
            .accessibilityIdentifier("new-service-source")
            TextField("Riferimenti documento", text: $model.newServiceDocumentRefs)
                .accessibilityIdentifier("new-service-document-refs")
            TextField("Note", text: $model.newServiceNotes)
                .accessibilityIdentifier("new-service-notes")
            TextField("Voci, una per riga: CODICE NOME", text: $model.newServiceItemsText, axis: .vertical)
                .lineLimit(3...8)
                .accessibilityIdentifier("new-service-items")
            Button {
                Task { await model.createServicePrescriptionForSelectedPatient() }
            } label: {
                Label("Salva prestazione", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!model.canCreateServicePrescription)
            .accessibilityIdentifier("create-service-prescription-button")
        }
    }

    /* @Codex */
    private func prostheticPrescriptionRow(_ prescription: HomeBaseProstheticPrescriptionSummary) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(prescription.description)
                        .font(.caption.weight(.semibold))
                    Text(Self.entryDateFormatter.string(from: prescription.prescribedAt))
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                flagChip(
                    PairedProstheticPrescriptionStatus.title(for: prescription.status),
                    tone: PairedProstheticPrescriptionStatus.tone(for: prescription.status)
                )
            }
            HStack(spacing: 6) {
                flagChip(prescription.category, tone: .neutral)
                if let iso = prescription.isoCode?.trimmedOrNil {
                    Text(iso)
                        .font(.caption2.monospaced().weight(.semibold))
                        .foregroundStyle(.secondary)
                }
            }
            if let reason = prescription.clinicalReason?.trimmedOrNil {
                Text(reason)
                    .font(.caption)
                    .lineLimit(2)
            }
            if let measures = prescription.measures?.trimmedOrNil {
                Text("Misure: \(measures)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let supplier = prescription.supplier?.trimmedOrNil {
                Text("Fornitore: \(supplier)")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let collaudo = prescription.collaudoAt {
                Text("Collaudo: \(Self.entryDateFormatter.string(from: collaudo))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if let outcome = prescription.collaudoOutcome?.trimmedOrNil {
                Text(outcome)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Button {
                Task { await model.markProstheticPrescriptionTested(prescription) }
            } label: {
                Label("Collaudo", systemImage: "checkmark.seal")
            }
            .font(.caption)
            .disabled(!model.canTestProstheticPrescription(prescription))
            .accessibilityIdentifier("prosthetic-test-\(prescription.id)")
        }
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /* @Codex */
    private var prostheticPrescriptionForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Nuova prescrizione protesica", systemImage: "figure.walk.motion")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            TextField("Descrizione", text: $model.newProstheticDescription)
                .accessibilityIdentifier("new-prosthetic-description")
            HStack(spacing: 8) {
                TextField("Codice ISO", text: $model.newProstheticISOCode)
                    .accessibilityIdentifier("new-prosthetic-iso-code")
                Picker("Categoria", selection: $model.newProstheticCategory) {
                    ForEach(PairedProstheticPrescriptionCategory.allCases) { category in
                        Text(category.title).tag(category)
                    }
                }
                .accessibilityIdentifier("new-prosthetic-category")
            }
            Picker("Stato", selection: $model.newProstheticStatus) {
                ForEach(PairedProstheticPrescriptionStatus.allCases) { status in
                    Text(status.title).tag(status)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("new-prosthetic-status")
            DatePicker("Prescritta", selection: $model.newProstheticPrescribedAt, displayedComponents: [.date, .hourAndMinute])
                .accessibilityIdentifier("new-prosthetic-prescribed-at")
            TextField("Misure", text: $model.newProstheticMeasures)
                .accessibilityIdentifier("new-prosthetic-measures")
            TextField("Motivo clinico", text: $model.newProstheticClinicalReason)
                .accessibilityIdentifier("new-prosthetic-clinical-reason")
            TextField("Numero regionale", text: $model.newProstheticRegionalPrescriptionId)
                .accessibilityIdentifier("new-prosthetic-regional-id")
            TextField("Fornitore", text: $model.newProstheticSupplier)
                .accessibilityIdentifier("new-prosthetic-supplier")
            Toggle("Collaudo già registrato", isOn: $model.newProstheticHasCollaudoAt)
                .accessibilityIdentifier("new-prosthetic-has-collaudo")
            if model.newProstheticHasCollaudoAt {
                DatePicker("Collaudo", selection: $model.newProstheticCollaudoAt, displayedComponents: [.date, .hourAndMinute])
                    .accessibilityIdentifier("new-prosthetic-collaudo-at")
                TextField("Esito collaudo", text: $model.newProstheticCollaudoOutcome)
                    .accessibilityIdentifier("new-prosthetic-collaudo-outcome")
            }
            Picker("Fonte", selection: $model.newProstheticSource) {
                ForEach(PairedPrescriptionSource.allCases) { source in
                    Text(source.title).tag(source)
                }
            }
            .accessibilityIdentifier("new-prosthetic-source")
            TextField("Riferimenti documento", text: $model.newProstheticDocumentRefs)
                .accessibilityIdentifier("new-prosthetic-document-refs")
            TextField("Note", text: $model.newProstheticNotes)
                .accessibilityIdentifier("new-prosthetic-notes")
            Button {
                Task { await model.createProstheticPrescriptionForSelectedPatient() }
            } label: {
                Label("Salva protesica", systemImage: "checkmark.circle")
            }
            .font(.caption)
            .disabled(!model.canCreateProstheticPrescription)
            .accessibilityIdentifier("create-prosthetic-prescription-button")
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
            let series = numericObservationSeries(forCode: observation.code)
            if observation.deletedAt == nil, series.count >= 2 {
                Chart(series) { point in
                    LineMark(x: .value("Data", point.date), y: .value("Valore", point.value))
                        .interpolationMethod(.monotone)
                }
                .chartXAxis(.hidden)
                .chartYAxis(.hidden)
                .frame(height: 30)
                .accessibilityIdentifier("observation-sparkline-\(observation.code)")
                .accessibilityLabel("Andamento \(observation.display): \(series.count) rilevazioni")
            }
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

    private struct ObservationPoint: Identifiable {
        let id: Int
        let date: Date
        let value: Double
    }

    // The numeric time-series for a LOINC code across the loaded (non-deleted)
    // observations, oldest-first, for the inline sparkline. Non-numeric values
    // (e.g. "120/80", "positivo") are skipped, so a series appears only for scalar
    // parameters with >= 2 readings.
    private func numericObservationSeries(forCode code: String) -> [ObservationPoint] {
        model.observations
            .filter { $0.code == code && $0.deletedAt == nil }
            .compactMap { obs -> (Date, Double)? in
                guard let value = Self.parseObservationValue(obs.value) else { return nil }
                return (obs.observedAt, value)
            }
            .sorted { $0.0 < $1.0 }
            .enumerated()
            .map { ObservationPoint(id: $0.offset, date: $0.element.0, value: $0.element.1) }
    }

    static func parseObservationValue(_ raw: String) -> Double? {
        let trimmed = raw.trimmingCharacters(in: .whitespaces)
        if let direct = Double(trimmed) { return direct }
        return Double(trimmed.replacingOccurrences(of: ",", with: "."))
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
        codeResults: [HomeBaseTerminologyItem],
        unitResults: [HomeBaseTerminologyItem],
        isSearchingCode: Bool,
        isSearchingUnit: Bool,
        primaryLabel: String,
        primaryIdentifier: String,
        canSubmit: Bool,
        onCodeQueryChanged: @escaping () -> Void,
        onUnitQueryChanged: @escaping () -> Void,
        onSelectCode: @escaping (HomeBaseTerminologyItem) -> Void,
        onSelectUnit: @escaping (HomeBaseTerminologyItem) -> Void,
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
                .onChange(of: code.wrappedValue) { _ in
                    onCodeQueryChanged()
                }
            terminologyResultsList(
                title: "LOINC",
                results: codeResults,
                isLoading: isSearchingCode,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectCode
            )
            HStack(spacing: 8) {
                TextField("Valore", text: value)
                    .accessibilityIdentifier("\(primaryIdentifier)-value")
                TextField("Unità UCUM", text: unitCode)
                    .accessibilityIdentifier("\(primaryIdentifier)-unit-code")
                    .onChange(of: unitCode.wrappedValue) { _ in
                        onUnitQueryChanged()
                    }
            }
            terminologyResultsList(
                title: "UCUM",
                results: unitResults,
                isLoading: isSearchingUnit,
                primaryIdentifier: primaryIdentifier,
                onSelect: onSelectUnit
            )
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
    @ViewBuilder
    private func terminologyResultsList(
        title: String,
        results: [HomeBaseTerminologyItem],
        isLoading: Bool,
        primaryIdentifier: String,
        onSelect: @escaping (HomeBaseTerminologyItem) -> Void
    ) -> some View {
        if isLoading || !results.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                if isLoading {
                    HStack(spacing: 6) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Ricerca \(title)")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                ForEach(results) { item in
                    Button {
                        onSelect(item)
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text(item.code)
                                .font(.caption.monospaced().weight(.semibold))
                            Text(item.display)
                                .font(.caption)
                                .lineLimit(2)
                            Spacer(minLength: 4)
                            Image(systemName: "checkmark.circle")
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(primaryIdentifier)-terminology-\(title)-\(item.code)")
                }
            }
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

    /* @Codex */
    private func serviceDatesLine(_ prescription: HomeBaseServicePrescriptionSummary) -> some View {
        let values: [String] = [
            prescription.scheduledAt.map { "Prenotata \(Self.entryDateFormatter.string(from: $0))" },
            prescription.performedAt.map { "Eseguita \(Self.entryDateFormatter.string(from: $0))" },
            prescription.reportReceivedAt.map { "Referto \(Self.entryDateFormatter.string(from: $0))" },
        ].compactMap { $0 }
        return Text(values.joined(separator: " · "))
            .font(.caption2)
            .foregroundStyle(.secondary)
            .opacity(values.isEmpty ? 0 : 1)
    }

    /* @Codex */
    private static func serviceMatchLabel(_ rawValue: String) -> String {
        switch rawValue {
        case "matched":
            return "match"
        case "candidate":
            return "candidato"
        case "manual":
            return "manuale"
        default:
            return "da codificare"
        }
    }
}

/* @Codex */
private enum PatientLifecycleSheet: String, Identifiable {
    case archive
    case unarchive
    case delete

    var id: String { rawValue }
}

/* @Codex */
// S6 (D15): which existing record family the FSE single-document check targets.
private enum FseValidationRecordKind: String, CaseIterable, Identifiable {
    case therapy
    case observation

    var id: String { rawValue }

    var title: String {
        switch self {
        case .therapy: return "Terapia"
        case .observation: return "Osservazione"
        }
    }
}
