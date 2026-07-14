import SwiftUI
import PhotosUI

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
            PairedPatientCreateView(model: model)
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
                        patientsListContent
                            .cardStyle()
                    }
                    .padding(20)
                }
                .frame(width: 360)

                Divider()

                ScrollView {
                    Group {
                        if let detail = model.selectedPatient {
                            selectedPatientSections(detail)
                                .cardStyle()
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

    private var credentialsCard: some View {
        PairedHomeBaseCredentialsView(
            model: model,
            confirmsClearingPairing: $confirmsClearingPairing
        )
    }

    private var patientsListContent: some View {
        PairedPatientsWorklistView(
            model: model,
            patientQuery: $patientQuery,
            patientViewMode: $patientViewMode,
            patientSortMode: $patientSortMode
        )
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

    @ViewBuilder
    private func selectedPatientSections(_ detail: HomeBasePatientDetail) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            PairedPatientDetailSection(
                model: model,
                detail: detail,
                patientLifecycleSheet: $patientLifecycleSheet,
                icdQuery: $icdQuery,
                confirmsFHIRExport: $confirmsFHIRExport
            )
            PairedPatientDiarySection(
                model: model,
                capabilities: capabilities,
                entryTypeFilter: $entryTypeFilter,
                showsDeletedDiaryEntries: $showsDeletedDiaryEntries,
                confirmsReplacingEntryTemplate: $confirmsReplacingEntryTemplate,
                entryDeletionCandidate: $entryDeletionCandidate,
                presentingScale: $presentingScale,
                attachmentDetailCandidate: $attachmentDetailCandidate
            )
            PairedPatientScalesSection(
                model: model,
                presentingScale: $presentingScale
            )
            PairedPatientTherapiesSection(
                model: model,
                therapyStatusFilter: $therapyStatusFilter,
                confirmsDeletingTherapy: $confirmsDeletingTherapy,
                therapyDeletionCandidateId: $therapyDeletionCandidateId
            )
            PairedPatientClinicalSections(
                model: model,
                checkupStatusFilter: $checkupStatusFilter,
                confirmsDeletingCheckup: $confirmsDeletingCheckup,
                checkupDeletionCandidateId: $checkupDeletionCandidateId,
                confirmsDeletingObservation: $confirmsDeletingObservation,
                observationDeletionCandidateId: $observationDeletionCandidateId
            )
            PairedPatientPrescriptionSections(model: model)
            PairedPatientDocumentsSection(
                model: model,
                capabilities: capabilities,
                attachmentDetailCandidate: $attachmentDetailCandidate,
                isPickingAttachmentFile: $isPickingAttachmentFile,
                pickedPhotoItem: $pickedPhotoItem,
                attachmentPickerError: $attachmentPickerError,
                fseValidationKind: $fseValidationKind,
                selectedFseTherapyId: $selectedFseTherapyId,
                selectedFseObservationId: $selectedFseObservationId,
                expandedInsightId: $expandedInsightId
            )
        }
    }
}

/* @Codex */
extension PairedPatientsWorkspaceView {
    static func age(from birthDate: Date?) -> Int? {
        PairedPatientsWorkspaceSupport.age(from: birthDate)
    }

    static func parseObservationValue(_ raw: String) -> Double? {
        PairedPatientClinicalSections.parseObservationValue(raw)
    }
}
