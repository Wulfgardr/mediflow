import SwiftUI

/* @Codex */
struct PairedPatientDetailSection: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let detail: HomeBasePatientDetail
    @Binding var patientLifecycleSheet: PatientLifecycleSheet?
    @Binding var icdQuery: String
    @Binding var confirmsFHIRExport: Bool

    // @Codex: navigation only; the patient editor and all writers keep their owners.
    @State private var overviewArea: PatientOverviewArea = .clinical

    private enum PatientOverviewArea: String, CaseIterable, Identifiable {
        case identity = "Anagrafica", clinical = "Clinica", administration = "Amministrazione"
        var id: String { rawValue }
    }

    private var showsIdentity: Bool {
        #if os(macOS)
        overviewArea == .identity
        #else
        true
        #endif
    }
    private var showsClinical: Bool {
        #if os(macOS)
        overviewArea == .clinical
        #else
        true
        #endif
    }
    private var showsAdministration: Bool {
        #if os(macOS)
        overviewArea == .administration
        #else
        true
        #endif
    }

    /// Groups now carry their own internal rhythm through `ChartGroup`, so the
    /// per-platform spacing constants this view used to keep are gone: 4 points
    /// on iOS against 8 on macOS was itself part of why the phone read as
    /// cramped.

    var body: some View {
        let exemptions = ExemptionCodesCodec.decode(detail.exemptions)
        let groupSpacing = ClinicalChartMetrics.groupSpacing
        return VStack(alignment: .leading, spacing: groupSpacing) {
            #if os(macOS)
            // @Codex: each area keeps a distinct reading purpose within the same chart.
            Picker("Dati della scheda", selection: $overviewArea) {
                ForEach(PatientOverviewArea.allCases) { area in
                    Text(area.rawValue).tag(area)
                }
            }
            .pickerStyle(.segmented)
            .accessibilityIdentifier("patient-overview-area-picker")
            #else
            // On iOS the card is titled by the patient, and the actions sit on
            // that line rather than above it.
            //
            // They used to be a five-cell grid stacked at the very top of the
            // chart: roughly 330 points of secondary controls before the reader
            // reached a single clinical fact. Editing is the one action taken
            // often enough to stay in view; archive, delete, FHIR export and the
            // regional handoff are occasional, and an occasional action belongs
            // behind an overflow rather than in front of the record.
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text("\(detail.lastName) \(detail.firstName)")
                    .chartCardTitle()
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("\(detail.lastName) \(detail.firstName)")
                    .accessibilityAddTraits(.isHeader)
                    .accessibilityIdentifier("patient-detail-name")
                Spacer(minLength: 8)
                primaryEditAction
                patientActionsOverflowMenu
            }
            #endif
            if detail.isAdi == true || detail.isArchived == true {
                HStack(spacing: 6) {
                    if detail.isAdi == true { PairedPatientFlagChip("ADI", tone: .info) }
                    if detail.isArchived == true { PairedPatientFlagChip("Archiviato", tone: .neutral) }
                }
            }
            /* @Codex: archive provenance belongs with the archived state. */
            if showsAdministration && detail.isArchived == true {
                ChartGroup("Archiviazione") {
                    if model.isPatientFieldLocked(.archiveReason) || model.isPatientFieldLocked(.archiveNote) {
                        Label("Alcuni dati di archiviazione sono protetti.", systemImage: "lock.fill")
                            .font(.callout)
                    }
                    if let reason = cleanedPatientWorkspaceValue(detail.archiveReason) {
                        Text(PairedPatientsWorkspaceModel.PatientArchiveReason(rawValue: reason)?.label ?? reason)
                            .font(.body)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let note = cleanedPatientWorkspaceValue(detail.archiveNote) {
                        Text(note).chartProse()
                    }
                    if detail.archiveReason == nil && detail.archiveNote == nil
                        && !model.isPatientFieldLocked(.archiveReason) && !model.isPatientFieldLocked(.archiveNote) {
                        Text("Motivazione non registrata.").chartMetadata()
                    }
                }
                .accessibilityIdentifier("patient-archive-details")
            }
            #if os(macOS)
            if showsIdentity { macPatientFacts }
            if showsAdministration {
                ChartGroup("Amministrazione") {
                    if let ambulatory = cleanedPatientWorkspaceValue(detail.ambulatoryId) {
                        macPatientFact("Ambulatorio", ambulatory, isCode: true)
                    }
                    macPatientFact("Stato", detail.isArchived == true ? "Archiviato" : "Attivo")
                }
                .accessibilityIdentifier("patient-administration-facts")
            }
            if showsClinical, let monitoring = cleanedPatientWorkspaceValue(detail.monitoringProfile) {
                ChartGroup("Monitoraggio") { Text(monitoring).chartProse() }
            }
            #else
            // Four groups, not one list of nine rows.
            //
            // Every identity field sat in a single stack four points apart, so
            // "Codice fiscale" was as close to "Data di nascita" as "Indirizzo"
            // was to "Ambulatorio" — and proximity therefore said nothing. These
            // fields are not one thing: who the patient is, how to reach them,
            // who is looking after them and what they are exempt from are four
            // separate questions a clinician asks at four different moments.
            // Grouping them is what lets the eye jump to the right one instead
            // of reading the column.
            ChartGroup("Identità") {
                InfoRow("Codice fiscale", detail.taxCode)
                if let birth = detail.birthDate {
                    InfoRow("Data di nascita", birthDateText(birth)) // @Codex
                }
            }

            let contacts: [(String, String)] = [
                ("Indirizzo", cleanedPatientWorkspaceValue(detail.address)),
                ("Telefono", cleanedPatientWorkspaceValue(detail.phone)),
            ].compactMap { label, value in value.map { (label, $0) } }
            if !contacts.isEmpty {
                ChartGroup("Contatti") {
                    ForEach(contacts, id: \.0) { InfoRow($0.0, $0.1) }
                }
            }

            let care: [(String, String)] = [
                ("Caregiver", cleanedPatientWorkspaceValue(detail.caregiver)),
                ("Ambulatorio", cleanedPatientWorkspaceValue(detail.ambulatoryId)),
                ("Monitoraggio", cleanedPatientWorkspaceValue(detail.monitoringProfile)),
            ].compactMap { label, value in value.map { (label, $0) } }
            if !care.isEmpty {
                ChartGroup("Presa in carico") {
                    ForEach(care, id: \.0) { InfoRow($0.0, $0.1) }
                }
            }
            // @Codex: Keep the existing bounded counts available after patient
            // facts, instead of starting every chart with six equally weighted tiles.
            DisclosureGroup("Riepilogo della cartella") {
                patientSignals(detail, exemptionsCount: exemptions.count)
                    .padding(.top, 12)
            }
            .padding(.vertical, 12)
            .accessibilityIdentifier("patient-clinical-signals-disclosure")
            #endif

            if showsClinical { patientReviewOverview }

            if showsAdministration && model.isPatientFieldLocked(.exemptions) {
                Label("Esenzioni protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                    .accessibilityIdentifier("patient-exemptions-locked")
            } else if showsAdministration && !exemptions.isEmpty {
                ChartGroup("Esenzioni · \(exemptions.count)") {
                    #if os(macOS)
                    // @Codex: Keep every code readable when the document narrows.
                    Text(exemptions.joined(separator: ", "))
                        .font(.body)
                        .registro()
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel("Esenzioni: \(exemptions.joined(separator: ", "))")
                    #else
                    // @Codex: Codes wrap as text rather than overflowing a row of chips.
                    Text(exemptions.joined(separator: ", "))
                    .font(.body)
                    .registro()
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Esenzioni: \(exemptions.joined(separator: ", "))")
                    #endif
                }
                .accessibilityIdentifier("patient-detail-exemptions")
            }
            #if os(macOS)
            if showsAdministration && exemptions.isEmpty && !model.isPatientFieldLocked(.exemptions) {
                Text("Nessuna esenzione registrata.").chartMetadata()
                    .accessibilityIdentifier("patient-exemptions-empty")
            }
            #endif
            // From here down the two platforms share one treatment. They used to
            // fork on every block — group heading and prose registers on macOS,
            // `.caption`/`.callout` inline on iOS — which is how iOS ended up
            // with headings that looked like field labels and prose that looked
            // like everything else. The registers are cross-platform now, so the
            // fork has nothing left to say.
            let diagnoses = DiagnosesCodec.decode(detail.diagnoses)
            if showsClinical && model.isPatientFieldLocked(.diagnoses) {
                Label("Diagnosi protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                    .accessibilityIdentifier("patient-diagnoses-locked")
            } else if showsClinical && !diagnoses.isEmpty {
                // The diagnoses are the clinical statement of who this patient
                // is. Set at callout, in the same face and size as an address,
                // they were the least prominent thing on a card that exists to
                // carry them. Code and description are separated because they
                // are read differently: the code is matched, the description read.
                ChartGroup("Diagnosi · \(diagnoses.count)") {
                    ForEach(Array(diagnoses.enumerated()), id: \.offset) { _, diagnosis in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            if !diagnosis.code.isEmpty {
                                ClinicalCodePill(diagnosis.code)
                            }
                            Text(diagnosis.description)
                                .font(.body)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .accessibilityElement(children: .combine)
                        .accessibilityLabel(diagnosis.displayText)
                    }
                }
                .accessibilityIdentifier("patient-detail-diagnoses")
            }
            #if os(macOS)
            if showsClinical && diagnoses.isEmpty && !model.isPatientFieldLocked(.diagnoses) {
                Text("Nessuna diagnosi registrata.").chartMetadata()
                    .accessibilityIdentifier("patient-diagnoses-empty")
            }
            #endif
            #if os(macOS)
            if showsClinical { macClinicalSummary }
            #endif
            if showsClinical, let aiSummary = cleanedPatientWorkspaceValue(detail.aiSummary) {
                ChartGroup("Sintesi AI", systemImage: "sparkles") {
                    Text(aiSummary).chartProse()
                }
                .accessibilityIdentifier("patient-detail-ai-summary")
            }
            if showsClinical, let documentInsights = cleanedPatientWorkspaceValue(detail.documentInsights) {
                ChartGroup("Analisi documenti", systemImage: "doc.text.magnifyingglass") {
                    Text(documentInsights).chartProse()
                }
                .accessibilityIdentifier("patient-detail-document-insights")
            }
            if showsAdministration, let statusReason = cleanedPatientWorkspaceValue(detail.statusReason) {
                Text(statusReason)
                    .chartMetadata()
            }
            if showsClinical, let notes = cleanedPatientWorkspaceValue(detail.notes) {
                ChartGroup("Note") {
                    Text(notes).chartProse()
                }
            }
            if model.isEditingPatient {
                Divider()
                patientEditForm
            }
        }
        .onChange(of: detail.id) { _ in overviewArea = .clinical }
    }

    /* @Codex: Read-only review signals from this patient's decrypted snapshot.
       Opening the existing Documents section leaves its loading, permissions
       and explicit manual actions with the existing workspace/model. */
    @ViewBuilder
    private var patientReviewOverview: some View {
        if model.selectedPatient?.id == detail.id {
            let insights = DocumentInsightsCodec.decode(detail.documentInsights)
            let summary = PatientReviewQueueProjection.project(
                patientID: detail.id,
                insights: insights,
                followups: model.followupSuggestions,
                followupsAtLimit: PatientFollowupProjection.project(insights).count >= PatientFollowupProjection.defaultMax,
                documentReadState: reviewDocumentReadState,
                documentsPatientID: model.attachmentsPatientId,
                attachments: model.attachments
            )
            if !summary.rows.isEmpty {
                ChartGroup("Da rivedere") {
                    ForEach(summary.rows) { row in
                        Button {
                            model.activePatientSection = .documents
                        } label: {
                            HStack(alignment: .center, spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(row.title).font(.subheadline.weight(.semibold))
                                    Text(row.detail)
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                                Spacer(minLength: 0)
                                Image(systemName: "chevron.right")
                                    .font(.caption)
                                    .accessibilityHidden(true)
                            }
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityElement(children: .combine)
                        .accessibilityHint("Apre Documenti")
                        .accessibilityIdentifier("patient-review-\(row.id.rawValue)")
                    }
                    if let note = summary.coverageNote {
                        Text(note).chartMetadata()
                    }
                }
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("patient-review-queue")
            }
        }
    }

    /* @Codex */
    private var reviewDocumentReadState: PatientReviewDocumentReadState {
        switch model.attachmentsLoadState {
        case .idle: .idle
        case .loading: .loading
        case .loaded: .loaded
        case .failed: .failed
        case .unavailable: .unavailable
        }
    }

    #if os(macOS)
    /* @Codex: Read the patient facts as a document. Collection counts are not
       load states; the workspace continues to own loading and error feedback. */
    private var macPatientFacts: some View {
        let contacts: [(label: String, value: String, isCode: Bool)] = [
            ("Indirizzo", cleanedPatientWorkspaceValue(detail.address), false),
            ("Telefono", cleanedPatientWorkspaceValue(detail.phone), true),
        ].compactMap { label, value, isCode in value.map { (label, $0, isCode) } }
        let care: [(label: String, value: String, isCode: Bool)] = [
            ("Caregiver", cleanedPatientWorkspaceValue(detail.caregiver), false),
        ].compactMap { label, value, isCode in value.map { (label, $0, isCode) } }
        let columns = dynamicTypeSize >= .accessibility1
            ? [GridItem(.flexible(), alignment: .topLeading)]
            : [GridItem(.adaptive(minimum: 240), spacing: 24, alignment: .topLeading)]

        return LazyVGrid(columns: columns, alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            ChartGroup("Identità") {
                macPatientFact("Codice fiscale", detail.taxCode, isCode: true)
                if let birth = detail.birthDate {
                    macPatientFact("Data di nascita", birthDateText(birth), isCode: true) // @Codex
                }
            }
            if !contacts.isEmpty {
                ChartGroup("Contatti") {
                    ForEach(contacts, id: \.label) { field in
                        macPatientFact(field.label, field.value, isCode: field.isCode)
                    }
                }
            }
            if !care.isEmpty {
                ChartGroup("Presa in carico") {
                    ForEach(care, id: \.label) { field in
                        macPatientFact(field.label, field.value, isCode: field.isCode)
                    }

                }
            }
        }
    }

    /* @Codex: read the existing bounded patient snapshot; links only navigate. */
    @ViewBuilder
    private var macClinicalSummary: some View {
        let active = model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }
        if !active.isEmpty {
            let count = ClinicalSignalCount.fromLoadedList(count: active.count,
                loadedCount: model.therapies.count, limit: PairedPatientsWorkspaceSupport.clinicalPreviewCap)
            ChartGroup("Terapie attive · \(count.displayText)") {
                ForEach(Array(active.prefix(3))) { therapy in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(therapy.drugName).font(.body.weight(.medium))
                        Text(therapy.dosage).chartMetadata()
                    }
                    .fixedSize(horizontal: false, vertical: true)
                }
                Button("Apri terapie") { model.activePatientSection = .therapies }
                    .accessibilityIdentifier("patient-overview-open-therapies")
            }
            .accessibilityIdentifier("patient-overview-active-therapies")
        }
        if let next = model.checkups
            .filter({ $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() })
            .min(by: { $0.date < $1.date }) {
            ChartGroup("Prossimo follow-up") {
                nextFollowUpText(next)
                Button("Apri controlli") { model.activePatientSection = .clinical }
            }
            .accessibilityIdentifier("patient-next-followup")
        }
    }

    private func macPatientFact(_ label: String, _ value: String, isCode: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(label)
                .font(.callout)
                .foregroundStyle(.secondary)
            Group {
                if isCode {
                    Text(value).registro()
                } else {
                    Text(value)
                }
            }
            .font(.body)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
    #endif

    @ViewBuilder
    private var patientHeaderActions: some View {
        #if os(macOS)
        // Nothing: on macOS these actions are window toolbar items. Duplicated
        // inside the chart they formed a button grid that outweighed the
        // clinical content it sat above.
        EmptyView()
        #else
        patientHeaderActionsGrid
        #endif
    }

    /// Editing stays in view. It is the action a clinician reaches for while
    /// reading the card, and burying it would cost a tap on every correction.
    private var primaryEditAction: some View {
        Button {
            model.startEditingPatient()
        } label: {
            Label("Modifica", systemImage: "pencil")
                #if os(iOS)
                .font(.body)
                .padding(.horizontal, 12)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                #endif
        }
        .font(.caption)
        .labelStyle(.titleAndIcon)
        .disabled(model.isEditingPatient)
        .accessibilityIdentifier("edit-patient-button")
    }

    /// Everything a clinician does rarely: archive, delete, export, hand off.
    /// Full-length labels inside the menu, where there is room for them.
    private var patientActionsOverflowMenu: some View {
        Menu {
            if detail.isArchived == true {
                Button {
                    patientLifecycleSheet = .unarchive
                } label: {
                    Label("Riattiva", systemImage: "archivebox")
                }
                .disabled(!model.canUnarchivePatient)
                .accessibilityIdentifier("unarchive-patient-button")
            } else {
                Button {
                    patientLifecycleSheet = .archive
                } label: {
                    Label("Archivia", systemImage: "archivebox")
                }
                .disabled(!model.canArchivePatient)
                .accessibilityIdentifier("archive-patient-button")
            }
            Button {
                confirmsFHIRExport = true
            } label: {
                Label("Esporta FHIR", systemImage: "doc.badge.arrow.up")
            }
            .disabled(!model.canPrepareFHIRExport)
            .accessibilityIdentifier("patient-export-fhir-button")
            if let fhirURL = model.patientFHIRExportURL {
                ShareLink(item: fhirURL) {
                    Label("Condividi FHIR", systemImage: "square.and.arrow.up")
                }
                .accessibilityIdentifier("patient-share-fhir-button")
            }
            Button {
                Task { await model.openPrregHandoff() }
            } label: {
                Label("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
            }
            .accessibilityIdentifier("patient-prreg-handoff-button")
            Divider()
            Button(role: .destructive) {
                patientLifecycleSheet = .delete
            } label: {
                Label("Elimina", systemImage: "trash")
            }
            .disabled(!model.canSoftDeletePatient)
            .accessibilityIdentifier("soft-delete-patient-button")
        } label: {
            Label("Altre azioni", systemImage: "ellipsis.circle")
                .font(.caption)
                #if os(iOS)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                #endif
        }
        .labelStyle(.iconOnly)
        .accessibilityLabel("Altre azioni sul paziente")
        .accessibilityIdentifier("patient-actions-overflow")
    }

    private var patientHeaderActionsGrid: some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 132), spacing: 8, alignment: .leading)],
            alignment: .leading,
            spacing: 6
        ) {
            patientHeaderActionButtons
        }
    }

    @ViewBuilder
    private var patientHeaderActionButtons: some View {
        Button {
            model.startEditingPatient()
        } label: {
            patientHeaderActionLabel("Modifica", systemImage: "pencil")
        }
        .font(.caption)
        .disabled(model.isEditingPatient)
        .accessibilityIdentifier("edit-patient-button")
        if detail.isArchived == true {
            Button {
                patientLifecycleSheet = .unarchive
            } label: {
                patientHeaderActionLabel("Riattiva", systemImage: "archivebox")
            }
            .font(.caption)
            .disabled(!model.canUnarchivePatient)
            .accessibilityIdentifier("unarchive-patient-button")
        } else {
            Button {
                patientLifecycleSheet = .archive
            } label: {
                patientHeaderActionLabel("Archivia", systemImage: "archivebox")
            }
            .font(.caption)
            .disabled(!model.canArchivePatient)
            .accessibilityIdentifier("archive-patient-button")
        }
        Button(role: .destructive) {
            patientLifecycleSheet = .delete
        } label: {
            patientHeaderActionLabel("Elimina", systemImage: "trash")
        }
        .font(.caption)
        .disabled(!model.canSoftDeletePatient)
        .accessibilityIdentifier("soft-delete-patient-button")
        Button {
            confirmsFHIRExport = true
        } label: {
            patientHeaderActionLabel("Esporta FHIR", systemImage: "doc.badge.arrow.up")
        }
        .font(.caption)
        .disabled(!model.canPrepareFHIRExport)
        .accessibilityIdentifier("patient-export-fhir-button")
        if let fhirURL = model.patientFHIRExportURL {
            ShareLink(item: fhirURL) {
                patientHeaderActionLabel("Condividi FHIR", systemImage: "square.and.arrow.up")
                    .font(.caption)
            }
            .accessibilityIdentifier("patient-share-fhir-button")
        }
        Button {
            Task { await model.openPrregHandoff() }
        } label: {
            patientHeaderActionLabel("Prescrittivo regionale", systemImage: "arrow.up.forward.app")
        }
        .font(.caption)
        .accessibilityIdentifier("patient-prreg-handoff-button")
    }

    private func patientHeaderActionLabel(_ title: String, systemImage: String) -> some View {
        Label(title, systemImage: systemImage)
            .lineLimit(2)
            .multilineTextAlignment(.leading)
            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
    }

    /* @Codex: DOB preserves its stored civil day in every device time zone. */
    private func birthDateText(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "it_IT")
        formatter.calendar = PairedPatientsWorkspaceModel.patientBirthDateCalendar
        formatter.timeZone = formatter.calendar.timeZone
        formatter.dateStyle = .medium
        formatter.timeStyle = .none
        return formatter.string(from: date)
    }

    private var patientEditForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modifica anagrafica")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            // @Codex: keep the submitted fields stable until acknowledgement;
            // explicit cancellation and session lock retain their own controls.
            Group {
            TextField("Nome", text: $model.editPatientFirstName)
                .accessibilityIdentifier("edit-patient-firstName")
            TextField("Cognome", text: $model.editPatientLastName)
                .accessibilityIdentifier("edit-patient-lastName")
            TextField("Codice fiscale", text: $model.editPatientTaxCode)
                .accessibilityIdentifier("edit-patient-taxCode")
            /* @Codex */
            Toggle("Data di nascita presente", isOn: Binding(
                get: { model.editPatientBirthDate != nil },
                set: { model.setPatientBirthDatePresent($0) }
            ))
            .disabled(model.isWorking)
            .accessibilityIdentifier("edit-patient-has-birthDate")
            if let birthDate = model.editPatientBirthDate {
                DatePicker("Data di nascita", selection: Binding(
                    get: { model.editPatientBirthDate ?? birthDate },
                    set: { model.editPatientBirthDate = $0 }
                ), displayedComponents: .date)
                .environment(\.calendar, PairedPatientsWorkspaceModel.patientBirthDateCalendar)
                .environment(\.timeZone, PairedPatientsWorkspaceModel.patientBirthDateCalendar.timeZone)
                .disabled(model.isWorking)
                .accessibilityIdentifier("edit-patient-birthDate")
            }
            /* @Codex */
            TextField("Indirizzo", text: $model.editPatientAddress)
                .accessibilityIdentifier("edit-patient-address")
                .disabled(model.isPatientFieldLocked(.address))
            TextField("Telefono", text: $model.editPatientPhone)
                .accessibilityIdentifier("edit-patient-phone")
                .disabled(model.isPatientFieldLocked(.phone))
            TextField("Caregiver", text: $model.editPatientCaregiver)
                .accessibilityIdentifier("edit-patient-caregiver")
                .disabled(model.isPatientFieldLocked(.caregiver))
            TextField("Note", text: $model.editPatientNotes, axis: .vertical)
                .accessibilityIdentifier("edit-patient-notes")
                .disabled(model.isPatientFieldLocked(.notes))
            if !model.lockedPatientFields.isEmpty {
                Label("Alcuni dati cifrati non sono disponibili e non verranno modificati.", systemImage: "lock.fill")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("edit-patient-locked-fields-message")
            }
            Toggle("Archiviato", isOn: $model.editPatientIsArchived)
                .disabled(model.isWorking) // @Codex
                .accessibilityIdentifier("edit-patient-archived")
            if model.editPatientIsArchived {
                PatientArchiveFields(model: model) // @Codex: same fields as the sheet.
            }
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
                            // Set exactly like the diagnoses above: the same
                            // pill, the same description register. A suggestion
                            // should look like the thing it is about to become,
                            // so you can see what you are adding before you add
                            // it. As one monospaced string the code and the
                            // description shared a face, and the description —
                            // which is prose — was typeset as though it were a
                            // code.
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                ClinicalCodePill(icd.code)
                                Text(icd.description)
                                    .font(.subheadline)
                                    .multilineTextAlignment(.leading)
                                    .fixedSize(horizontal: false, vertical: true)
                                Spacer(minLength: 4)
                                Image(systemName: "plus.circle")
                                    .foregroundStyle(.tint)
                            }
                            .padding(.vertical, 4)
                            .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Aggiungi \(icd.code), \(icd.description)")
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
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.diagnoses))

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
                            .registro()
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
            /* @Codex */
            .disabled(model.isPatientFieldLocked(.exemptions))
            }
            .disabled(model.isWorking)

            HStack(spacing: 10) {
                Button("Salva") {
                    Task { await model.savePatient() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(model.isWorking || model.patientArchiveValidationMessage(isArchived: model.editPatientIsArchived) != nil)
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
                                .registro()
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


    private func signalTile(_ icon: String, _ signal: ClinicalSignalCount, _ label: String) -> some View {
        let layout = dynamicTypeSize >= .accessibility1
            ? AnyLayout(HStackLayout(spacing: 6))
            : AnyLayout(VStackLayout(spacing: 2))
        return layout {
            Group {
                Image(systemName: icon)
                    #if os(macOS)
                    // The icon names the measure; the number is the thing being
                    // read. Same weight for both made the tile a uniform grey
                    // block where nothing led.
                    .font(.caption)
                    .foregroundStyle(.tint)
                    #else
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    #endif
                Text(signal.displayText)
                    #if os(macOS)
                    .font(.title3.weight(.semibold))
                    #else
                    .font(.callout.weight(.semibold))
                    #endif
                    .registro()
            }
            Text(label)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if dynamicTypeSize >= .accessibility1 {
                Spacer(minLength: 4)
            }
        }
        .frame(maxWidth: .infinity)
        #if os(macOS)
        .padding(.vertical, 10)
        // Concentric with the card that contains it: the card rounds at
        // ClinicalChartMetrics.cardRadius and insets its content by
        // cardPadding, so a tile flush with that inset rounds at the difference.
        // Given the same radius as its parent, a nested box reads as pasted on
        // rather than sitting inside.
        .background(
            Color.secondary.opacity(0.07),
            in: RoundedRectangle(cornerRadius: ClinicalChartMetrics.innerRadius, style: .continuous)
        )
        #else
        .padding(.vertical, 6)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
        #endif
    }

    // Quadro clinical-signals strip (parity with the web "segnali clinici"): counts
    // derived from the already-loaded collections + the next upcoming follow-up.
    /// Six tiles, so three columns divide evenly into two full rows at any chart
    /// width. The adaptive grid fitted five across and left "Esenzioni" alone on
    /// a second row, which reads as a mistake rather than as a group.
    private var signalTileColumns: [GridItem] {
        if dynamicTypeSize >= .accessibility1 { return [GridItem(.flexible())] }
        #if os(macOS)
        return Array(repeating: GridItem(.flexible(), spacing: 8), count: 3)
        #else
        return [GridItem(.adaptive(minimum: 84), spacing: 8)]
        #endif
    }

    @ViewBuilder
    private func patientSignals(_ detail: HomeBasePatientDetail, exemptionsCount: Int) -> some View {
        let cap = PairedPatientsWorkspaceSupport.clinicalPreviewCap
        let problemi = DiagnosesCodec.decode(detail.diagnoses).count
        let terapie = model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }.count
        let parametri = model.observations.filter { $0.deletedAt == nil }.count
        let diario = model.entries.filter { $0.deletedAt == nil }.count
        let scale = model.entries.filter { $0.deletedAt == nil && $0.type == "scale" }.count
        let nextCheckup = model.checkups
            .filter { $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() }
            .min(by: { $0.date < $1.date })
        VStack(alignment: .leading, spacing: 6) {
            LazyVGrid(
                columns: signalTileColumns,
                spacing: 8
            ) {
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
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        nextFollowUpText(next)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Image(systemName: "calendar.badge.clock")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        nextFollowUpText(next)
                    }
                }
                .accessibilityIdentifier("patient-next-followup")
            }
        }
    }

    private func nextFollowUpText(_ next: HomeBaseCheckupSummary) -> some View {
        Text("Prossimo follow-up: \(PairedPatientsWorkspaceSupport.birthDateFormatter.string(from: next.date)) · \(next.title)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

}
