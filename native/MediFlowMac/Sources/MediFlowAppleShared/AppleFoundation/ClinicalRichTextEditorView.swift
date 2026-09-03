import SwiftUI
import MediFlowCore

// S7 (Wave 5, D10/D11): the declared FALLBACK editor UI. A SwiftUI toolbar
// operates on the ClinicalRichTextEditorDocument model (native/MediFlowCore/
// ClinicalRichTextEditor.swift) rather than binding TextEditor directly to an
// AttributedString: list/heading/blockquote paragraph structure is not
// reliable enough to trust for a clinical record without an interactive
// simulator to verify bidirectional AttributedString editing, which this
// environment does not have. Every block still renders through
// ClinicalRichText.render (document.renderedHTML) before it is ever sealed.

/* @Codex */
struct ClinicalRichTextEditorView: View {
    @Binding var document: ClinicalRichTextEditorDocument
    let accessibilityPrefix: String

    /// Which block the caret is in. Drives whether that block shows its
    /// formatting controls.
    ///
    /// Every block used to carry the full row — kind menu, bold, italic,
    /// underline, strikethrough, delete — at all times. A four-paragraph note
    /// therefore stacked four identical toolbars, and the S/O/A/P template, whose
    /// whole point is four short lines, produced more chrome than content. The
    /// controls act on one block at a time, so only one block needs them.
    @FocusState private var focusedBlockID: UUID?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if document.blocks.isEmpty {
                Text("Nessun contenuto. Aggiungi un blocco dalla barra sotto.")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("\(accessibilityPrefix)-empty-state")
            } else {
                ForEach(document.blocks) { block in
                    blockRow(block)
                }
            }
            addBlockToolbar
        }
    }

    @ViewBuilder
    private func blockRow(_ block: ClinicalRichTextEditorBlock) -> some View {
        switch block.storage {
        case .preserved:
            preservedBlockRow(block)
        case .editable(let kind, let span):
            editableBlockRow(block, kind: kind, span: span)
        }
    }

    // Degraded-but-safe mode (D11): existing structure this editor cannot
    // represent losslessly (mixed inline styles, nested lists/blockquotes, an
    // unclosed tag the web sanitizer preserved) shows as honest literal text,
    // never silently rewritten. The only edit available is removing the whole
    // block; the transcoder still writes it back byte-identical if left alone.
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
                    Image(systemName: "trash")
                }
                .buttonStyle(.plain)
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
        .accessibilityIdentifier("\(accessibilityPrefix)-preserved-block")
    }

    private func editableBlockRow(
        _ block: ClinicalRichTextEditorBlock,
        kind: ClinicalRichTextEditorBlock.EditableKind,
        span: ClinicalRichTextTextRun
    ) -> some View {
        let isFocused = focusedBlockID == block.id
        return VStack(alignment: .leading, spacing: 4) {
            if isFocused {
                HStack(spacing: 6) {
                    kindMenu(block: block, currentKind: kind)
                    Spacer(minLength: 8)
                    styleToggle(systemImage: "bold", isOn: span.isBold, identifier: "\(accessibilityPrefix)-bold-\(block.id.uuidString)") {
                        document.toggleBold(id: block.id)
                    }
                    styleToggle(systemImage: "italic", isOn: span.isItalic, identifier: "\(accessibilityPrefix)-italic-\(block.id.uuidString)") {
                        document.toggleItalic(id: block.id)
                    }
                    styleToggle(systemImage: "underline", isOn: span.isUnderlined, identifier: "\(accessibilityPrefix)-underline-\(block.id.uuidString)") {
                        document.toggleUnderline(id: block.id)
                    }
                    styleToggle(systemImage: "strikethrough", isOn: span.isStruckThrough, identifier: "\(accessibilityPrefix)-strikethrough-\(block.id.uuidString)") {
                        document.toggleStrikethrough(id: block.id)
                    }
                    Button(role: .destructive) {
                        document.removeBlock(id: block.id)
                    } label: {
                        Image(systemName: "trash")
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("\(accessibilityPrefix)-remove-\(block.id.uuidString)")
                }
                .transition(.opacity)
            }
            TextEditor(text: Binding(
                get: { span.text },
                set: { document.updateText(id: block.id, text: $0) }
            ))
            // TextEditor has no per-character rich rendering: bold/italic are
            // reflected via the block's font, underline/strikethrough only via
            // the toggle buttons' highlighted state above (this editor styles a
            // whole block at once, not a text selection, see D11 fallback note).
            .font(font(forKind: kind, isBold: span.isBold, isItalic: span.isItalic))
            .scrollContentBackground(.hidden)
            .frame(minHeight: 36)
            .focused($focusedBlockID, equals: block.id)
            .accessibilityIdentifier("\(accessibilityPrefix)-text-\(block.id.uuidString)")
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: ClinicalChartMetrics.fieldRadius, style: .continuous)
                .fill(PlatformColors.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: ClinicalChartMetrics.fieldRadius, style: .continuous)
                .stroke(
                    isFocused ? Color.accentColor : PlatformColors.separator,
                    lineWidth: isFocused ? 1.5 : 1
                )
        )
        .animation(.easeInOut(duration: 0.15), value: isFocused)
        .accessibilityIdentifier("\(accessibilityPrefix)-block-\(block.id.uuidString)")
    }

    private func kindMenu(block: ClinicalRichTextEditorBlock, currentKind: ClinicalRichTextEditorBlock.EditableKind) -> some View {
        Menu {
            ForEach(ClinicalRichTextEditorBlock.EditableKind.allCases, id: \.self) { kind in
                Button(Self.label(for: kind)) {
                    document.setKind(id: block.id, kind: kind)
                }
            }
        } label: {
            Label(Self.label(for: currentKind), systemImage: "textformat")
                .font(.caption2)
        }
        .accessibilityIdentifier("\(accessibilityPrefix)-kind-\(block.id.uuidString)")
    }

    private func styleToggle(systemImage: String, isOn: Bool, identifier: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .foregroundStyle(isOn ? Color.accentColor : Color.secondary)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
    }

    /// Six labelled buttons in a row, on a canvas that fits about three.
    ///
    /// Squeezed into the available width they did not truncate or wrap by word:
    /// each label collapsed to a single column of letters, so the bar read
    /// "P a r a g r a f o". A formatting bar is a strip of tools, and a strip of
    /// tools that does not fit scrolls — which is what iOS does with its own.
    /// `.fixedSize` on the row is what makes the buttons keep their real width
    /// inside the scroll view instead of compressing again.
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
            // Room for the button's own focus ring and shadow, which a scroll
            // view clips flush otherwise.
            .padding(.vertical, 2)
        }
        .font(.caption2)
    }

    private func addBlockButton(kind: ClinicalRichTextEditorBlock.EditableKind, label: String, systemImage: String) -> some View {
        Button {
            document.appendNewBlock(kind: kind)
        } label: {
            Label(label, systemImage: systemImage)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
        }
        .buttonStyle(.bordered)
        .accessibilityIdentifier("\(accessibilityPrefix)-add-\(Self.identifierSuffix(for: kind))")
    }

    private static func label(for kind: ClinicalRichTextEditorBlock.EditableKind) -> String {
        switch kind {
        case .paragraph: return "Paragrafo"
        case .heading2: return "Titolo (H2)"
        case .heading3: return "Sottotitolo (H3)"
        case .bulletItem: return "Elenco puntato"
        case .numberedItem: return "Elenco numerato"
        case .blockquote: return "Citazione"
        }
    }

    private static func identifierSuffix(for kind: ClinicalRichTextEditorBlock.EditableKind) -> String {
        switch kind {
        case .paragraph: return "paragraph"
        case .heading2: return "heading2"
        case .heading3: return "heading3"
        case .bulletItem: return "bullet-item"
        case .numberedItem: return "numbered-item"
        case .blockquote: return "blockquote"
        }
    }

    private func font(forKind kind: ClinicalRichTextEditorBlock.EditableKind, isBold: Bool, isItalic: Bool) -> Font {
        var base: Font
        switch kind {
        case .heading2: base = .subheadline
        case .heading3: base = .subheadline
        default: base = .body
        }
        if isBold { base = base.weight(.bold) }
        if isItalic { base = base.italic() }
        return base
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
