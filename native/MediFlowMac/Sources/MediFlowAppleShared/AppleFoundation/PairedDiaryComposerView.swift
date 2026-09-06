import SwiftUI

/* @Codex: presentation only; drafts, validation and writes stay in the model. */
struct PairedDiaryComposerView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    #if os(macOS)
    @EnvironmentObject private var recording: VisitRecordingLumeCoordinator
    #endif
    @Binding var confirmsReplacingEntryTemplate: Bool
    @State private var isCreatingEntry = false
    @State private var hasOpenedVisitDraft = false
    @FocusState private var focusedTitle: TitleField?

    private enum TitleField: Hashable {
        case newEntry
        case editedEntry
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            if model.isWorking {
                ProgressView("Operazione in corso: attendi prima di modificare la voce.")
                    .accessibilityIdentifier("homebase-diary-operation-progress")
            }
            if model.isEditingEntry {
                editingForm
                Divider()
            }

            if isCreatingEntry {
                newEntryForm
            } else {
                Button {
                    isCreatingEntry = true
                } label: {
                    Label(hasPendingNewEntry ? "Riprendi nuova voce" : "Nuova voce", systemImage: "square.and.pencil")
                        .modifier(PairedDiaryControlLabel())
                }
                .disabled(model.isWorking)
                .accessibilityIdentifier("homebase-open-new-entry-button")
            }
        }
        .font(.body)
        .frame(maxWidth: .infinity, alignment: .leading)
        #if os(iOS)
        // @Codex: Separate writing from the chronology without changing draft ownership.
        .padding(.vertical, 12)
        .buttonStyle(.bordered)
        #endif
        // Keep the opened form mounted through save/error and while reading.
        // The workspace retains finalized recording review; hidden capture stops.
    }

    private var hasPendingNewEntry: Bool {
        !model.newEntryTitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || model.newEntryType != .note
            || !model.newEntryEditorDocument.isEffectivelyEmpty
            || !model.newEntryAttachmentIds.isEmpty
            || hasPendingVisitDraft
    }

    private var hasPendingVisitDraft: Bool {
        #if os(macOS)
        if recording.hasPendingReview { return true }
        #endif
        return !model.newEntryVisitTranscript.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || model.newEntryVisitDraftResponse != nil
    }

    private var editingForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Modifica voce", systemImage: "pencil")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            TextField("Titolo", text: $model.editEntryTitle)
                .focused($focusedTitle, equals: .editedEntry)
                .accessibilityLabel("Titolo")
                .accessibilityIdentifier("homebase-edit-entry-title-field")
            entryTypePicker(selection: $model.editEntryType, identifier: "homebase-edit-entry-type-picker")
            ClinicalRichTextEditorView(
                document: $model.editEntryEditorDocument,
                accessibilityPrefix: "homebase-edit-entry-content"
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("homebase-edit-entry-content-field")
            if capabilities.hasCapability("network.replica.readonly-documents") {
                attachmentReferences(
                    selectedIds: $model.editEntryAttachmentIds,
                    accessibilityPrefix: "homebase-edit-entry-attachments"
                )
            }
            if model.editingEntryRequiresReconciliation {
                reconciliationReview
            }
            PairedDiaryActions {
                Button {
                    model.cancelEditingEntry()
                } label: {
                    Text("Annulla modifica")
                        .modifier(PairedDiaryControlLabel())
                }
                .accessibilityIdentifier("homebase-cancel-edit-entry-button")
                Button {
                    Task { await model.updateEditingEntry() }
                } label: {
                    Label("Salva modifiche", systemImage: "checkmark.circle")
                        .modifier(PairedDiaryControlLabel())
                }
                .disabled(!model.canUpdateEditingEntry)
                .accessibilityIdentifier("homebase-update-entry-button")
            }
            Text("Disponibile solo online. In caso di conflitto, ricarica e confronta la voce corrente prima di confermare la bozza e salvare.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .disabled(model.isWorking)
        .onAppear { focusedTitle = .editedEntry }
    }

    // @Codex: The latest host entry is a read-only comparison; confirmation only
    // adopts its version. The draft and the final Save stay under user control.
    private var reconciliationReview: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Confronta prima di salvare", systemImage: "arrow.triangle.branch")
                .font(.headline)
                .accessibilityIdentifier("homebase-edit-entry-reconciliation")
            Text("La tua bozza qui sopra e conservata. Rivedi la voce corrente e correggi la bozza, poi conferma il confronto. Nulla viene salvato da questa conferma.")
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
            if let latest = model.editingEntryRemoteReview {
                Text("Voce corrente · versione \(latest.version)")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityIdentifier("homebase-edit-entry-remote-version")
                Text(latest.lockedFields.contains(.title) ? "Titolo non leggibile" : latest.title)
                    .font(.subheadline.weight(.semibold))
                    .fixedSize(horizontal: false, vertical: true)
                Text(latest.date, format: .dateTime.day().month(.abbreviated).year().hour().minute())
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Text("Tipo: \(PairedDiaryEntryType(rawValue: latest.type)?.title ?? latest.type)")
                    .font(.footnote)
                if latest.lockedFields.contains(.content) {
                    Text("Contenuto non leggibile con la chiave corrente.")
                } else {
                    Text(ClinicalContentRendering.attributedString(from: latest.content))
                        .chartProse()
                        .accessibilityIdentifier("homebase-edit-entry-remote-content")
                }
                if let references = latest.attachments {
                    Text("Allegati nella voce corrente: \(HomeBaseEntryAttachmentReferencesCodec.decode(references).count)")
                        .font(.footnote)
                } else {
                    Text("Riferimenti agli allegati non disponibili nella lettura corrente.")
                        .font(.footnote)
                }
                if latest.deletedAt != nil {
                    Text("La voce e stata eliminata. La bozza resta disponibile, ma non puo aggiornare questa voce.")
                        .foregroundStyle(.secondary)
                }
                Button {
                    model.confirmEditingEntryReconciliation()
                } label: {
                    Text("Ho confrontato: mantieni la mia bozza")
                        .modifier(PairedDiaryControlLabel())
                }
                .disabled(!model.canConfirmEditingEntryReconciliation)
                .accessibilityIdentifier("homebase-edit-entry-confirm-reconciliation-button")
            } else {
                Text("Ricarica la voce corrente per confrontarla. Se non e disponibile nella lettura, il salvataggio resta sospeso e la bozza rimane qui.")
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Task { await model.reloadAfterConflict() }
            } label: {
                Label("Ricarica per confrontare", systemImage: "arrow.clockwise")
                    .modifier(PairedDiaryControlLabel())
            }
            .accessibilityIdentifier("homebase-edit-entry-reload-for-review-button")
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
    }

    private var newEntryForm: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Nuova voce", systemImage: "square.and.pencil")
                .font(.headline)
                .accessibilityAddTraits(.isHeader)
            TextField("Titolo (opzionale)", text: $model.newEntryTitle)
                .disabled(model.isWorking)
                .focused($focusedTitle, equals: .newEntry)
                .accessibilityLabel("Titolo (opzionale)")
                .accessibilityIdentifier("homebase-new-entry-title-field")
            entryTypePicker(selection: $model.newEntryType, identifier: "homebase-new-entry-type-picker")
                .disabled(model.isWorking)
            Button {
                if model.newEntryEditorDocument.isEffectivelyEmpty {
                    model.insertNewEntrySOAPTemplate()
                } else {
                    confirmsReplacingEntryTemplate = true
                }
            } label: {
                Label("Template S/O/A/P", systemImage: "doc.text")
                    .modifier(PairedDiaryControlLabel())
            }
            .disabled(model.isWorking)
            .accessibilityIdentifier("homebase-new-entry-soap-template-button")
            ClinicalRichTextEditorView(
                document: $model.newEntryEditorDocument,
                accessibilityPrefix: "homebase-new-entry-content"
            )
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("homebase-new-entry-content-field")
            .disabled(model.isWorking)
            if capabilities.hasCapability("network.replica.readonly-documents") {
                Divider()
                attachmentReferences(
                    selectedIds: $model.newEntryAttachmentIds,
                    accessibilityPrefix: "homebase-new-entry-attachments"
                )
                .disabled(model.isWorking)
            }
            if capabilities.hasCapability("network.compute.visit-draft") {
                Divider()
                // Opening is one-way for this mounted composer: collapsing the
                // recording shell would cancel its local capture/review lifecycle.
                if hasOpenedVisitDraft {
                    VisitDraftComposerView(model: model)
                } else {
                    Button {
                        hasOpenedVisitDraft = true
                    } label: {
                        Label(hasPendingVisitDraft ? "Riprendi bozza da trascrizione" : "Bozza da trascrizione", systemImage: "waveform")
                            .modifier(PairedDiaryControlLabel())
                    }
                    .disabled(model.isWorking)
                    .accessibilityIdentifier("homebase-open-visit-draft-button")
                }
            } else if let message = capabilities.unavailableMessage(for: "network.compute.visit-draft") {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button {
                Task { await model.createEntryForSelectedPatient() }
            } label: {
                Label("Salva voce", systemImage: "checkmark.circle")
                    .modifier(PairedDiaryControlLabel())
            }
            .disabled(!model.canCreateEntry)
            .accessibilityIdentifier("homebase-create-entry-button")
            Text("Disponibile solo online: se il Mac non risponde, la voce non viene accodata.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .onAppear { focusedTitle = .newEntry }
    }

    /* @Codex: disclosure changes visibility only; the selected IDs stay model-owned. */
    private func attachmentReferences(selectedIds: Binding<Set<String>>, accessibilityPrefix: String) -> some View {
        DisclosureGroup {
            EntryAttachmentReferencePicker(
                attachments: model.attachments,
                selectedIds: selectedIds,
                accessibilityPrefix: accessibilityPrefix
            )
        } label: {
            let count = selectedIds.wrappedValue.count
            Label("Allegati · \(count) \(count == 1 ? "selezionato" : "selezionati")", systemImage: "paperclip")
                .modifier(PairedDiaryControlLabel())
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(accessibilityPrefix)-disclosure")
    }

    private func entryTypePicker(selection: Binding<PairedDiaryEntryType>, identifier: String) -> some View {
        Picker("Tipo", selection: selection) {
            ForEach(PairedDiaryEntryType.allCases) { type in
                Text(type.title).tag(type)
            }
        }
        .pickerStyle(.menu)
        .accessibilityIdentifier(identifier)
    }
}

/* @Codex: touch targets grow with text; macOS keeps native control density. */
struct PairedDiaryControlLabel: ViewModifier {
    func body(content: Content) -> some View {
        #if os(iOS)
        content
            .font(.body)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 8)
            .frame(minWidth: 44, minHeight: 44, alignment: .leading)
            .contentShape(Rectangle())
        #else
        content
            .font(.subheadline)
            .fixedSize(horizontal: false, vertical: true)
        #endif
    }
}

/* @Codex: controls can stack before accessibility sizes when the column is narrow. */
struct PairedDiaryActions<Content: View>: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    private let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 8) { content }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 12) { content }
                    .fixedSize(horizontal: true, vertical: false)
                VStack(alignment: .leading, spacing: 8) { content }
            }
        }
    }
}
