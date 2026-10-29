import SwiftUI

struct PairedPatientDetailSection: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ObservedObject var model: PairedPatientsWorkspaceModel
    let detail: HomeBasePatientDetail
    @Binding var patientLifecycleSheet: PatientLifecycleSheet?
    @Binding var icdQuery: String
    @Binding var confirmsFHIRExport: Bool

    var onOpenSummary: ((PatientChartSummaryCategory) -> Void)? = nil
    var summaryReturn: PatientChartSummaryReturn? = nil
    #if os(iOS)
    @Environment(\.patientChartScrollMemory) private var scrollMemory
    @AccessibilityFocusState(for: .voiceOver) private var focusedSummaryCategory: PatientChartSummaryCategory?
    #endif

    private var showsIdentity: Bool { true }
    private var showsClinical: Bool { true }
    private var showsAdministration: Bool { true }

    /// Groups now carry their own internal rhythm through `ChartGroup`, so the
    /// per-platform spacing constants this view used to keep are gone: 4 points
    /// on iOS against 8 on macOS was itself part of why the phone read as
    /// cramped.

    var body: some View {
        #if os(iOS)
        mobilePatientChart
        #else
        desktopPatientChart
        #endif
    }

    #if os(macOS)
    private var desktopPatientChart: some View {
        let exemptionRead = PatientStructuredFields.exemptions(detail.exemptions)
        let exemptions = exemptionRead.values ?? []
        let groupSpacing = ClinicalChartMetrics.groupSpacing
        return VStack(alignment: .leading, spacing: groupSpacing) {
            #if !os(macOS)
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
                    .inkVoice(28)
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
            /* archive provenance belongs with the archived state. */
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
                    InfoRow("Data di nascita", birthDateText(birth))
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
            // Keep the existing bounded counts available after patient
            // facts, instead of starting every chart with six equally weighted tiles.
            DisclosureGroup("Riepilogo della cartella") {
                patientSignals(detail)
                    .padding(.top, 12)
            }
            .padding(.vertical, 12)
            .accessibilityIdentifier("patient-clinical-signals-disclosure")
            #endif

            if showsClinical { patientReviewOverview }

            if showsAdministration && model.isPatientFieldLocked(.exemptions) {
                Label("Esenzioni protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                    .accessibilityIdentifier("patient-exemptions-locked")
            } else if showsAdministration && exemptionRead.isUnreadable {
                unreadableField("Esenzioni")
            } else if showsAdministration && !exemptions.isEmpty {
                ChartGroup("Esenzioni · \(exemptions.count)") {
                    #if os(macOS)
                    // Keep every code readable when the document narrows.
                    Text(exemptions.joined(separator: ", "))
                        .font(.body)
                        .registro()
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                    #else
                    // Codes wrap as text rather than overflowing a row of chips.
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
            if showsAdministration && exemptionRead.count == 0 && !model.isPatientFieldLocked(.exemptions) {
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
            let diagnosisRead = PatientStructuredFields.diagnoses(detail.diagnoses)
            let diagnoses = diagnosisRead.values ?? []
            if showsClinical && model.isPatientFieldLocked(.diagnoses) {
                Label("Diagnosi protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                    .accessibilityIdentifier("patient-diagnoses-locked")
            } else if showsClinical && diagnosisRead.isUnreadable {
                unreadableField("Diagnosi")
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
            if showsClinical && diagnosisRead.count == 0 && !model.isPatientFieldLocked(.diagnoses) {
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
                    if DocumentInsightsCodec.decodeResult(detail.documentInsights).isUnreadable {
                        unreadableField("Informazioni dai documenti")
                    } else { Text(documentInsights).chartProse() }
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
    }

    #endif

    /* Read-only review signals from this patient's decrypted snapshot.
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
    /* Read the patient facts as a document. Collection counts are not
       load states; the workspace continues to own loading and error feedback. */
    private var macPatientFacts: some View {
        let contacts: [(label: String, value: String, isCode: Bool)] = [
            ("Indirizzo", cleanedPatientWorkspaceValue(detail.address), false),
            ("Telefono", cleanedPatientWorkspaceValue(detail.phone), false),
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
                    macPatientFact("Data di nascita", birthDateText(birth), isCode: false)
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

    /* read the existing bounded patient snapshot; links only navigate. */
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
                    Text(value).codice()
                } else {
                    Text(value)
                }
            }
            .font(.body)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(value)")
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
            Group {
            #if os(iOS)
            Text("Modifica")
            #else
            Label("Modifica", systemImage: "pencil")
            #endif
            }
                #if os(iOS)
                .font(.body)
                .fixedSize(horizontal: true, vertical: false)
                .padding(.horizontal, 12)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
                #endif
        }
        .font(.caption)
        .labelStyle(.titleAndIcon)
        .disabled(model.isEditingPatient)
        .accessibilityLabel("Modifica paziente")
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

    /* DOB preserves its stored civil day in every device time zone. */
    private func birthDateText(_ date: Date) -> String {
        ClinicalDatePresentation.birthDate.string(from: date)
    }

    private var patientEditForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Modifica anagrafica")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            // keep the submitted fields stable until acknowledgement;
            // explicit cancellation and session lock retain their own controls.
            Group {
            TextField("Nome", text: $model.editPatientFirstName)
                .accessibilityIdentifier("edit-patient-firstName")
            TextField("Cognome", text: $model.editPatientLastName)
                .accessibilityIdentifier("edit-patient-lastName")
            TextField("Codice fiscale", text: $model.editPatientTaxCode)
                .accessibilityIdentifier("edit-patient-taxCode")
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
                .disabled(model.isWorking)
                .accessibilityIdentifier("edit-patient-archived")
            if model.editPatientIsArchived {
                PatientArchiveFields(model: model) // same fields as the sheet.
            }
            Toggle("ADI (assistenza domiciliare)", isOn: $model.editPatientIsAdi)
                .accessibilityIdentifier("edit-patient-adi")

            VStack(alignment: .leading, spacing: 4) {
                Text("Diagnosi")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if !model.isPatientFieldLocked(.diagnoses) && !model.canEditPatientField(.diagnoses) {
                    unreadableField("Diagnosi")
                }
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
            .disabled(!model.canEditPatientField(.diagnoses))

            VStack(alignment: .leading, spacing: 4) {
                Text("Esenzioni")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                if model.isPatientFieldLocked(.exemptions) {
                    Label("Esenzioni protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                        .font(.footnote).foregroundStyle(.secondary)
                } else if !model.canEditPatientField(.exemptions) {
                    unreadableField("Esenzioni")
                } else if model.editPatientExemptions.isEmpty {
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
            .disabled(!model.canEditPatientField(.exemptions))
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
                                .codice()
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


    private func unreadableField(_ field: String) -> some View {
        Label(PatientStructuredFields.unreadableMessage(field), systemImage: "lock.fill")
            .font(.footnote).foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
            .accessibilityIdentifier(field == "Diagnosi" ? "patient-diagnoses-unreadable" : (field == "Esenzioni" ? "patient-exemptions-unreadable" : "patient-document-insights-unreadable"))
    }

    @ViewBuilder
    private func structuredSignal(_ icon: String, _ count: Int?, _ field: String, locked: Bool) -> some View {
        if locked {
            Label("\(field): dato protetto", systemImage: "lock.fill").font(.footnote).foregroundStyle(.secondary)
        } else if let count {
            signalTile(icon, .exact(count), field)
        } else {
            unreadableField(field)
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
                    .foregroundStyle(PlatformColors.secondaryInk)
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
        #else
        .padding(.vertical, 6)
        #endif
        .overlay(alignment: .bottom) { PlatformColors.separator.frame(height: 1) }
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
    private func patientSignals(_ detail: HomeBasePatientDetail) -> some View {
        let cap = PairedPatientsWorkspaceSupport.clinicalPreviewCap
        let diagnosisRead = PatientStructuredFields.diagnoses(detail.diagnoses)
        let exemptionRead = PatientStructuredFields.exemptions(detail.exemptions)
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
                structuredSignal("cross.case", diagnosisRead.count, "Diagnosi", locked: model.isPatientFieldLocked(.diagnoses))
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
                structuredSignal("seal", exemptionRead.count, "Esenzioni", locked: model.isPatientFieldLocked(.exemptions))
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
        Text("Prossimo follow-up: \(ClinicalDatePresentation.day.string(from: next.date)) · \(next.title)")
            .font(.caption)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }

}

#if os(iOS)
private extension PairedPatientDetailSection {
    var mobilePatientChart: some View {
        let diagnosisRead = PatientStructuredFields.diagnoses(detail.diagnoses)
        let diagnoses = diagnosisRead.values ?? []
        let exemptionRead = PatientStructuredFields.exemptions(detail.exemptions)
        let exemptions = exemptionRead.values ?? []
        return VStack(alignment: .leading, spacing: 0) {
            mobilePatientHeader.padding(.bottom, 16)
            PatientChartGroup((model.isPatientFieldLocked(.diagnoses) || diagnosisRead.isUnreadable) ? "Diagnosi" : "Diagnosi · \(diagnoses.count)", anchorID: "patient-detail-diagnoses") {
                if model.isPatientFieldLocked(.diagnoses) {
                    Label("Diagnosi protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("patient-diagnoses-locked")
                } else if diagnosisRead.isUnreadable {
                    unreadableField("Diagnosi")
                } else if diagnoses.isEmpty {
                    Text("Nessuna diagnosi registrata.").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("patient-diagnoses-empty")
                } else {
                    ForEach(Array(diagnoses.enumerated()), id: \.offset) { _, diagnosis in
                        PatientChartField(label: diagnosis.code.isEmpty ? "Diagnosi" : diagnosis.code,
                            value: .recorded(diagnosis.description), labelIsCode: !diagnosis.code.isEmpty)
                            .accessibilityLabel(diagnosis.displayText)
                    }
                }
            }
            .accessibilityIdentifier("patient-detail-diagnoses")
            PatientChartGroup((model.isPatientFieldLocked(.exemptions) || exemptionRead.isUnreadable) ? "Esenzioni" : "Esenzioni · \(exemptions.count)", anchorID: "patient-detail-exemptions") {
                if model.isPatientFieldLocked(.exemptions) {
                    Label("Esenzioni protette. Sblocca la sessione per consultarle.", systemImage: "lock.fill")
                        .font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("patient-exemptions-locked")
                } else if exemptionRead.isUnreadable {
                    unreadableField("Esenzioni")
                } else if exemptions.isEmpty {
                    Text("Nessuna esenzione registrata.").font(.footnote).foregroundStyle(.secondary)
                        .accessibilityIdentifier("patient-exemptions-empty")
                } else {
                    Text(exemptions.joined(separator: ", "))
                        .font(.system(.body, design: .monospaced))
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityIdentifier("patient-detail-exemptions")
            PatientChartGroup("Riepilogo della cartella") {
                mobileChartCounts
            }
            mobileReviewOverview
            if let reason = cleanedPatientWorkspaceValue(detail.statusReason) {
                PatientChartGroup("Motivo dello stato") { PatientChartProse(text: reason) }
            }
            if model.isPatientFieldLocked(.notes) {
                PatientChartGroup("Note") {
                    PatientChartField(label: "Note", value: .protected)
                }
            } else if let notes = cleanedPatientWorkspaceValue(detail.notes) {
                PatientChartGroup("Note") { PatientChartProse(text: notes) }
            }
            if let summary = cleanedPatientWorkspaceValue(detail.aiSummary) {
                PatientChartGroup("Sintesi con IA") { PatientChartProse(text: summary) }
                    .accessibilityIdentifier("patient-detail-ai-summary")
            }
            if let insights = cleanedPatientWorkspaceValue(detail.documentInsights) {
                PatientChartGroup("Informazioni dai documenti") {
                    if DocumentInsightsCodec.decodeResult(detail.documentInsights).isUnreadable {
                        unreadableField("Informazioni dai documenti")
                    } else { PatientChartProse(text: insights) }
                }
                    .accessibilityIdentifier("patient-detail-document-insights")
            }
            if detail.isArchived == true {
                PatientChartGroup("Archiviazione") {
                    PatientChartField(label: "Motivo", value: .make(
                        detail.archiveReason.map { PairedPatientsWorkspaceModel.PatientArchiveReason(rawValue: $0)?.label ?? $0 },
                        isProtected: model.isPatientFieldLocked(.archiveReason)))
                    PatientChartField(label: "Nota", value: .make(detail.archiveNote,
                        isProtected: model.isPatientFieldLocked(.archiveNote)))
                }
                .accessibilityIdentifier("patient-archive-details")
            }
            PatientChartGroup("Dati anagrafici") {
                PatientChartField(label: "Codice fiscale", value: .make(detail.taxCode), isCode: true)
                PatientChartField(label: "Data di nascita", value: .make(detail.birthDate.map { birthDateText($0) }))
            }
            PatientChartGroup("Contatti") {
                PatientChartField(label: "Indirizzo", value: .make(detail.address,
                    isProtected: model.isPatientFieldLocked(.address)))
                PatientChartField(label: "Telefono", value: .make(detail.phone,
                    isProtected: model.isPatientFieldLocked(.phone)))
            }
            PatientChartGroup("Assistenza") {
                if detail.isAdi == true {
                    PatientChartField(label: "Modalità", value: .recorded("Assistenza domiciliare integrata"))
                }
                PatientChartField(label: "Persona di riferimento", value: .make(detail.caregiver,
                    isProtected: model.isPatientFieldLocked(.caregiver)))
                PatientChartField(label: "Ambulatorio", value: .make(ambulatoryName))
                PatientChartField(label: "Monitoraggio previsto", value: .make(detail.monitoringProfile))
            }
            if model.isEditingPatient {
                Divider()
                patientEditForm.padding(.top, 16)
            }
        }
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                primaryEditAction
                patientActionsOverflowMenu
            }
        }
    }

    var mobilePatientHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(detail.lastName) \(detail.firstName)")
                .inkVoice(28)
                .dynamicTypeSize(...DynamicTypeSize.accessibility1)
                .lineLimit(2)
                .accessibilityAddTraits(.isHeader)
                .accessibilityIdentifier("patient-detail-name")
            Text(PairedPatientsWorkspaceSupport.patientMetadata(birthDate: detail.birthDate, taxCode: detail.taxCode))
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("patient-detail-metadata")
            if detail.isArchived == true {
                Text("Archiviato").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            }
        }
        .background {
            GeometryReader { geometry in
                Color.clear.preference(key: PatientChartHeaderHiddenKey.self,
                    value: geometry.frame(in: .named("patient-chart-scroll")).maxY <= 0)
            }
        }
    }


    var ambulatoryName: String? {
        guard let id = cleanedPatientWorkspaceValue(detail.ambulatoryId) else { return nil }
        return model.availableAmbulatories.first { $0.id == id }?.name ?? id
    }

    @ViewBuilder
    var mobileReviewOverview: some View {
        if model.selectedPatient?.id == detail.id {
            let insights = DocumentInsightsCodec.decode(detail.documentInsights)
            let summary = PatientReviewQueueProjection.project(
                patientID: detail.id, insights: insights, followups: model.followupSuggestions,
                followupsAtLimit: PatientFollowupProjection.project(insights).count >= PatientFollowupProjection.defaultMax,
                documentReadState: reviewDocumentReadState,
                documentsPatientID: model.attachmentsPatientId, attachments: model.attachments)
            if !summary.rows.isEmpty {
                PatientChartGroup("Da rivedere") {
                    ForEach(summary.rows) { row in
                        Button { model.activePatientSection = .documents } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(row.title).font(.body.weight(.semibold))
                                Text(row.detail).font(.footnote).foregroundStyle(.secondary)
                            }
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Apre Documenti")
                        .accessibilityIdentifier("patient-review-\(row.id.rawValue)")
                    }
                    if let note = summary.coverageNote {
                        Text(note).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .accessibilityIdentifier("patient-review-queue")
            }
        }
    }

    func mobileChartCount(for category: PatientChartSummaryCategory) -> ClinicalSignalCount {
        let cap = PairedPatientsWorkspaceSupport.clinicalPreviewCap
        switch category {
        case .therapies:
            return .fromLoadedList(count: model.therapies.filter { $0.deletedAt == nil && $0.status == "active" }.count,
                loadedCount: model.therapies.count, limit: cap)
        case .measures:
            return .fromLoadedList(count: model.observations.filter { $0.deletedAt == nil }.count,
                loadedCount: model.observations.count, limit: cap)
        case .diary:
            return .fromLoadedList(count: model.entries.filter { $0.deletedAt == nil }.count,
                loadedCount: model.entries.count, limit: cap)
        case .scales:
            return .fromLoadedList(count: model.entries.filter { $0.deletedAt == nil && $0.type == "scale" }.count,
                loadedCount: model.entries.count, limit: cap)
        }
    }

    var mobileChartCounts: some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(PatientChartSummaryCategory.allCases) { category in
                let count = mobileChartCount(for: category)
                Button {
                    if let onOpenSummary { onOpenSummary(category) }
                    else { model.activePatientSection = category.destination }
                } label: {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(category.title).font(.body)
                        Spacer(minLength: 8)
                        Text(count.displayText).font(.body.weight(.semibold)).monospacedDigit()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .accessibilityHidden(true)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(.primary)
                .accessibilityLabel(category.accessibilityLabel(count: count))
                .accessibilityIdentifier("patient-summary-\(category.id)")
                .accessibilityFocused($focusedSummaryCategory, equals: category)
                .background {
                    if let scrollMemory {
                        PatientChartScrollAnchor(patientID: detail.id,
                            id: "patient-summary-\(category.id)", memory: scrollMemory)
                    }
                }
            }
            if let next = model.checkups.filter({ $0.deletedAt == nil && $0.status == "pending" && $0.date >= Date() })
                .min(by: { $0.date < $1.date }) {
                Text("Prossimo controllo: \(ClinicalDatePresentation.day.string(from: next.date)) · \(next.title)")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("patient-clinical-signals")
        .task(id: summaryReturn) {
            focusedSummaryCategory = nil
            guard let summaryReturn, summaryReturn.patientID == detail.id,
                  model.activePatientSection == .overview else { return }
            await Task.yield()
            guard !Task.isCancelled else { return }
            focusedSummaryCategory = summaryReturn.category
        }
    }
}
#endif
