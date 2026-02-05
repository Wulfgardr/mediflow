// Codex: created 2026-02-01
import SwiftUI

struct ToolsView: View {
    // @Codex
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 12) {
            HStack {
                Text("Strumenti")
                    .font(.title2.weight(.semibold))
                Spacer()
                Button("Chiudi") {
                    dismiss()
                }
                .keyboardShortcut(.cancelAction)
            }

            TabView {
                AIToolView()
                    .tabItem { Text("AI") }
                AIControlPanelView()
                    .tabItem { Text("Controllo AI") }
                DrugsToolView()
                    .tabItem { Text("Farmaci") }
                ICDToolView()
                    .tabItem { Text("ICD-11") }
            }
        }
        .frame(minWidth: 720, minHeight: 520)
        .padding()
    }
}

struct AIToolView: View {
    enum AIRole: String, CaseIterable, Identifiable {
        case clinical
        case reasoning

        var id: String { rawValue }

        var label: String {
            switch self {
            case .clinical: return "Clinica"
            case .reasoning: return "Reasoning"
            }
        }
    }

    @State private var prompt = ""
    @State private var response = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var role: AIRole = .clinical

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("AI Chat")
                .font(.title2.weight(.semibold))

            Picker("Ruolo", selection: $role) {
                ForEach(AIRole.allCases) { item in
                    Text(item.label).tag(item)
                }
            }
            .pickerStyle(.segmented)

            TextEditor(text: $prompt)
                .frame(minHeight: 120)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2)))

            HStack {
                Button(isLoading ? "Elaborazione..." : "Invia") {
                    Task { await send() }
                }
                .buttonStyle(.borderedProminent)
                .disabled(isLoading || prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

                Spacer()
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            ScrollView {
                Text(response.isEmpty ? "Nessuna risposta" : response)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding()
            .background(Color.secondary.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 8))
        }
    }

    @MainActor
    private func send() async {
        if isLoading { return }
        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let config: AIConfig
            switch role {
            case .clinical:
                config = try await AISettingsResolver.resolveClinicalConfig()
            case .reasoning:
                config = try await AISettingsResolver.resolveReasoningConfig()
            }
            let raw = try await LocalAPIClient.shared.aiChat(prompt: prompt, model: config.model, baseURL: config.baseURL)
            /* @Codex */
            let cleaned = cleanAIResponse(raw)
            response = "Modello: \(config.model)\n\n" + cleaned
        } catch {
            errorMessage = "Errore AI: verifica Ollama/MLX"
        }
    }

    /* @Codex */
    private func cleanAIResponse(_ value: String) -> String {
        var output = value
        if let range = output.range(of: "<unused94>") {
            if let end = output.range(of: "<unused95>") {
                output.removeSubrange(range.lowerBound..<end.upperBound)
            } else {
                output.removeSubrange(range.lowerBound..<output.endIndex)
            }
        }
        output = output.replacingOccurrences(of: "<think>", with: "")
        output = output.replacingOccurrences(of: "</think>", with: "")
        return output.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct DrugsToolView: View {
    @State private var query = ""
    @State private var results: [DrugSummary] = []
    @State private var isLoading = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Farmaci")
                .font(.title2.weight(.semibold))

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
                    .foregroundStyle(.red)
            }

            List(results) { drug in
                VStack(alignment: .leading, spacing: 4) {
                    Text(drug.name)
                        .font(.headline)
                    Text(drug.activePrinciple ?? "Principio attivo n/d")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let company = drug.company {
                        Text(company)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
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

struct ICDToolView: View {
    @State private var query = ""
    @State private var results: [ICDResult] = []
    @State private var isLoading = false
    @State private var isOnline = false
    @State private var errorMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("ICD-11")
                    .font(.title2.weight(.semibold))
                Spacer()
                Text(isOnline ? "Online" : "Offline")
                    .font(.caption)
                    .foregroundStyle(isOnline ? .green : .red)
            }

            HStack {
                TextField("Cerca diagnosi", text: $query)
                    .textFieldStyle(.roundedBorder)
                Button("Cerca") {
                    Task { await search() }
                }
                .disabled(query.count < 2)
            }

            if let errorMessage {
                Text(errorMessage)
                    .foregroundStyle(.red)
            }

            List(results) { item in
                VStack(alignment: .leading, spacing: 4) {
                    Text(item.description)
                        .font(.headline)
                    Text("\(item.system) \(item.code)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .task {
            await checkStatus()
        }
    }

    @MainActor
    private func checkStatus() async {
        do {
            isOnline = try await LocalAPIClient.shared.checkICDStatus()
        } catch {
            isOnline = false
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
