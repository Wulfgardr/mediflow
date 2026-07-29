import SwiftUI

/* @Codex */
struct PairedPatientDiarySection: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @Binding var entryTypeFilter: EntryTypeFilter
    @Binding var showsDeletedDiaryEntries: Bool
    @Binding var confirmsReplacingEntryTemplate: Bool
    @Binding var entryDeletionCandidate: HomeBaseEntrySummary?
    @Binding var presentingScale: ClinicalScaleDefinition?
    @Binding var attachmentDetailCandidate: HomeBaseAttachmentSummary?

    /// Title on one line, controls on one line, and the two only share a row when
    /// the column is actually wide enough. Forced into a single row the header had
    /// to sacrifice something: first the title wrapped onto two lines, then
    /// "Aggiorna" and "Valutazione" truncated to "Aggior..." and "Valuta...".
    /// Neither is a decision worth taking on the reader's behalf.
    @ViewBuilder
    private var diaryHeader: some View {
        if dynamicTypeSize >= .accessibility1 {
            VStack(alignment: .leading, spacing: 8) {
                diaryHeaderTitle
                diaryHeaderControls
            }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    diaryHeaderTitle
                    Spacer(minLength: 8)
                    diaryHeaderControls
                }
                VStack(alignment: .leading, spacing: 8) {
                    diaryHeaderTitle
                    diaryHeaderControls
                }
                // Last rung, and the one a phone actually lands on. "Valutazione"
                // stays in view with the filter: it is the diary's own way of
                // adding a record, and the first arrangement of this rung hid it
                // in the overflow — which the scale test caught immediately.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    diaryHeaderTitle
                    Spacer(minLength: 8)
                    diaryScaleMenu
                    diaryOverflowMenu
                    diaryTypeFilter
                }
                // And a floor beneath it. `ViewThatFits` keeps its *last*
                // candidate whatever the width, so the last one must be the one
                // that cannot overflow — otherwise a rung that nearly fits takes
                // the whole card off the screen with it, which is the failure
                // this ladder exists to prevent.
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    diaryHeaderTitle
                    Spacer(minLength: 8)
                    diaryScaleMenu
                        .labelStyle(.iconOnly)
                    diaryOverflowMenu
                    diaryTypeFilter
                        .labelStyle(.iconOnly)
                }
            }
        }
    }

    private var diaryHeaderTitle: some View {
        VStack(alignment: .leading, spacing: 2) {
            ClinicalSectionTitle("Diario clinico", systemImage: "list.bullet.clipboard", accent: .diario)
            Text("Ultime \(PairedPatientsWorkspaceSupport.clinicalPreviewCap) voci")
                .chartMetadata()
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    @ViewBuilder
    private var diaryHeaderControls: some View {
        HStack(spacing: 8) {
            diaryRefreshButton
            diaryScaleMenu
            diaryTypeFilter
            diaryDeletedToggle
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    /// Housekeeping, folded into one button. Reloading the list and revealing
    /// deleted entries are things you do to the view; starting a scale writes a
    /// clinical record, and an action that writes to the chart does not belong
    /// behind an ellipsis.
    ///
    /// `.fixedSize` on the controls row above is what makes the ladder honest —
    /// it stops the row compressing and reports its true width so `ViewThatFits`
    /// can judge. But with four controls, one of them a labelled Toggle, that
    /// width is about 430 points and no rung fitted a phone. `ViewThatFits` then
    /// kept its last candidate at full width, the header widened the whole diary
    /// card, and every row in it was clipped at the screen edge: dates lost their
    /// minutes, the segmented control lost "Altro", the formatting bar ran off
    /// into nothing.
    private var diaryOverflowMenu: some View {
        Menu {
            diaryRefreshButton
            diaryDeletedToggle
        } label: {
            Label("Azioni diario", systemImage: "ellipsis.circle")
                .font(.caption)
        }
        .labelStyle(.iconOnly)
        .accessibilityLabel("Azioni diario")
        .accessibilityIdentifier("diary-actions-overflow")
    }

    private var diaryRefreshButton: some View {
        Button {
            Task { await model.loadSelectedPatientEntries() }
        } label: {
            Label("Aggiorna", systemImage: "arrow.clockwise")
        }
        .font(.caption)
        .disabled(model.isWorking || model.selectedPatient == nil)
        .accessibilityIdentifier("homebase-refresh-entries-button")
    }

    private var diaryScaleMenu: some View {
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
    }

    /// Stays visible at every width: it states which entries the list below is
    /// showing, which is not something to hide behind a button.
    private var diaryTypeFilter: some View {
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

    private var diaryDeletedToggle: some View {
        Toggle("Mostra eliminate", isOn: $showsDeletedDiaryEntries)
            .font(.caption)
            .disabled(model.entries.allSatisfy { $0.deletedAt == nil })
            .accessibilityIdentifier("show-deleted-entries-toggle")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            diaryHeader

            if model.entries.isEmpty {
                Text("Nessuna voce diario caricata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else if filteredDiaryEntries.isEmpty {
                Text("Nessuna voce per questo filtro.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredDiaryEntries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        let rowHeaderLayout = dynamicTypeSize >= .accessibility1
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 6))
                        rowHeaderLayout {
                            if entry.lockedFields.contains(.title) {
                                Label("Titolo non leggibile", systemImage: "lock")
                                    .chartRowTitle()
                                    .foregroundStyle(.secondary)
                            } else {
                                Text(entry.title)
                                    .chartRowTitle()
                                    .strikethrough(entry.deletedAt != nil, color: .secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                            if let type = PairedDiaryEntryType(rawValue: entry.type) {
                                PairedPatientFlagChip(type.title, tone: .info)
                            }
                            if entry.deletedAt != nil {
                                PairedPatientFlagChip("Eliminata", tone: .attention)
                            }
                            if dynamicTypeSize < .accessibility1 {
                                Spacer(minLength: 8)
                            }
                            Text(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: entry.date))
                                .font(.caption2)
                                .registro()
                                .foregroundStyle(.secondary)
                        }
                        if entry.lockedFields.contains(.content) {
                            // Says what is true: the note exists on the host, this
                            // device cannot read it. A blank line here reads as a
                            // visit with nothing written down.
                            Text("Contenuto cifrato non leggibile con la chiave di questa sessione. La voce esiste sull'home-base.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("entry-content-locked-\(entry.id)")
                        } else {
                            Text(ClinicalContentRendering.attributedString(from: entry.content))
                                .font(.caption)
                                .foregroundStyle(entry.deletedAt == nil ? .primary : .secondary)
                                .lineLimit(dynamicTypeSize >= .accessibility1 ? nil : 4)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        // S7 (D4): resolves the entry's referenced attachment ids
                        // against the loaded patient attachment list (S6), same
                        // pairing as the web timeline-entry-card. An id that does
                        // not resolve (Documenti section not loaded yet, or the
                        // attachment is gone) is simply omitted, never shown raw.
                        let entryAttachments = model.referencedAttachments(for: entry)
                        if !entryAttachments.isEmpty {
                            let attachmentLayout = dynamicTypeSize >= .accessibility1
                                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                                : AnyLayout(HStackLayout(spacing: 6))
                            attachmentLayout {
                                Image(systemName: "paperclip")
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                Filo(axis: .horizontal, isConnected: true, tone: .inkMuted)
                                    .frame(width: 18, height: 2)
                                ForEach(entryAttachments) { attachment in
                                    /* @Codex */
                                    Button {
                                        attachmentDetailCandidate = attachment
                                        Task { await model.openAttachmentDetail(attachment) }
                                    } label: {
                                        Text("\(attachment.name.isEmpty ? "Documento" : attachment.name) (\(attachment.type))")
                                            .font(.caption2)
                                            .foregroundStyle(.secondary)
                                            .lineLimit(dynamicTypeSize >= .accessibility1 ? nil : 1)
                                            .fixedSize(horizontal: false, vertical: true)
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityIdentifier("entry-row-attachment-\(entry.id)-\(attachment.id)")
                                }
                            }
                            .accessibilityIdentifier("entry-row-attachments-\(entry.id)")
                        }
                        if let deletedAt = entry.deletedAt {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Eliminata il \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: deletedAt))")
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
                            let actionLayout = dynamicTypeSize >= .accessibility1
                                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                                : AnyLayout(HStackLayout(spacing: 8))
                            actionLayout {
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
                        .modifier(LumeRigaListaModifier(isSelected: false))
                        // The leading inset goes *outside* the row surface, so the
                        // Filo runs in a clear channel beside the entries. Inside
                        // it, the row background painted across the thread and
                        // left it showing only in the gaps — a continuous
                        // connector rendered as a column of stubs.
                        .padding(.leading, 14)
                        .accessibilityIdentifier("entry-row-\(entry.id)")
                    }
                }
                .background(alignment: .leading) {
                    Filo(axis: .vertical, isConnected: true, tone: .minerale)
                        .frame(width: 2)
                        .padding(.vertical, 22)
                        .accessibilityHidden(true)
                }
            }

            if model.isEditingEntry {
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    Label("Modifica voce online", systemImage: "pencil")
                        .chartGroupHeading()
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
                    .chartGroupHeading()
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

    private var filteredDiaryEntries: [HomeBaseEntrySummary] {
        EntryFiltering.apply(
            model.entries,
            filter: entryTypeFilter,
            includeDeleted: showsDeletedDiaryEntries
        )
    }
}

/* @Codex */
struct PairedPatientScalesSection: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var presentingScale: ClinicalScaleDefinition?

    var body: some View {
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
}
