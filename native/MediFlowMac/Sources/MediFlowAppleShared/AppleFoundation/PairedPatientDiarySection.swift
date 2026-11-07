import SwiftUI

struct PairedPatientDiarySection: View {
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @ScaledMetric(relativeTo: .body) private var proseWidth: CGFloat = 480

    private var usesDiaryMargin: Bool {
        #if os(macOS)
        !dynamicTypeSize.isAccessibilitySize
        #else
        horizontalSizeClass == .regular && !dynamicTypeSize.isAccessibilitySize
        #endif
    }
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @ObservedObject var capabilities: ClinicalWorkspaceCapabilitiesStore
    @Binding var entryTypeFilter: EntryTypeFilter
    @Binding var showsDeletedDiaryEntries: Bool
    @Binding var confirmsReplacingEntryTemplate: Bool
    @Binding var isCreatingEntry: Bool
    @Binding var entryDeletionCandidate: HomeBaseEntrySummary?
    @Binding var presentingScale: ClinicalScaleDraft?
    @Binding var attachmentDetailCandidate: HomeBaseAttachmentSummary?

    /* the final layout keeps labels visible at narrow and AX widths. */
    @ViewBuilder
    private var diaryHeader: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 12) {
                diaryHeaderTitle
                diaryRefreshButton
                diaryScaleMenu
                diaryTypeFilter
                diaryDeletedToggle
            }
        } else {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    diaryHeaderTitle
                    Spacer(minLength: 8)
                    diaryHeaderControls
                }
                VStack(alignment: .leading, spacing: 12) {
                    diaryHeaderTitle
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 12) {
                            diaryScaleMenu
                            diaryTypeFilter
                            diaryOverflowMenu
                        }
                        .fixedSize(horizontal: true, vertical: false)
                        VStack(alignment: .leading, spacing: 8) {
                            diaryScaleMenu
                            diaryTypeFilter
                            diaryOverflowMenu
                        }
                    }
                    if showsDeletedDiaryEntries {
                        Text("Incluse le voci eliminate")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
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
        .fixedSize(horizontal: false, vertical: true)
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

    // Refresh and deleted visibility remain view actions; scales stay visible.
    private var diaryOverflowMenu: some View {
        Menu {
            diaryRefreshButton
            diaryDeletedToggle
        } label: {
            Label("Azioni diario", systemImage: "ellipsis.circle")
                .font(.subheadline)
                .modifier(PairedDiaryControlLabel())
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
                .modifier(PairedDiaryControlLabel())
        }
        .font(.subheadline)
        // The ordinary refresh closes the editor. Conflict recovery uses
        // the dedicated comparison action in the composer, preserving its draft.
        .disabled(model.isWorking || model.selectedPatient == nil || model.isEditingEntry)
        .accessibilityIdentifier("homebase-refresh-entries-button")
    }

    private var diaryScaleMenu: some View {
        Menu {
            ForEach(ClinicalScales.all) { scale in
                Button {
                    presentingScale = model.makeScaleDraft(scale)
                } label: {
                    Text("\(scale.title) (\(scale.questions.count) domande)")
                }
                .accessibilityIdentifier("new-scale-option-\(scale.id)")
            }
        } label: {
            Label("Valutazione", systemImage: "checklist")
                .font(.subheadline)
                .modifier(PairedDiaryControlLabel())
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
                .font(.subheadline)
                .modifier(PairedDiaryControlLabel())
        }
        .accessibilityIdentifier("entry-type-filter")
    }

    private var diaryDeletedToggle: some View {
        Toggle("Mostra eliminate", isOn: $showsDeletedDiaryEntries)
            .font(.subheadline)
            .disabled(model.entries.allSatisfy { $0.deletedAt == nil })
            .accessibilityIdentifier("show-deleted-entries-toggle")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: ClinicalChartMetrics.groupSpacing) {
            diaryHeader

            if isCreatingEntry || model.isEditingEntry || model.isWorking {
                PairedDiaryComposerView(
                    model: model,
                    capabilities: capabilities,
                    confirmsReplacingEntryTemplate: $confirmsReplacingEntryTemplate,
                    isCreatingEntry: $isCreatingEntry
                )
            }

            if model.entries.isEmpty {
                Text("Nessuna voce diario caricata.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            } else if filteredDiaryEntries.isEmpty {
                Text("Nessuna voce per questo filtro.")
                    .font(.body)
                    .foregroundStyle(.secondary)
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(filteredDiaryEntries) { entry in
                    let rowLayout = usesDiaryMargin
                        ? AnyLayout(HStackLayout(alignment: .top, spacing: 16))
                        : AnyLayout(VStackLayout(alignment: .leading, spacing: 12))
                    rowLayout {
                        entryChronology(entry)
                        VStack(alignment: .leading, spacing: 8) {
                        VStack(alignment: .leading, spacing: 6) {
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
                            let metadataLayout = dynamicTypeSize.isAccessibilitySize
                                ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                                : AnyLayout(HStackLayout(spacing: 8))
                            metadataLayout {
                                if let type = PairedDiaryEntryType(rawValue: entry.type) {
                                    Text(type.title).inkRegister(weight: .semibold)
                                }
                                if let setting = entry.setting?.trimmingCharacters(in: .whitespacesAndNewlines), !setting.isEmpty {
                                    Text(setting).font(.caption).foregroundStyle(.secondary)
                                }
                                if entry.deletedAt != nil {
                                    PairedPatientFlagChip("Eliminata", tone: .attention)
                                }
                            }
                        }
                        if entry.lockedFields.contains(.content) {
                            // Says what is true: the note exists on the host, this
                            // device cannot read it. A blank line here reads as a
                            // visit with nothing written down.
                            Text("Contenuto cifrato non leggibile con la chiave di questa sessione. La voce esiste sull'home-base.")
                                .font(.callout)
                                .foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                                .accessibilityIdentifier("entry-content-locked-\(entry.id)")
                        } else {
                            ClinicalContentText(entry.content, foregroundStyle: entry.deletedAt == nil && !isCreatingEntry ? .primary : .secondary)
                                .inkVoice(17, relativeTo: .body)
                                .lineSpacing(5)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(minWidth: 0, maxWidth: proseWidth, alignment: .leading)
                                .accessibilityIdentifier("entry-prose-\(entry.id)")
                        }
                        // S7 (D4): resolves the entry's referenced attachment ids
                        // against the loaded patient attachment list (S6), same
                        // pairing as the web timeline-entry-card. An id that does
                        // not resolve (Documenti section not loaded yet, or the
                        // attachment is gone) is simply omitted, never shown raw.
                        let entryAttachments = model.referencedAttachments(for: entry)
                        if !entryAttachments.isEmpty {
                            VStack(alignment: .leading, spacing: 6) {
                                ForEach(entryAttachments) { attachment in
                                    Button {
                                        attachmentDetailCandidate = attachment
                                        Task { await model.openAttachmentDetail(attachment) }
                                    } label: {
                                        Label("\(attachment.name.isEmpty ? "Documento" : attachment.name) (\(attachment.type))", systemImage: "paperclip")
                                            .font(.subheadline)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .modifier(PairedDiaryControlLabel())
                                    }
                                    .accessibilityIdentifier("entry-row-attachment-\(entry.id)-\(attachment.id)")
                                }
                            }
                            .accessibilityIdentifier("entry-row-attachments-\(entry.id)")
                        }
                        HStack(spacing: 6) {
                            Label(PairedPatientsWorkspaceSupport.diaryRegistration(recordedBy: entry.recordedBy, createdAt: entry.createdAt), systemImage: "circle.fill")
                        }
                        .font(.caption)
                        .foregroundStyle(PlatformColors.ink)
                        .accessibilityElement(children: .combine)
                        .accessibilityIdentifier("entry-registration-\(entry.id)")
                        if let deletedAt = entry.deletedAt {
                            VStack(alignment: .leading, spacing: 3) {
                                Text("Eliminata il \(PairedPatientsWorkspaceSupport.entryDateFormatter.string(from: deletedAt))")
                                    .font(.footnote.weight(.semibold))
                                    .registro()
                                    .foregroundStyle(LumePalette.warning)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let reason = entry.deletionReason?.trimmedOrNil {
                                    Text("Motivo: \(reason)")
                                        .font(.callout)
                                        .foregroundStyle(.secondary)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            if model.canRestoreEntry(entry) {
                                Button {
                                    Task { await model.restoreEntry(id: entry.id) }
                                } label: {
                                    Label("Ripristina", systemImage: "arrow.uturn.backward.circle")
                                        .modifier(PairedDiaryControlLabel())
                                }
                                .font(.subheadline)
                                .accessibilityIdentifier("homebase-restore-entry-button-\(entry.id)")
                            }
                        } else if model.canMutateEntry(entry) {
                            PairedDiaryActions {
                                Button {
                                    model.startEditingEntry(entry)
                                } label: {
                                    Label("Modifica", systemImage: "pencil")
                                        .modifier(PairedDiaryControlLabel())
                                }
                                .font(.subheadline)
                                .accessibilityIdentifier("homebase-edit-entry-button-\(entry.id)")

                                Button(role: .destructive) {
                                    entryDeletionCandidate = entry
                                } label: {
                                    Label("Elimina", systemImage: "trash")
                                        .modifier(PairedDiaryControlLabel())
                                }
                                .font(.subheadline)
                                .accessibilityIdentifier("homebase-delete-entry-button-\(entry.id)")
                            }
                        }
                        }
                        .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
                    }
                        #if os(iOS)
                        // Each dated entry is a readable document block.
                        .padding(.vertical, 20)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Divider() }
                        #else
                        .padding(.vertical, 10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .modifier(LumeRigaListaModifier(isSelected: false))
                        .overlay(alignment: .bottom) { Divider() }
                        #endif
                        .accessibilityElement(children: .contain)
                        .accessibilityIdentifier("entry-row-\(entry.id)")
                    }
                }

            }
        }
    }


    private func entryChronology(_ entry: HomeBaseEntrySummary) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(entry.date, format: .dateTime.day().month(.abbreviated).year())
            Text(entry.date, format: .dateTime.hour().minute())
        }
        .font(.caption)
        .monospacedDigit()
        .foregroundStyle(.secondary)
        .frame(width: usesDiaryMargin ? 84 : nil, alignment: .leading)
        .accessibilityIdentifier("entry-date-\(entry.id)")
    }

    private var filteredDiaryEntries: [HomeBaseEntrySummary] {
        EntryFiltering.apply(
            model.entries,
            filter: entryTypeFilter,
            includeDeleted: showsDeletedDiaryEntries
        )
    }
}

struct PairedPatientScalesSection: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel
    @Binding var presentingScale: ClinicalScaleDraft?

    var body: some View {
        PairedScalesSection(
            entries: model.entries,
            isWorking: model.isWorking,
            hasSelectedPatient: model.selectedPatient != nil,
            onRefresh: {
                Task { await model.loadSelectedPatientEntries() }
            },
            onStartScale: { scale in
                presentingScale = model.makeScaleDraft(scale)
            }
        )
    }

}
