// Codex: created 2026-02-01
import SwiftUI

struct ICDSearchField: View {
    @Binding var selection: ICDResult?
    @State private var query = ""
    @State private var results: [ICDResult] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Cerca ICD-11", text: $query)
                    .textFieldStyle(.roundedBorder)
                Button("Cerca") {
                    Task { await search() }
                }
                .disabled(query.count < 2)
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
            }

            if !results.isEmpty {
                List(results) { item in
                    Button {
                        selection = item
                        query = "\(item.code) - \(item.description)"
                        results = []
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(item.description)
                                .font(.callout.weight(.semibold))
                            Text("\(item.system) \(item.code)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }
                    }
                    .buttonStyle(.plain)
                }
                .frame(maxHeight: 160)
            }
        }
    }

    @MainActor
    private func search() async {
        if isLoading { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            results = try await LocalAPIClient.shared.searchICD(query: query)
        } catch {
            errorMessage = "Ricerca ICD fallita"
        }
    }
}
