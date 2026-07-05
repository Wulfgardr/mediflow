import SwiftUI
#if os(macOS)
import AppKit
#else
import UIKit
#endif

public struct HomeBaseRuntimeStatusView: View {
    @State private var snapshot = HomeBaseRuntimeStatusLoader.load()
    @State private var optionalServices = HomeBaseOptionalServicesSnapshot.initial
    @StateObject private var supervisor = HomeBaseRuntimeSupervisor()

    public init() {}

    public var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("Runtime home-base")
                        .font(.headline)
                    Text(snapshot.summary)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 12)
                Button {
                    snapshot = HomeBaseRuntimeStatusLoader.load()
                    Task { await refreshOptionalServices() }
                } label: {
                    Label("Aggiorna", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("homebase-runtime-refresh-button")
            }

            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                runtimeRow("Server", value: snapshot.baseURL ?? "Non configurato")
                runtimeRow("Modalita rete", value: snapshot.networkMode ?? "Non registrata")
                runtimeRow("Ultimo setup", value: snapshot.generatedAt ?? "Non registrato")
                runtimeRow("Cartella dati", value: snapshot.dataDirectory)
            }

            #if os(macOS)
            HStack(spacing: 10) {
                Button {
                    Task { await startBackend() }
                } label: {
                    Label("Avvia backend", systemImage: "play.rectangle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-start-backend-button")

                Button {
                    Task { await stopBackend() }
                } label: {
                    Label("Arresta backend", systemImage: "stop.rectangle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-stop-backend-button")
            }

            HStack(spacing: 10) {
                Button {
                    Task { await startProxy() }
                } label: {
                    Label("Avvia proxy TLS", systemImage: "play.circle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-start-proxy-button")

                Button {
                    Task { await stopProxy() }
                } label: {
                    Label("Arresta proxy TLS", systemImage: "stop.circle")
                }
                .disabled(supervisor.isWorking)
                .accessibilityIdentifier("homebase-runtime-stop-proxy-button")
            }

            if let statusMessage = supervisor.statusMessage {
                Text(statusMessage)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .accessibilityIdentifier("homebase-runtime-supervisor-status")
            }

            if let errorMessage = supervisor.errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(.red)
                    .accessibilityIdentifier("homebase-runtime-supervisor-error")
            }
            #endif

            VStack(alignment: .leading, spacing: 8) {
                ForEach(snapshot.components) { component in
                    runtimeComponentRow(
                        title: component.title,
                        detail: component.detail,
                        state: component.state,
                        accessibilityIdentifier: "homebase-runtime-component-\(component.id)"
                    )
                }
            }

            Divider()

            optionalServicesSection

            Text("Backend web e proxy TLS sono gli unici servizi gestiti dalla app. Ollama e Docker/ICD sono mostrati a scopo diagnostico e non vengono mai installati o avviati automaticamente.")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .cardStyle()
        .accessibilityIdentifier("homebase-runtime-status-card")
        .task {
            await refreshOptionalServices()
        }
    }

    private func runtimeRow(_ title: String, value: String) -> some View {
        GridRow {
            Text(title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption)
                .foregroundStyle(.primary)
                .textSelection(.enabled)
        }
    }

    #if os(macOS)
    private func startProxy() async {
        await supervisor.startProxy(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func stopProxy() async {
        await supervisor.stopProxy(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func startBackend() async {
        await supervisor.startBackend(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }

    private func stopBackend() async {
        await supervisor.stopBackend(snapshot: snapshot)
        snapshot = HomeBaseRuntimeStatusLoader.load()
    }
    #endif

    private var optionalServicesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text("Servizi opzionali")
                    .font(.subheadline.weight(.semibold))
                Text("Rilevati solo se gia attivi. La app non li installa, avvia o arresta.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            ForEach(optionalServices.services) { service in
                runtimeComponentRow(
                    title: service.title,
                    detail: service.detail,
                    state: service.state,
                    accessibilityIdentifier: accessibilityIdentifier(for: service)
                )
            }
        }
        .padding(.top, 4)
        .accessibilityIdentifier("homebase-runtime-optional-section")
    }

    private func runtimeComponentRow(
        title: String,
        detail: String,
        state: HomeBaseRuntimeComponentState,
        accessibilityIdentifier: String
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: symbolName(for: state))
                .foregroundStyle(tintColor(for: state))
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                Text(detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 12)
            Text(state.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(tintColor(for: state))
        }
        .accessibilityIdentifier(accessibilityIdentifier)
    }

    private func accessibilityIdentifier(for service: HomeBaseOptionalServiceStatus) -> String {
        switch service.id {
        case "optional-ollama":
            return "homebase-runtime-optional-ollama"
        case "optional-docker-icd":
            return "homebase-runtime-optional-docker"
        default:
            return "homebase-runtime-\(service.id)"
        }
    }

    private func refreshOptionalServices() async {
        optionalServices = await HomeBaseOptionalServicesProbe.probe()
    }

    private func symbolName(for state: HomeBaseRuntimeComponentState) -> String {
        switch state {
        case .ready:
            return "checkmark.circle.fill"
        case .missing:
            return "xmark.circle.fill"
        case .mismatch:
            return "exclamationmark.triangle.fill"
        case .unknown:
            return "questionmark.circle.fill"
        }
    }

    private func tintColor(for state: HomeBaseRuntimeComponentState) -> Color {
        switch state {
        case .ready:
            return .green
        case .missing:
            return .red
        case .mismatch:
            return .orange
        case .unknown:
            return .secondary
        }
    }
}
