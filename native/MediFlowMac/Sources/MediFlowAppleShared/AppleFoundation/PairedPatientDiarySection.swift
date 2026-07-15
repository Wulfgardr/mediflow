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

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            /* @Codex */
            let headerLayout = dynamicTypeSize >= .accessibility1
                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 8))
                : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
            headerLayout {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Diario clinico", systemImage: "list.bullet.clipboard")
                        .font(.subheadline.weight(.semibold))
                    Text("Ultime \(PairedPatientsWorkspaceSupport.clinicalPreviewCap) voci")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
                if dynamicTypeSize < .accessibility1 {
                    Spacer(minLength: 8)
                }
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
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredDiaryEntries) { entry in
                    VStack(alignment: .leading, spacing: 4) {
                        let rowHeaderLayout = dynamicTypeSize >= .accessibility1
                            ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                            : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 6))
                        rowHeaderLayout {
                            Text(entry.title)
                                .font(.caption.weight(.semibold))
                                .strikethrough(entry.deletedAt != nil, color: .secondary)
                                .fixedSize(horizontal: false, vertical: true)
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
                        Text(ClinicalContentRendering.attributedString(from: entry.content))
                            .font(.caption)
                            .foregroundStyle(entry.deletedAt == nil ? .primary : .secondary)
                            .lineLimit(dynamicTypeSize >= .accessibility1 ? nil : 4)
                            .fixedSize(horizontal: false, vertical: true)
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
                        .padding(.leading, 14)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .modifier(LumeRigaListaModifier(isSelected: false))
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
