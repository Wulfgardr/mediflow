// Codex: created 2026-02-01
import SwiftUI

struct DrugSearchField: View {
    @Binding var selection: DrugSummary?
    @State private var query = ""
    @State private var results: [DrugSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                TextField("Cerca farmaco", text: $query)
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
                List(results) { drug in
                    Button {
                        selection = drug
                        query = drug.name
                        results = []
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(drug.name)
                                .font(.callout.weight(.semibold))
                            if let active = drug.activePrinciple {
                                Text(active)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
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
            results = try await LocalAPIClient.shared.searchDrugs(query: query)
        } catch {
            errorMessage = "Ricerca farmaci fallita"
        }
    }
}
