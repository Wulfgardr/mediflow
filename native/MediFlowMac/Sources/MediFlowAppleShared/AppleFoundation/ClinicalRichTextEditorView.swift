import SwiftUI
import MediFlowCore

/* @Codex: Native inline text selection; the same document is rendered before sealing. */
struct ClinicalRichTextEditorView: View {
    @Binding var document: ClinicalRichTextEditorDocument
    let accessibilityPrefix: String
    @StateObject private var inlineEditor = ClinicalInlineEditorController()

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if document.blocks.isEmpty {
                Text("Nessun contenuto. Aggiungi un blocco dalla barra sotto.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("\(accessibilityPrefix)-empty-state")
            } else {
                ForEach(document.blocks) { block in
                    if let kind = block.editableKind {
                        editableBlockRow(block, kind: kind)
                    } else {
                        preservedBlockRow(block)
                    }
                }
            }
            addBlockToolbar
        }
    }

    private func preservedBlockRow(_ block: ClinicalRichTextEditorBlock) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Label("Contenuto preservato", systemImage: "lock.doc")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.orange)
                Spacer(minLength: 8)
                Button(role: .destructive) {
                    document.removeBlock(id: block.id)
                } label: {
                    Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Rimuovi blocco preservato")
                .accessibilityIdentifier("\(accessibilityPrefix)-preserved-remove-\(block.id.uuidString)")
            }
            Text(block.preservedPreviewText ?? "")
                .font(.caption)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
            Text("Struttura non modificabile in questo editor: viene mantenuta com'e' finche' non la rimuovi.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .padding(8)
        .background(Color.secondary.opacity(0.08), in: RoundedRectangle(cornerRadius: 6))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(accessibilityPrefix)-preserved-block")
    }

    private func editableBlockRow(
        _ block: ClinicalRichTextEditorBlock, kind: ClinicalRichTextEditorBlock.EditableKind
    ) -> some View {
        let isFocused = inlineEditor.focusedBlockID == block.id
        return VStack(alignment: .leading, spacing: 4) {
            if isFocused {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        kindMenu(block: block, currentKind: kind)
                        styleToggle(.bold, symbol: "bold", label: "Grassetto", block: block)
                        styleToggle(.italic, symbol: "italic", label: "Corsivo", block: block)
                        styleToggle(.underline, symbol: "underline", label: "Sottolineato", block: block)
                        styleToggle(.strikethrough, symbol: "strikethrough", label: "Barrato", block: block)
                        Button(role: .destructive) {
                            document.removeBlock(id: block.id)
                        } label: {
                            Image(systemName: "trash").frame(minWidth: 44, minHeight: 44)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Rimuovi blocco")
                        .accessibilityIdentifier("\(accessibilityPrefix)-remove-\(block.id.uuidString)")
                    }
                    .fixedSize(horizontal: true, vertical: false)
                }
                .accessibilityIdentifier("\(accessibilityPrefix)-format-toolbar")
            }
            ClinicalInlineTextView(
                document: $document, blockID: block.id, controller: inlineEditor,
                identifier: "\(accessibilityPrefix)-text-\(block.id.uuidString)"
            )
            .frame(minHeight: 44)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: ClinicalChartMetrics.fieldRadius, style: .continuous)
                .fill(PlatformColors.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: ClinicalChartMetrics.fieldRadius, style: .continuous)
                .stroke(isFocused ? Color.accentColor : PlatformColors.separator, lineWidth: isFocused ? 1.5 : 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("\(accessibilityPrefix)-block-\(block.id.uuidString)")
    }

    // Kept for existing callers/tests. Every access resolves the current UUID;
    // the native attributed editor uses the same rule through its session.
    func textBinding(for blockID: UUID) -> Binding<String> {
        Binding(
            get: {
                guard let runs = document.blocks.first(where: { $0.id == blockID })?.runs else { return "" }
                return ClinicalInlineEditing.plainText(runs)
            },
            set: { document.updateText(id: blockID, text: $0) }
        )
    }

    private func kindMenu(block: ClinicalRichTextEditorBlock, currentKind: ClinicalRichTextEditorBlock.EditableKind) -> some View {
        Menu {
            ForEach(ClinicalRichTextEditorBlock.EditableKind.allCases, id: \.self) { kind in
                Button(Self.label(for: kind)) { document.setKind(id: block.id, kind: kind) }
            }
        } label: {
            Label(Self.label(for: currentKind), systemImage: "textformat")
                .font(.caption)
                .frame(minWidth: 44, minHeight: 44)
        }
        .accessibilityIdentifier("\(accessibilityPrefix)-kind-\(block.id.uuidString)")
    }

    private func styleToggle(_ style: ClinicalInlineStyle, symbol: String, label: String, block: ClinicalRichTextEditorBlock) -> some View {
        Button { inlineEditor.toggle(style) } label: {
            Image(systemName: symbol)
                .foregroundStyle(inlineEditor.styles.contains(style) ? Color.accentColor : .secondary)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
        .accessibilityValue(inlineEditor.styles.contains(style) ? "Attivo" : "Non uniforme o disattivo")
        .accessibilityHint("Applica alla selezione o al testo che scriverai.")
        .accessibilityIdentifier("\(accessibilityPrefix)-\(style.rawValue)-\(block.id.uuidString)")
    }

    private var addBlockToolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                addBlockButton(kind: .paragraph, label: "Paragrafo", systemImage: "paragraphsign")
                addBlockButton(kind: .heading2, label: "H2", systemImage: "textformat.size.larger")
                addBlockButton(kind: .heading3, label: "H3", systemImage: "textformat.size")
                addBlockButton(kind: .bulletItem, label: "Elenco", systemImage: "list.bullet")
                addBlockButton(kind: .numberedItem, label: "Numerato", systemImage: "list.number")
                addBlockButton(kind: .blockquote, label: "Citazione", systemImage: "quote.opening")
            }
            .fixedSize(horizontal: true, vertical: false)
            .padding(.vertical, 2)
        }
        .font(.caption)
    }

    private func addBlockButton(kind: ClinicalRichTextEditorBlock.EditableKind, label: String, systemImage: String) -> some View {
        Button { document.appendNewBlock(kind: kind) } label: {
            Label(label, systemImage: systemImage)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .frame(minHeight: 44)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("\(accessibilityPrefix)-add-\(Self.identifierSuffix(for: kind))")
    }

    private static func label(for kind: ClinicalRichTextEditorBlock.EditableKind) -> String {
        switch kind {
        case .paragraph: "Paragrafo"
        case .heading2: "Titolo (H2)"
        case .heading3: "Sottotitolo (H3)"
        case .bulletItem: "Elenco puntato"
        case .numberedItem: "Elenco numerato"
        case .blockquote: "Citazione"
        }
    }

    private static func identifierSuffix(for kind: ClinicalRichTextEditorBlock.EditableKind) -> String {
        switch kind {
        case .paragraph: "paragraph"
        case .heading2: "heading2"
        case .heading3: "heading3"
        case .bulletItem: "bullet-item"
        case .numberedItem: "numbered-item"
        case .blockquote: "blockquote"
        }
    }
}

// MARK: - Attachment references picker (D4, ADR 0076 Classe B)

/* @Codex */
struct EntryAttachmentReferencePicker: View {
    let attachments: [HomeBaseAttachmentSummary]
    @Binding var selectedIds: Set<String>
    let accessibilityPrefix: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Label("Allegati", systemImage: "paperclip")
                    .font(.caption.weight(.semibold))
                Spacer(minLength: 8)
                if !selectedIds.isEmpty {
                    Button("Rimuovi tutti") { selectedIds = [] }
                        .font(.caption2)
                        .accessibilityIdentifier("\(accessibilityPrefix)-clear")
                }
            }
            if attachments.isEmpty {
                Text("Nessun documento caricato per questo paziente da referenziare. Apri la sezione Documenti per caricarne uno.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("\(accessibilityPrefix)-empty-state")
            } else {
                ForEach(attachments) { attachment in
                    Toggle(isOn: Binding(
                        get: { selectedIds.contains(attachment.id) },
                        set: { isOn in
                            if isOn { selectedIds.insert(attachment.id) } else { selectedIds.remove(attachment.id) }
                        }
                    )) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(attachment.name.isEmpty ? "Documento senza nome" : attachment.name)
                                .font(.caption)
                            Text(attachment.type)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .accessibilityIdentifier("\(accessibilityPrefix)-toggle-\(attachment.id)")
                }
            }
        }
    }
}

// MARK: - Visit draft composer (D5, ADR 0076 Classe E)

/* @Codex */
struct VisitDraftComposerView: View {
    @ObservedObject var model: PairedPatientsWorkspaceModel

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Bozza da trascrizione", systemImage: "waveform")
                .font(.caption.weight(.semibold))
            Text("Detta col microfono della tastiera di sistema nel campo qui sotto, poi elabora la bozza. Nessun salvataggio automatico: la bozza va rivista prima di essere inserita nella voce.")
                .font(.caption2)
                .foregroundStyle(.secondary)
#if os(macOS)
            VisitRecordingLumeShell(model: model) { transcript in
                model.newEntryVisitTranscript = transcript
            }
#endif
            TextEditor(text: $model.newEntryVisitTranscript)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 70)
                // A TextEditor is not a TextField, so the style applied at the
                // workspace root does not reach it: left alone it drew an
                // 8-point rectangle beside inputs that are fully round.
                .clinicalMultilineFieldShape()
                .accessibilityIdentifier("visit-draft-transcript-field")
            HStack {
                Text("\(model.newEntryVisitTranscript.count)/\(PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars)")
                    .font(.caption2)
                    .foregroundStyle(isTranscriptWithinLimits ? Color.secondary : Color.red)
                Spacer(minLength: 8)
                Button {
                    Task { await model.computeVisitDraftForNewEntry() }
                } label: {
                    Label("Elabora bozza", systemImage: "wand.and.stars")
                }
                .font(.caption)
                .disabled(!model.canComputeVisitDraft || !isTranscriptWithinLimits)
                .accessibilityIdentifier("visit-draft-compute-button")
            }

            if let draft = model.newEntryVisitDraftResponse {
                Divider()
                draftReview(draft)
            }
        }
    }

    private var isTranscriptWithinLimits: Bool {
        model.newEntryVisitTranscript.count <= PairedPatientsWorkspaceModel.maxVisitDraftTranscriptChars
            && model.newEntryVisitTranscript.utf8.count <= VisitRecordingLimits.standard.maxTranscriptUTF8Bytes
    }

    private var isUnsignedDraft: Bool {
        model.newEntryVisitDraftResponse != nil && !model.newEntryVisitDraftReviewed
    }

    private func draftReview(_ draft: HomeBaseVisitDraftResponse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Bozza da rivedere")
                .font(.caption.weight(.semibold))
                .lumeInchiostro(bozza: isUnsignedDraft)
                .accessibilityIdentifier("visit-draft-review-heading")

            sectionPreview("S", draft.sections.subjective)
            sectionPreview("O", draft.sections.objective)
            sectionPreview("A", draft.sections.assessment)
            sectionPreview("P", draft.sections.plan)

            if !draft.medications.isEmpty {
                Text("Farmaci candidati (\(draft.medications.count))")
                    .font(.caption2.weight(.semibold))
                ForEach(Array(draft.medications.enumerated()), id: \.offset) { _, medication in
                    Text(medicationLine(medication))
                        .font(.caption2)
                        .lumeInchiostro(bozza: isUnsignedDraft)
                }
            }

            if draft.safety.reviewRequired {
                Text("Revisione clinica obbligatoria prima dell'uso. La bozza non esegue scritture (\(draft.safety.forbiddenAutoWriteCount) candidate bloccate automaticamente).")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }

            Toggle("Ho rivisto la bozza ed e clinicamente corretta", isOn: $model.newEntryVisitDraftReviewed)
                .font(.caption)
                .accessibilityIdentifier("visit-draft-review-toggle")

            HStack {
                Button("Scarta") {
                    model.discardVisitDraft()
                }
                .font(.caption)
                .accessibilityIdentifier("visit-draft-discard-button")
                Spacer(minLength: 8)
                Button {
                    model.insertVisitDraftIntoNewEntry()
                } label: {
                    Label("Inserisci nella voce", systemImage: "text.insert")
                }
                .font(.caption)
                .disabled(!model.canInsertVisitDraftIntoNewEntry)
                .accessibilityIdentifier("visit-draft-insert-button")
            }
            Text("Senza la spunta di revisione l'inserimento resta bloccato, come sul web.")
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
    }

    private func medicationLine(_ medication: HomeBaseVisitDraftResponse.MedicationCandidate) -> String {
        var line = "\(medication.drugMention) (\(medication.confidence))"
        if !medication.canApply {
            line += ", bloccato: \(medication.blockedReason)"
        }
        return line
    }

    @ViewBuilder
    private func sectionPreview(_ label: String, _ lines: [String]) -> some View {
        let nonEmpty = lines.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
        if !nonEmpty.isEmpty {
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.caption2.weight(.semibold))
                ForEach(Array(nonEmpty.enumerated()), id: \.offset) { _, line in
                    Text(line).font(.caption2)
                }
            }
            .lumeInchiostro(bozza: isUnsignedDraft)
        }
    }
}
