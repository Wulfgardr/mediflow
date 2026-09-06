import SwiftUI
import PhotosUI

struct PairedPatientsWorkspaceView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.colorScheme) private var colorScheme
    @ObservedObject private var model: PairedPatientsWorkspaceModel
    // S6 (D7-bis): gates the new document surfaces on the effective capability
    // matrix returned for this pairing. The server downgrades host-supported but
    // ungranted keys to unavailable, so a legacy pairing gets proactive re-pair
    // guidance before a data-plane call can fail with 403.
    @ObservedObject private var capabilities: ClinicalWorkspaceCapabilitiesStore
    @State private var confirmsClearingPairing = false
    @State private var showsConnectionSetup = false // @Codex
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
    @State private var isCompactPatientHeaderExpanded = false
    // @Codex: A navigation destination, not authority to operate on this patient.
    @State private var compactPatientID: String?

    init(model: PairedPatientsWorkspaceModel, capabilities: ClinicalWorkspaceCapabilitiesStore) {
        self.model = model
        self.capabilities = capabilities
    }

    var body: some View {
        deleteDialogWorkspace
        #if os(macOS)
            .modifier(VisitRecordingWorkspaceScope(model: model)) // @Codex
        #endif
    }

    private var platformWorkspace: some View {
        layoutBody
        #if os(macOS)
        .textFieldStyle(.roundedBorder) // @Codex: Native desktop field geometry.
        // No window-wide background fill: the sidebar material, the toolbar and
        // the scroll-edge effect are drawn by the system, and an opaque
        // windowBackgroundColor painted over the whole workspace is exactly what
        // suppresses them. Clinical content stays opaque through its own Lume
        // surfaces, which is where opacity belongs.
        .toolbar { macOSWorkspaceToolbar }
        // The system search field, in the toolbar where macOS puts it, instead of
        // the magnifying-glass-plus-TextField this column drew by hand. On macOS
        // 26 it also collapses to a toolbar button until used, which gives the
        // worklist back the vertical space the hand-drawn field occupied.
        .searchable(
            text: $patientQuery,
            placement: .toolbar,
            prompt: "Cerca per nome o codice fiscale"
        )
        .modifier(MinimizedSearchToolbarBehavior())
        #else
        .clinicalFieldShape()
        .background(mobileCanvasColor)
        // Creating a patient is the home's primary action, so it belongs in the
        // navigation bar. Inline it consumed the first viewport at accessibility
        // text sizes and pushed the first patient off screen.
        // Three related controls declared as one group rather than as three
        // separate `ToolbarItem`s, which is what they are: a list-wide action
        // and two list-wide settings.
        //
        // Stated honestly, because it was tried as a fix and was not one: on a
        // 13-inch iPad the toolbar draws a capsule roughly a thousand points
        // wide with the new-patient glyph pinned at its far left, the sort menu
        // and the ambulatory picker at its far right, and empty glass between.
        // Grouping the three changed nothing visible. Tapping the empty span
        // does nothing either, so it is not the collapsed search field — search
        // is the separate circle at the trailing edge. The cause is still
        // unknown and the symptom is recorded in the handover rather than
        // papered over.
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.startCreatingPatient()
                } label: {
                    Label("Nuovo paziente", systemImage: "person.badge.plus")
                }
                .disabled(model.isWorking)
                .accessibilityLabel("Nuovo paziente")
                .accessibilityIdentifier("new-patient-button")

                // Sort is a list-wide setting, not content: as a toolbar menu it
                // states the active order on its own face and stops competing
                // with the patients for first-viewport height.
                Picker("Ordina", selection: $patientSortMode) {
                    Text("Recenti").tag(PatientListSortMode.recent)
                    Text("Alfabetico").tag(PatientListSortMode.alpha)
                }
                .pickerStyle(.menu)
                .accessibilityLabel("Ordina pazienti")
                .accessibilityValue(patientSortMode == .recent ? "Recenti" : "Alfabetico")
                .accessibilityIdentifier("patient-sort-menu")

                // Renders only when the host has published ambulatories. Same
                // identifier as before, because it is the same control.
                if !model.availableAmbulatories.isEmpty {
                    Menu {
                        ForEach(model.availableAmbulatories) { ambulatory in
                            Button(ambulatory.name) {
                                model.selectAmbulatory(ambulatory.id)
                            }
                        }
                    } label: {
                        Label(activeAmbulatoryScopeLabel, systemImage: "building.2")
                    }
                    .accessibilityLabel("Ambulatorio attivo")
                    .accessibilityValue(activeAmbulatoryScopeLabel)
                    .accessibilityIdentifier("ambulatory-scope-picker")
                    // @Codex
                    .contentShape(.interaction, Rectangle().inset(by: -4))
                }
            }
        }
        // The query stays owned by this view, so the field and the filtering read
        // the same storage and recomposition does not swap it out.
        .searchable(
            text: $patientQuery,
            placement: .toolbar,
            prompt: "Cerca per nome o codice fiscale"
        )
        .modifier(MinimizedSearchToolbarBehavior())
        #endif
    }

    private var sheetWorkspace: some View {
        platformWorkspace
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
        /* @Codex */
        .sheet(isPresented: $showsConnectionSetup) {
            PairedHomeBaseCredentialsSheet(
                model: model,
                confirmsClearingPairing: $confirmsClearingPairing
            )
        }
        .sheet(isPresented: $model.isCreatingPatient) {
            PairedPatientCreateView(model: model)
        }
        .sheet(item: $entryDeletionCandidate) { entry in
            PairedDiaryDeleteSheet(entry: entry, model: model)
        }
        // @Codex: The diary and documents share this presenter even when only
        // one clinical section is mounted. Opening a document never saves a draft.
        .sheet(item: $attachmentDetailCandidate, onDismiss: { model.dismissAttachmentDetail() }) { summary in
            PairedAttachmentDetailView(model: model, summary: summary, onClose: {
                attachmentDetailCandidate = nil
            })
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
    }

    private var eventWorkspace: some View {
        sheetWorkspace
        // @Codex: The archive summary remains available when Documents is not mounted.
        .task(id: attachmentReadPatientID) {
            guard attachmentReadPatientID != nil, model.attachmentsLoadState == .idle else { return }
            // @Codex: This shared read belongs to the patient context. Leaving a
            // section must not cancel it; the model rejects stale responses.
            Task { await model.loadSelectedPatientAttachments(reportStatus: false) }
        }
        // @Codex: A presentation must not outlive its patient context.
        .onChange(of: model.selectedPatient?.id) { patientID in
            if attachmentDetailCandidate?.patientId != patientID {
                attachmentDetailCandidate = nil
            }
        }
        .onChange(of: model.selectedPatientID) { patientID in
            if patientID == nil { compactPatientID = nil }
            isCompactPatientHeaderExpanded = false
        }
        .onChange(of: model.isEditingPatient) { isEditing in
            if isEditing { model.activePatientSection = .overview }
        }
        .onChange(of: patientViewMode) { newValue in
            guard newValue == .trash else { return }
            Task { await model.loadPatientTrash() }
        }
        .onChange(of: scenePhase) { newValue in
            guard newValue == .active else { return }
            Task { await model.checkNetworkRevisionOnForeground() }
        }
    }

    /* @Codex */
    private var attachmentReadPatientID: String? {
        guard capabilities.hasCapability("network.replica.readonly-documents") else { return nil }
        #if DEBUG
        if PairedPatientsWorkspaceModel.isUITestSeeded { return model.selectedPatient?.id }
        #endif
        return model.canLoadAttachments ? model.selectedPatient?.id : nil
    }

    private var exportDialogWorkspace: some View {
        eventWorkspace
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
    }

    private var entryDialogWorkspace: some View {
        exportDialogWorkspace
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
    }

    private var deleteDialogWorkspace: some View {
        entryDialogWorkspace
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

    #if !os(macOS)
    /// Whether the container that was actually handed to the workspace can host
    /// list and chart side by side. The size class is not consulted: it reports
    /// "not a phone", not how much width this workspace received, and on iPad the
    /// same app is resized continuously.
    private func usesSplitLayout(containerWidth: CGFloat) -> Bool {
        // Before the first measurement lands, stay in the single column: it is
        // the arrangement that is correct at every width.
        PatientsWorkspaceLayout.usesSideBySide(
            containerWidth: containerWidth,
            isAccessibilitySize: dynamicTypeSize.isAccessibilitySize
        )
    }
    #endif

    // @Codex: Compact uses a destination; wide layouts retain list and chart together.
    @ViewBuilder
    private var layoutBody: some View {
        #if os(macOS)
        macOSWorkspace
        #else
        GeometryReader { proxy in
            mobileWorkspace(containerWidth: proxy.size.width)
                .onChange(of: usesSplitLayout(containerWidth: proxy.size.width)) { isWide in
                    compactPatientID = isWide ? nil : model.selectedPatientID
                }
        }
        .navigationDestination(isPresented: compactDetailIsPresented) {
            compactPatientDestination
        }
        #endif
    }

    #if !os(macOS)
    @ViewBuilder
    private func mobileWorkspace(containerWidth: CGFloat) -> some View {
        if usesSplitLayout(containerWidth: containerWidth) {
            HStack(spacing: 0) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        mobilePairedStatus
                        workspaceFeedbackLine
                        patientsListContent
                            .padding(16)
                            .lumeSurface(zone: .field)
                    }
                    .padding(20)
                }
                .frame(width: PatientsWorkspaceLayout.listWidth(forContainerWidth: containerWidth))

                Divider()

                ScrollView {
                    Group {
                        patientDetailContent
                    }
                    .padding(20)
                    // The chart is sized to the column it was given, not to
                    // `.infinity`. An unbounded proposal here let the chart claim
                    // the whole window: on iPad it rendered a column-wide card
                    // offset to the right and clipped at the screen edge, taking
                    // the address, the FHIR action and the AI summary off screen.
                    .frame(
                        width: PatientsWorkspaceLayout.detailWidth(forContainerWidth: containerWidth),
                        alignment: .topLeading
                    )
                }
                .frame(width: PatientsWorkspaceLayout.detailWidth(forContainerWidth: containerWidth))
                // The open chart keeps its identity in the split arrangement too,
                // not only when the columns collapse.
                .safeAreaInset(edge: .top, spacing: 0) {
                    if let detail = model.selectedPatient {
                        VStack(spacing: 0) {
                            compactPatientHeader(detail, matchesContainerWidth: false)
                            patientSectionPicker
                        }
                        .frame(
                            width: PatientsWorkspaceLayout.detailWidth(forContainerWidth: containerWidth),
                            alignment: .leading
                        )
                    }
                }
                .id(model.activePatientSection)
            }
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    #if DEBUG
                    if focusedDetailOnly, let detail = model.selectedPatient {
                        selectedPatientSections(detail)
                            .compactContainerWidth(inset: 40)
                    } else {
                        mobilePairedStatus
                        workspaceFeedbackLine
                        compactWorklist
                    }
                    #else
                    mobilePairedStatus
                    workspaceFeedbackLine
                    compactWorklist
                    #endif
                }
                .padding(20)
                .compactContainerWidth()
            }
            .safeAreaInset(edge: .top, spacing: 0) {
                // @Codex: The chart header belongs to the chart destination.
                #if DEBUG
                if focusedDetailOnly, let detail = model.selectedPatient {
                    VStack(spacing: 0) {
                        compactPatientHeader(detail)
                        patientSectionPicker
                    }
                }
                #endif
            }
        }
    }

    /* @Codex */
    private var compactDetailIsPresented: Binding<Bool> {
        Binding(get: { compactPatientID != nil }, set: { if !$0 { compactPatientID = nil } })
    }

    /* @Codex */
    private var compactWorklist: some View {
        PairedPatientsWorklistView(
            model: model,
            patientQuery: $patientQuery,
            patientViewMode: $patientViewMode,
            patientSortMode: $patientSortMode,
            onOpenPatient: { patient in
                guard model.canChangePatientSelection else { return }
                compactPatientID = patient.id
                // Returning to the same chart must not discard its draft or refetch it.
                if model.selectedPatient?.id != patient.id {
                    Task { await model.loadPatient(patient) }
                }
            }
        )
        .chartCard()
    }

    /* @Codex */
    private var compactPatientDestination: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: ClinicalChartMetrics.sectionSpacing) {
                workspaceFeedbackLine
                if let detail = model.selectedPatient, detail.id == compactPatientID {
                    selectedPatientSections(detail)
                } else if let patientID = compactPatientID {
                    pendingPatientDetail(patientID: patientID)
                }
            }
            .padding(20)
            .compactContainerWidth()
            // @Codex: Group clinical content without wrapping UIKit's scroll
            // container and its navigation/keyboard accessibility elements.
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("patient-compact-detail-destination")
        }
        .background(mobileCanvasColor)
        .navigationTitle(model.activePatientSection.title)
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top, spacing: 0) {
            if let detail = model.selectedPatient, detail.id == compactPatientID {
                VStack(spacing: 0) {
                    compactPatientHeader(detail)
                    patientSectionPicker
                }
            }
        }
        .id(model.activePatientSection)
    }

    /* @Codex */
    private var mobileCanvasColor: Color {
        colorScheme == .dark
            ? LumePalette.guardia.canvas
            : PlatformColors.groupedBackground
    }

    /* @Codex */
    @ViewBuilder
    private var mobilePairedStatus: some View {
        #if DEBUG
        if let override = MobilePairedStatusUITestOverride.load() {
            MobilePairedStatusView(presentation: override.presentation, onPrimaryAction: {})
        } else {
            liveMobilePairedStatus
        }
        #else
        liveMobilePairedStatus
        #endif
    }

    private var liveMobilePairedStatus: some View {
        MobilePairedStatusView(
            presentation: .make(
                connectionState: model.connectionState,
                isWorking: model.isWorking,
                errorMessage: model.errorMessage,
                reconciliationLine: model.reconciliationLine
            )
        ) {
            switch model.connectionState {
            case .notLoaded, .sessionExpired:
                showsConnectionSetup = true
            case .cached, .pairedOnline, .pairedOfflineDegraded:
                Task { await model.loadPatients() }
            }
        }
    }
    #endif

    #if os(macOS)
    /* @Codex */
    /// Window toolbar for the patients workspace.
    ///
    /// The chart actions live here, not in a grid inside the chart: on macOS the
    /// toolbar is the system's control surface, it adopts the platform material
    /// on its own, and it leaves the chart to the clinical content. The
    /// destructive action stays behind a menu rather than sitting one stray
    /// click away from the edit button.
    @ToolbarContentBuilder
    private var macOSWorkspaceToolbar: some ToolbarContent {
        ToolbarItem(placement: .primaryAction) {
            Button {
                model.startCreatingPatient()
            } label: {
                Label("Nuovo paziente", systemImage: "person.badge.plus")
            }
            .disabled(!model.canCreatePatient || model.isWorking)
            .help("Nuovo paziente")
            .accessibilityIdentifier("new-patient-toolbar-button")
        }

        // Same control, same identifier, on both platforms: the scope belongs
        // with the list it scopes wherever that list is shown.
        ambulatoryScopeToolbarItem

        // Separates "create" from "act on the open chart": on macOS 26 the
        // toolbar renders each group as its own glass island, which is what makes
        // the grouping read at a glance rather than as one undifferentiated row.
        if #available(macOS 26.0, *), model.selectedPatient != nil {
            ToolbarSpacer(.fixed)
        }

        if let detail = model.selectedPatient {
            ToolbarItemGroup(placement: .primaryAction) {
                Button {
                    model.startEditingPatient()
                } label: {
                    Label("Modifica", systemImage: "pencil")
                }
                .disabled(model.isEditingPatient)
                .help("Modifica anagrafica")
                .accessibilityIdentifier("edit-patient-toolbar-button")

                Button {
                    confirmsFHIRExport = true
                } label: {
                    Label("Esporta FHIR", systemImage: "doc.badge.arrow.up")
                }
                .disabled(!model.canPrepareFHIRExport)
                .help("Valida ed esporta FHIR in locale")
                .accessibilityIdentifier("patient-export-fhir-toolbar-button")

                if let fhirURL = model.patientFHIRExportURL {
                    ShareLink(item: fhirURL) {
                        Label("Condividi FHIR", systemImage: "square.and.arrow.up")
                    }
                    .accessibilityIdentifier("patient-share-fhir-toolbar-button")
                }

                Menu {
                    if detail.isArchived == true {
                        Button {
                            patientLifecycleSheet = .unarchive
                        } label: {
                            Label("Riattiva paziente", systemImage: "archivebox")
                        }
                        .disabled(!model.canUnarchivePatient)
                        .accessibilityIdentifier("unarchive-patient-toolbar-button")
                    } else {
                        Button {
                            patientLifecycleSheet = .archive
                        } label: {
                            Label("Archivia paziente", systemImage: "archivebox")
                        }
                        .disabled(!model.canArchivePatient)
                        .accessibilityIdentifier("archive-patient-toolbar-button")
                    }

                    Button {
                        Task { await model.openPrregHandoff() }
                    } label: {
                        Label("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
                    }
                    .accessibilityIdentifier("patient-prreg-handoff-toolbar-button")

                    Divider()

                    Button(role: .destructive) {
                        patientLifecycleSheet = .delete
                    } label: {
                        Label("Elimina paziente", systemImage: "trash")
                    }
                    .disabled(!model.canSoftDeletePatient)
                    .accessibilityIdentifier("soft-delete-patient-toolbar-button")
                } label: {
                    Label("Altre azioni", systemImage: "ellipsis.circle")
                }
                .help("Altre azioni sulla scheda")
                .accessibilityIdentifier("patient-actions-toolbar-menu")
            }
        }
    }

    // @Codex: A single desktop split below the app navigation. A nested
    // NavigationSplitView extends its toolbar material over the patient header;
    // HSplitView leaves that chrome to the root NavigationStack.
    private var macOSWorkspace: some View {
        HSplitView {
            VStack(alignment: .leading, spacing: 0) {
                VStack(alignment: .leading, spacing: 8) {
                    connectionSetupBanner
                    workspaceFeedbackLine
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 10)

                // The worklist owns its own padding and its own vertical
                // distribution: applied here, every one of its top-level
                // elements got the frame and spread across the column.
                patientsListContent
            }
            .frame(minWidth: 260, idealWidth: 300, maxWidth: 340, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("patient-workspace-sidebar")
            // @Codex: The identity is outside the scrolling plane, including
            // its system edge effect; it must remain readable during a scroll.
            VStack(spacing: 0) {
                if let detail = model.selectedPatient {
                    patientWorkspaceHeader(detail)
                    MacPatientSectionNavigation(selection: $model.activePatientSection)
                        .padding(.horizontal, 28)
                        .padding(.bottom, 12)
                    Divider()
                }
                // @Codex: Keep the split pane stable while resetting only its scroll
                // position. Replacing the pane identity also moved AppKit's divider.
                ScrollViewReader { scroll in
                    ScrollView {
                        patientDetailContent
                            .padding(28)
                            // Keep clinical rows within a comfortable reading width.
                            .frame(maxWidth: 1000, alignment: .leading)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("patient-chart-scroll-top")
                    }
                    .onChange(of: model.activePatientSection) { _ in
                        scroll.scrollTo("patient-chart-scroll-top", anchor: .top)
                    }
                }
            }
            .background(PlatformColors.chartCardSurface)
            .frame(minWidth: 360, maxWidth: .infinity, maxHeight: .infinity)
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("patient-workspace-detail")
        }
    }

    /* @Codex */
    private func patientWorkspaceHeader(_ detail: HomeBasePatientDetail) -> some View {
        let name = "\(detail.lastName) \(detail.firstName)"
        let metadata = patientWorkspaceHeaderMetadata(detail)

        return Group {
            if dynamicTypeSize >= .accessibility1 {
                patientWorkspaceHeaderVertical(name: name, metadata: metadata)
            } else {
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 16) {
                        patientWorkspaceHeaderName(name)
                        Spacer(minLength: 16)
                        patientWorkspaceHeaderAtoms(metadata)
                    }
                    patientWorkspaceHeaderVertical(name: name, metadata: metadata)
                }
            }
        }
        .padding(.horizontal, 28)
        .padding(.top, 24)
        .padding(.bottom, 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(name). \(metadata)")
        .accessibilityHeading(.h1)
        .accessibilityIdentifier("patient-workspace-header")
    }

    /* @Codex */
    private func patientWorkspaceHeaderVertical(name: String, metadata: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            patientWorkspaceHeaderName(name)
            patientWorkspaceHeaderAtoms(metadata)
        }
    }

    /* @Codex */
    private func patientWorkspaceHeaderName(_ name: String) -> some View {
        Text(name)
            .font(.largeTitle.weight(.semibold))
            .fixedSize(horizontal: false, vertical: true)
    }

    /* @Codex */
    private func patientWorkspaceHeaderAtoms(_ metadata: String) -> some View {
        Text(metadata)
            .font(.subheadline)
            .registro()
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

    /* @Codex */
    private func patientWorkspaceHeaderMetadata(_ detail: HomeBasePatientDetail) -> String {
        var atoms = [PairedPatientsWorkspaceSupport.compactTaxCode(detail.taxCode)]
        if let age = PairedPatientsWorkspaceSupport.age(from: detail.birthDate) {
            atoms.append("\(age) anni")
        }
        if let updatedAt = detail.updatedAt {
            atoms.append("Aggiornato \(PairedPatientsWorkspaceSupport.relativeUpdated(updatedAt))")
        } else {
            atoms.append("Aggiornamento non disponibile")
        }
        return atoms.joined(separator: " · ")
    }

    #endif

    /* @Codex */
    @ViewBuilder
    private var patientDetailContent: some View {
        if let detail = model.selectedPatient {
            // No card around the cards. Every section below already draws its own
            // surface, so wrapping the lot in one more produced a card inside a
            // card: two nested rounded rectangles, two borders, and a hierarchy
            // that says the whole chart is one object rather than a sequence of
            // readable ones. The chart reads as a thread — you open a patient and
            // scroll their sections — and a thread has no outer envelope.
            selectedPatientSections(detail)
        } else if let patientID = model.selectedPatientID {
            pendingPatientDetail(patientID: patientID)
        } else {
            emptyDetailState
                .accessibilityIdentifier("patient-detail-empty")
        }
    }

    /* @Codex */
    private func pendingPatientDetail(patientID: String) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            if model.isWorking {
                ProgressView("Caricamento della scheda…")
                    .accessibilityIdentifier("patient-detail-loading")
            } else if let error = model.errorMessage {
                Label("Scheda non disponibile", systemImage: "exclamationmark.triangle")
                    .font(.headline)
                    .foregroundStyle(LumePalette.critical)
                Text(error)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("patient-detail-load-error")
                retryPatientDetailButton(patientID: patientID)
            } else {
                Label("Dettaglio da ricaricare", systemImage: "arrow.clockwise")
                    .font(.headline)
                Text("La selezione resta attiva, ma i dati clinici devono essere ricaricati prima di essere mostrati.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                retryPatientDetailButton(patientID: patientID)
            }
        }
        .padding(20)
        .frame(maxWidth: 520, minHeight: 260, alignment: .leading)
        .lumeSurface(zone: .focal)
        .accessibilityIdentifier("patient-detail-pending")
    }

    /* @Codex */
    private func retryPatientDetailButton(patientID: String) -> some View {
        Button("Ricarica scheda") {
            guard let patient = model.patients.first(where: { $0.id == patientID }) else { return }
            Task { await model.loadPatient(patient) }
        }
        .disabled(!model.canChangePatientSelection)
        .accessibilityIdentifier("patient-detail-reload-button")
    }
    #if DEBUG
    // Screenshot/UI-test affordance: render only the open patient's clinical
    // sections (skip the pairing card) so the detail view can be captured from
    // the top without scrolling. Debug-only, never compiled into release.
    private var focusedDetailOnly: Bool {
        ProcessInfo.processInfo.environment["MEDIFLOW_APPLE_UITEST_FOCUS_DETAIL"] == "1"
    }
    #endif

    /* @Codex */
    @ViewBuilder
    private var connectionSetupBanner: some View {
        if let message = connectionSetupMessage {
            VStack(alignment: .leading, spacing: 8) {
                Label("Collegamento richiesto", systemImage: "exclamationmark.triangle.fill")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(LumePalette.warning)
                Text(message)
                    .font(.caption)
                    .fixedSize(horizontal: false, vertical: true)
                Button("Configura collegamento") {
                    showsConnectionSetup = true
                }
                .buttonStyle(.borderedProminent)
                .accessibilityHint("Apre le impostazioni necessarie per caricare i pazienti.")
                .accessibilityIdentifier("homebase-configuration-button")
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 12))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(Color.orange.opacity(0.4)))
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("homebase-connection-banner")
        }
    }

    /* @Codex */
    private var isPatientWorklistUsable: Bool {
        switch model.connectionState {
        case .pairedOnline:
            return true
        case .cached, .pairedOfflineDegraded, .notLoaded:
            return !model.patients.isEmpty
        case .sessionExpired:
            return false
        }
    }

    /* @Codex */
    private var connectionSetupMessage: String? {
        guard !isPatientWorklistUsable else { return nil }
        if model.errorMessage != nil {
            return "Non è possibile caricare i pazienti. Controlla il collegamento e riprova."
        }
        switch model.connectionState {
        case .sessionExpired:
            return "La sessione è scaduta. Accedi di nuovo per continuare."
        case .pairedOfflineDegraded:
            return "Il collegamento non è disponibile. Configuralo per ricaricare i pazienti."
        case .cached:
            return "L'elenco locale non è disponibile. Configura il collegamento per caricare i pazienti."
        case .notLoaded:
            return "Configura il collegamento per caricare l'elenco pazienti."
        case .pairedOnline:
            return nil
        }
    }

    private var patientsListContent: some View {
        PairedPatientsWorklistView(
            model: model,
            patientQuery: $patientQuery,
            patientViewMode: $patientViewMode,
            patientSortMode: $patientSortMode
        )
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
                // @Codex
                .lumeInchiostro(bozza: true)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: 420)
        .frame(maxWidth: .infinity, minHeight: 320)
    }

    /// Native disclosure for the open patient's identity.
    ///
    /// This was a plain Button whose only affordance was a bare chevron.
    /// DisclosureGroup states expanded and collapsed natively, keeps the label
    /// readable, exposes the revealed block as its own accessibility subtree,
    /// and is operable from the keyboard without hand-written plumbing.
    private func compactPatientHeader(
        _ detail: HomeBasePatientDetail,
        matchesContainerWidth: Bool = true
    ) -> some View {
        DisclosureGroup(isExpanded: $isCompactPatientHeaderExpanded) {
            VStack(alignment: .leading, spacing: ClinicalChartMetrics.itemSpacing) {
                if let birthDate = detail.birthDate {
                    headerIdentityRow(
                        "Nato il",
                        PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: birthDate)
                    )
                }
                headerIdentityRow(
                    "Codice fiscale",
                    PairedPatientsWorkspaceSupport.compactTaxCode(detail.taxCode)
                )
                // One uniquely identified revealed child, so a test can prove
                // the disclosure opened rather than inferring it.
                .accessibilityIdentifier("patient-compact-header-taxcode")
            }
            .padding(.top, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            // The whole header is one affordance: tap it anywhere to close it.
            //
            // A DisclosureGroup only toggles on its *label*, but its frame grows
            // to include the block it reveals — so where a tap lands depends on
            // how tall the revealed block happens to be. Setting the name at
            // headline and giving the rows real spacing pushed the expanded
            // frame's centre below the label, and the header opened and would
            // not close again. Making the revealed block toggle too removes the
            // dependency on that measurement instead of tuning it: a reader who
            // taps the birth date to dismiss the block gets what they asked for.
            .contentShape(.rect)
            .onTapGesture { isCompactPatientHeaderExpanded = false }
            // Container for the revealed block only, so the group's identifier
            // stops propagating onto these Text children and each keeps its own.
            // Deliberately not on the DisclosureGroup or its label: that is what
            // preserves the native button role and its expanded/collapsed state.
            .accessibilityElement(children: .contain)
        } label: {
            compactPatientHeaderLabel(detail)
        }
        // A DisclosureGroup paints its whole label with the accent colour, so a
        // `.foregroundStyle` on the name alone lost: the patient's name rendered
        // blue, like a link to somewhere else. Setting the style on the group
        // gives the label back to the content; `.tint` still drives the chevron,
        // which is the part that really is a control.
        .foregroundStyle(.primary)
        .tint(.accentColor)
        .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        // Liquid Glass, not an opaque band. The old header was a paper-coloured
        // rectangle with square corners welded across the full width: it read as
        // something stuck on top of the app rather than part of it, and it hid
        // the content passing underneath instead of letting it show through.
        // Floating and inset, the glass refracts the chart as it scrolls, which
        // is what tells you the header is above the content and not in it.
        .lumeGlass(in: .rect(cornerRadius: 22))
        .padding(.horizontal, 12)
        .padding(.bottom, 6)
        // No accessibility label override here on purpose: an explicit label on
        // the group merges it into one element and hides the native disclosure
        // control. DisclosureGroup already announces its label and its
        // expanded/collapsed state; the label view carries the patient identity.
        // The identifier goes on the control itself, so it is not the one the
        // workspace ancestor propagates to unnamed descendants.
        .accessibilityHint("Mostra o nasconde data di nascita e codice fiscale mascherato.")
        .accessibilityIdentifier("patient-compact-header-disclosure")
        // `containerRelativeFrame` resolves against the nearest container, which
        // for a safe-area inset is not the column the inset belongs to. In the
        // two-column arrangement the header is already bounded by its column, so
        // it asks for its column's width and nothing wider.
        .modifier(CompactContainerWidth(isEnabled: matchesContainerWidth))
    }

    /// The disclosure's own label: patient identity plus heading semantics.
    /// It carries no identifier and does not become its own accessibility
    /// element, because collapsing it into one turned the label into an inert
    /// static node and hid the native disclosure control underneath it.
    @ViewBuilder
    private func compactPatientHeaderLabel(_ detail: HomeBasePatientDetail) -> some View {
        // Primary, not tinted. A DisclosureGroup paints its label with the accent
        // colour, which turned the patient's name blue and made the one piece of
        // content on screen look like a link to somewhere else. The chevron keeps
        // the tint, because the chevron really is the control.
        let name = Text("\(detail.lastName) \(detail.firstName)")
            .font(.headline)
            .foregroundStyle(.primary)
        let birthYear = PairedPatientsWorkspaceSupport.birthYearText(from: detail.birthDate)
        Group {
            if dynamicTypeSize >= .accessibility1 {
                VStack(alignment: .leading, spacing: 3) {
                    name.fixedSize(horizontal: false, vertical: true)
                    if let birthYear {
                        Text(birthYear).font(.caption).registro().foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                HStack(spacing: 8) {
                    name
                    if let birthYear {
                        Text(birthYear).font(.caption).registro().foregroundStyle(.secondary)
                    }
                    Spacer(minLength: 8)
                }
            }
        }
        .frame(minHeight: 44)
        .accessibilityAddTraits(.isHeader)
    }

    /// What the workspace has to say about its last action, said where the action
    /// happened.
    ///
    /// `statusMessage` and `errorMessage` were rendered in exactly one place: the
    /// pairing form. On iOS that form is a configuration sheet, so every outcome
    /// the workspace produced — a scope switched, a load failed — was announced to
    /// a screen the clinician was not looking at. Switching ambulatory gave no
    /// confirmation anywhere, and an error from loading patients was invisible
    /// unless you happened to open the connection settings.
    ///
    /// Errors take precedence over status: if something failed, saying what
    /// succeeded first would bury it.
    @ViewBuilder
    private var workspaceFeedbackLine: some View {
        if let error = model.errorMessage {
            Label(error, systemImage: "exclamationmark.triangle.fill")
                .chartMetadata()
                .foregroundStyle(.red)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("workspace-error-message")
        } else if let status = model.statusMessage {
            Text(status)
                // @Codex
                .font(.caption)
                .lumeInchiostro(bozza: false)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityIdentifier("workspace-status-message")
        }
    }

    /// The active ambulatory, in the toolbar of the list it scopes.
    ///
    /// This control lived in the pairing form, so on iOS it was behind a
    /// configuration sheet that is not even on the same screen as the worklist,
    /// and on macOS it sat among server URLs and tokens. But the scope is not a
    /// pairing setting: it is the ward or clinic a clinician is working in, and it
    /// changes during a shift. It belongs beside the sort order, which is the
    /// other thing that decides what this list shows.
    ///
    /// Same identifier as before, because it is the same control — moved, not
    /// duplicated. It renders only when the host has published ambulatories.
    @ToolbarContentBuilder
    private var ambulatoryScopeToolbarItem: some ToolbarContent {
        if !model.availableAmbulatories.isEmpty {
            ToolbarItem(placement: .primaryAction) {
                Menu {
                    ForEach(model.availableAmbulatories) { ambulatory in
                        Button(ambulatory.name) {
                            model.selectAmbulatory(ambulatory.id)
                        }
                    }
                } label: {
                    Label(activeAmbulatoryScopeLabel, systemImage: "building.2")
                }
                .accessibilityLabel("Ambulatorio attivo")
                .accessibilityValue(activeAmbulatoryScopeLabel)
                .accessibilityIdentifier("ambulatory-scope-picker")
            }
        }
    }

    private var activeAmbulatoryScopeLabel: String {
        if let match = model.availableAmbulatories.first(where: { $0.id == model.ambulatoryId }) {
            return match.name
        }
        return model.ambulatoryId.isEmpty ? "Tutti gli ambulatori" : model.ambulatoryId
    }

    /// A labelled identity fact, as a pair rather than a sentence.
    ///
    /// These were single strings — "Codice fiscale: …L0002X" — so the label and
    /// the value shared one typographic register and the eye had to parse a
    /// colon to tell them apart. Split, the label recedes and the value, which
    /// is what gets read and compared, stands in the monospaced register the
    /// rest of the chart uses for codes.
    private func headerIdentityRow(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
                .frame(width: 104, alignment: .leading)
            Text(value)
                .font(.subheadline)
                .registro()
                .foregroundStyle(.primary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }



    /* @Codex */
    private var patientSectionPicker: some View {
        Menu {
            Picker("Sezione clinica", selection: $model.activePatientSection) {
                ForEach(PatientWorkspaceSection.allCases) { section in
                    Label(section.title, systemImage: section.symbolName).tag(section)
                }
            }
        } label: {
            HStack(spacing: 10) {
                Label(model.activePatientSection.title, systemImage: model.activePatientSection.symbolName)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 8)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
            }
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .menuStyle(.borderlessButton)
        .padding(.horizontal, 20)
        .padding(.bottom, 8)
        .background(PlatformColors.groupedBackground)
        .accessibilityLabel("Sezione clinica")
        .accessibilityValue(model.activePatientSection.title)
        .accessibilityHint("Scegli la sezione della cartella da consultare.")
        .accessibilityIdentifier("patient-section-picker")
    }

    /* @Codex */
    private var populatedPatientSections: [(section: PatientWorkspaceSection, count: Int)] {
        // These are loaded records, not totals: paired list routes can be bounded.
        let sections: [(section: PatientWorkspaceSection, count: Int)] = [
            (.diary, model.entries.count),
            (.therapies, model.therapies.count),
            (.clinical, model.checkups.count + model.observations.count),
            (.prescriptions, model.servicePrescriptions.count + model.prostheticPrescriptions.count)
        ]
        return sections.filter { $0.count > 0 }
    }

    /* @Codex */
    private var patientContents: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("In questa cartella")
                .font(.headline)
                .accessibilityHeading(.h2)
            ForEach(populatedPatientSections, id: \.section) { item in
                patientSectionLink(item.section, status: "\(item.count) caricati")
            }
            if capabilities.hasCapability("network.replica.readonly-documents"),
               model.attachmentsLoadState != .loaded || !model.attachments.isEmpty {
                patientSectionLink(.documents, status: attachmentContentsStatus)
            }
        }
        .chartCard()
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("patient-chart-contents")
    }

    /* @Codex */
    private var attachmentContentsStatus: String {
        switch model.attachmentsLoadState {
        case .loaded: return model.attachments.isEmpty ? "Nessun documento" : "\(model.attachments.count) caricati"
        case .loading: return "Caricamento…"
        case .idle: return "Da consultare"
        case .failed: return "Lettura non riuscita"
        case .unavailable: return "Non disponibili"
        }
    }

    /* @Codex */
    private func patientSectionLink(_ section: PatientWorkspaceSection, status: String) -> some View {
        Button {
            model.activePatientSection = section
        } label: {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Label(section.title, systemImage: section.symbolName)
                        .font(.subheadline.weight(.semibold))
                    Text(status)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right").font(.caption)
            }
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("patient-open-section-\(section.rawValue)")
    }

    private static var sectionSpacing: CGFloat { ClinicalChartMetrics.sectionSpacing }

    @ViewBuilder
    private func selectedPatientSections(_ detail: HomeBasePatientDetail) -> some View {
        VStack(alignment: .leading, spacing: Self.sectionSpacing) {
            // @Codex: Keep only the active clinical section in the reading pane.
            // Drafts and existing action bindings remain owned by the workspace/model.
            switch model.activePatientSection {
            case .overview:
            #if !os(macOS)
            patientContents
            #endif
            PairedPatientDetailSection(
                model: model,
                detail: detail,
                patientLifecycleSheet: $patientLifecycleSheet,
                icdQuery: $icdQuery,
                confirmsFHIRExport: $confirmsFHIRExport
            )
            .chartCard()
            case .diary:
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
            .chartCard()
            case .scales:
            PairedPatientScalesSection(
                model: model,
                presentingScale: $presentingScale
            )
            .chartCard()
            case .therapies:
            PairedPatientTherapiesSection(
                model: model,
                therapyStatusFilter: $therapyStatusFilter,
                confirmsDeletingTherapy: $confirmsDeletingTherapy,
                therapyDeletionCandidateId: $therapyDeletionCandidateId
            )
            .chartCard()
            case .clinical:
            PairedPatientClinicalSections(
                model: model,
                checkupStatusFilter: $checkupStatusFilter,
                confirmsDeletingCheckup: $confirmsDeletingCheckup,
                checkupDeletionCandidateId: $checkupDeletionCandidateId,
                confirmsDeletingObservation: $confirmsDeletingObservation,
                observationDeletionCandidateId: $observationDeletionCandidateId
            )
            .chartCard()
            case .prescriptions:
            PairedPatientPrescriptionSections(model: model)
                .chartCard()
            case .documents:
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
            .chartCard()
            }
        }
        .id(model.activePatientSection)
    }
}

private extension View {
    /// One card per section of the chart, all with the same padding, the same
    /// corner and the same surface. Applied per section rather than once around
    /// the lot: a single envelope made the whole chart read as one object, and
    /// nesting the two produced a card inside a card.
    /// A section card, on the platform's own content surface.
    ///
    /// This used the Lume `field` register when that token was `#f5f5f4` — very
    /// slightly warm. On its own that is invisible; sitting on the system's
    /// grouped background, which is slightly *blue*, the temperature difference
    /// is what made every card read as cream, paper, bone.
    ///
    /// The answer at the time was to leave the token alone, because the web
    /// shares it under a parity test, and to reach for the semantic content
    /// background here instead. That fixed the Mac and left the warmth on the
    /// web, which is where it kept being seen.
    ///
    /// The token has since been corrected at the source: the giorno register was
    /// the only one whose ramp changed temperature as it rose, from −5 and −4 at
    /// chrome and canvas to +1 at field and +4 at focal, while both dark
    /// registers stay cool throughout and grow cooler. `field` is now `#f4f6f8`
    /// and `focal` `#fbfcfe`, so the whole ramp is cool and the workaround below
    /// is no longer load-bearing. It is kept because the semantic colour still
    /// buys Increase Contrast for free on iOS; moving it to Lume `field` is now
    /// a free choice rather than a repair.
    @ViewBuilder
    func chartCard() -> some View {
        #if os(macOS)
        // @Codex: The reading pane is the clinical surface. A section needs
        // hierarchy and spacing, not a second full-width rounded envelope.
        frame(maxWidth: .infinity, alignment: .leading)
        #else
        padding(ClinicalChartMetrics.cardPadding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                PlatformColors.chartCardSurface,
                in: RoundedRectangle(
                    cornerRadius: ClinicalChartMetrics.cardRadius,
                    style: .continuous
                )
            )
        #endif
    }
}

#if os(macOS)
/* @Codex */
private struct MacPatientSectionNavigation: View {
    @Binding var selection: PatientWorkspaceSection

    var body: some View {
        ViewThatFits(in: .horizontal) {
            sectionRow(PatientWorkspaceSection.allCases)
            VStack(alignment: .leading, spacing: 8) {
                sectionRow([.overview, .diary, .therapies, .documents])
                sectionRow([.scales, .clinical, .prescriptions])
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Sezione clinica")
        .accessibilityIdentifier("patient-section-navigation")
    }

    private func sectionRow(_ sections: [PatientWorkspaceSection]) -> some View {
        HStack(spacing: 18) {
            ForEach(sections) { section in
                Button { selection = section } label: {
                    Text(shortTitle(section))
                        .font(.body.weight(selection == section ? .semibold : .regular))
                        .foregroundStyle(selection == section ? .primary : .secondary)
                        .padding(.vertical, 8)
                        .overlay(alignment: .bottom) {
                            Rectangle()
                                .fill(selection == section ? Color.accentColor : Color.clear)
                                .frame(height: 2)
                        }
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(section.title)
                .accessibilityAddTraits(selection == section ? .isSelected : [])
                .accessibilityIdentifier("patient-section-\(section.rawValue)")
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    private func shortTitle(_ section: PatientWorkspaceSection) -> String {
        switch section {
        case .diary: "Diario"
        case .scales: "Scale"
        case .clinical: "Controlli"
        default: section.title
        }
    }
}
#endif

/// Collapses the search field into a toolbar control where the system supports
/// it. `.minimize` is an iOS behaviour and is unavailable on macOS, where the
/// toolbar search field is already the native arrangement; on iOS before 26 the
/// standard field stays, which is the documented behaviour for those releases.
private struct MinimizedSearchToolbarBehavior: ViewModifier {
    @ViewBuilder
    func body(content: Content) -> some View {
        #if os(iOS)
        if #available(iOS 26.0, *) {
            content.searchToolbarBehavior(.minimize)
        } else {
            content
        }
        #else
        content
        #endif
    }
}

/// `compactContainerWidth` as a modifier, so a call site can decline it without
/// duplicating the view it wraps.
private struct CompactContainerWidth: ViewModifier {
    var isEnabled: Bool
    var inset: CGFloat = 0

    @ViewBuilder
    func body(content: Content) -> some View {
        if isEnabled {
            content.compactContainerWidth(inset: inset)
        } else {
            content
        }
    }
}

/* @Codex */
private extension View {
    @ViewBuilder
    func compactContainerWidth(inset: CGFloat = 0) -> some View {
        #if os(iOS)
        if #available(iOS 17.0, *) {
            containerRelativeFrame(.horizontal, alignment: .topLeading) { length, _ in
                max(0, length - inset)
            }
        } else {
            frame(maxWidth: .infinity, alignment: .topLeading)
        }
        #else
        frame(maxWidth: .infinity, alignment: .topLeading)
        #endif
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
