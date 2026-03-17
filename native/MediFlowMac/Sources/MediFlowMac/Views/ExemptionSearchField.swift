// @Codex
import SwiftUI

/* @Codex */
struct ExemptionSearchField: View {
    @Binding var selectedCodes: [String]

    @State private var query = ""
    @State private var results: [ExemptionSummary] = []
    @State private var detailsByCode: [String: ExemptionSummary] = [:]
    @State private var isLoading = false
    @State private var didSearch = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(.secondary)
                TextField("Cerca codice o descrizione esenzione", text: $query)
                    .textFieldStyle(.roundedBorder)
                    .onChange(of: query) { _ in
                        didSearch = false
                        errorMessage = nil
                        results = []
                    }
                Button(isLoading ? "Ricerca..." : "Cerca") {
                    Task { await search() }
                }
                .disabled(isLoading || query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            } else if didSearch && !isLoading && results.isEmpty && query.trimmingCharacters(in: .whitespacesAndNewlines).count >= 2 {
                Text("Nessuna corrispondenza.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            if !results.isEmpty {
                List(results) { result in
                    Button {
                        select(result)
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Text(result.code)
                                    .font(.callout.weight(.semibold))
                                if let type = result.type, !type.isEmpty {
                                    Text(type)
                                        .font(.caption2)
                                        .padding(.horizontal, 6)
                                        .padding(.vertical, 2)
                                        .background(.secondary.opacity(0.12))
                                        .clipShape(Capsule())
                                }
                            }
                            Text(result.description)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedCodes.contains(ExemptionCodesCodec.normalizedCode(result.code)))
                }
                .frame(maxHeight: 180)
            }

            if selectedCodes.isEmpty {
                Text("Nessuna esenzione associata.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(selectedCodes, id: \.self) { code in
                            let detail = detailsByCode[code]
                            HStack(spacing: 6) {
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(code)
                                        .font(.system(.caption, design: .monospaced).weight(.semibold))
                                    Text(detail?.description ?? "Descrizione non disponibile")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                }
                                Button {
                                    remove(code)
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.caption)
                                }
                                .buttonStyle(.plain)
                                .accessibilityLabel("Rimuovi \(code)")
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color.blue.opacity(0.08))
                            )
                        }
                    }
                }
            }
        }
        .task {
            await loadDetailsIfNeeded(for: selectedCodes)
        }
        .onChange(of: selectedCodes) { newValue in
            Task {
                await loadDetailsIfNeeded(for: newValue)
            }
        }
    }

    @MainActor
    private func search() async {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            results = []
            return
        }

        isLoading = true
        didSearch = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let items = try await LocalAPIClient.shared.searchExemptions(query: trimmed)
            results = items
            for item in items {
                detailsByCode[ExemptionCodesCodec.normalizedCode(item.code)] = item
            }
        } catch {
            results = []
            errorMessage = "Ricerca esenzioni fallita"
        }
    }

    @MainActor
    private func loadDetailsIfNeeded(for codes: [String]) async {
        let missing = ExemptionCodesCodec.normalizedCodes(codes).filter { detailsByCode[$0] == nil }
        guard !missing.isEmpty else { return }

        for code in missing {
            do {
                let items = try await LocalAPIClient.shared.searchExemptions(query: code, limit: 8)
                if let match = items.first(where: { ExemptionCodesCodec.normalizedCode($0.code) == code }) ?? items.first {
                    detailsByCode[code] = match
                } else {
                    detailsByCode[code] = placeholderSummary(for: code)
                }
            } catch {
                detailsByCode[code] = placeholderSummary(for: code)
            }
        }
    }

    private func select(_ result: ExemptionSummary) {
        let code = ExemptionCodesCodec.normalizedCode(result.code)
        guard !selectedCodes.contains(code) else { return }
        selectedCodes = ExemptionCodesCodec.normalizedCodes(selectedCodes + [code])
        detailsByCode[code] = result
        query = ""
        results = []
        didSearch = false
        errorMessage = nil
    }

    private func remove(_ code: String) {
        selectedCodes.removeAll { $0 == code }
        detailsByCode[code] = nil
    }

    private func placeholderSummary(for code: String) -> ExemptionSummary {
        ExemptionSummary(
            code: code,
            description: "Descrizione non disponibile",
            type: nil,
            source: nil,
            startDate: nil,
            endDate: nil,
            isPharma: nil,
            isSpecialist: nil,
            isNational: nil,
            updatedAt: nil
        )
    }
}
