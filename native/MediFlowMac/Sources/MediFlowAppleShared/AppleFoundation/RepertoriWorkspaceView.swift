#if os(macOS)
import SwiftUI

/// Browsable clinical catalogues: drugs, exemptions, terminology.
///
/// Nothing new is talked to here. `searchDrugs`, `searchExemptions` and
/// `searchTerminology` already exist on `HomeBasePatientsDataSource` and are
/// already used by the therapy and exemption pickers; what was missing was a
/// place to consult them without first opening a patient and starting to draft
/// something. So this is a surface over an existing capability, not a new one.
///
/// It rides the paired channel, so it works against any connected home base:
/// catalogues are clinical reference data, not administration of the host, and
/// the loopback rule that guards the Host section would be wrong here.
@MainActor
final class RepertoriStore: ObservableObject {
    enum Catalogue: String, CaseIterable, Identifiable {
        case drugs, exemptions, terminology
        var id: String { rawValue }

        var title: String {
            switch self {
            case .drugs: "Farmaci"
            case .exemptions: "Esenzioni"
            case .terminology: "Terminologia"
            }
        }

        var prompt: String {
            switch self {
            case .drugs: "Nome commerciale, principio attivo o AIC"
            case .exemptions: "Codice o descrizione dell'esenzione"
            case .terminology: "Codice o descrizione ICD"
            }
        }
    }

    @Published var catalogue: Catalogue = .drugs
    @Published var query = ""

    @Published private(set) var drugs: [HomeBaseDrugSummary] = []
    @Published private(set) var exemptions: [HomeBaseExemptionSummary] = []
    @Published private(set) var terminology: [HomeBaseTerminologyItem] = []
    @Published private(set) var isSearching = false
    @Published private(set) var failure: String?
    @Published private(set) var hasSearched = false

    private var pending: Task<Void, Never>?

    /// Debounced: a catalogue search per keystroke would hammer the host for
    /// prefixes nobody meant to look up.
    func scheduleSearch(connection: ClinicalWorkspaceConnection?) {
        pending?.cancel()
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else {
            clearResults()
            hasSearched = false
            return
        }
        pending = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            await self?.search(connection: connection, term: trimmed)
        }
    }

    func search(connection: ClinicalWorkspaceConnection?, term: String) async {
        guard let connection else {
            failure = "Collega l'home-base per consultare i repertori."
            return
        }
        isSearching = true
        failure = nil
        defer { isSearching = false; hasSearched = true }

        do {
            switch catalogue {
            case .drugs:
                drugs = try await connection.dataSource.searchDrugs(
                    query: term,
                    limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                    credentials: connection.credentials,
                    sessionCookie: connection.sessionCookie,
                    ambulatoryId: connection.ambulatoryId
                )
            case .exemptions:
                exemptions = try await connection.dataSource.searchExemptions(
                    query: term,
                    limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                    credentials: connection.credentials,
                    sessionCookie: connection.sessionCookie,
                    ambulatoryId: connection.ambulatoryId
                )
            case .terminology:
                terminology = try await connection.dataSource.searchTerminology(
                    system: "icd10",
                    query: term,
                    limit: HomeBaseCatalogSearchLimit.defaultMaximum,
                    credentials: connection.credentials,
                    sessionCookie: connection.sessionCookie,
                    ambulatoryId: connection.ambulatoryId
                )
            }
        } catch {
            failure = error.localizedDescription
        }
    }

    func clearResults() {
        drugs = []
        exemptions = []
        terminology = []
        failure = nil
    }

    var resultCount: Int {
        switch catalogue {
        case .drugs: drugs.count
        case .exemptions: exemptions.count
        case .terminology: terminology.count
        }
    }
}

struct RepertoriWorkspaceView: View {
    @ObservedObject var workspaceModel: PairedPatientsWorkspaceModel
    @StateObject private var store = RepertoriStore()

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            picker
                .padding(.horizontal, 20)
                .padding(.top, 14)
                .padding(.bottom, 10)

            Divider()

            results
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .searchable(
            text: $store.query,
            placement: .toolbar,
            prompt: store.catalogue.prompt
        )
        .onChange(of: store.query) { _ in
            store.scheduleSearch(connection: workspaceModel.clinicalWorkspaceConnection)
        }
        .onChange(of: store.catalogue) { _ in
            store.clearResults()
            store.scheduleSearch(connection: workspaceModel.clinicalWorkspaceConnection)
        }
        .accessibilityIdentifier("clinical-workspace-repertori-view")
    }

    private var picker: some View {
        Picker("Repertorio", selection: $store.catalogue) {
            ForEach(RepertoriStore.Catalogue.allCases) { item in
                Text(item.title).tag(item)
            }
        }
        .pickerStyle(.segmented)
        .labelsHidden()
        .accessibilityIdentifier("repertori-catalogue-picker")
    }

    @ViewBuilder
    private var results: some View {
        if let failure = store.failure {
            placeholder(
                systemImage: "exclamationmark.triangle",
                title: "Consultazione non riuscita",
                detail: failure
            )
        } else if store.isSearching {
            ProgressView()
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if store.query.trimmingCharacters(in: .whitespacesAndNewlines).count < 2 {
            placeholder(
                systemImage: "magnifyingglass",
                title: "Cerca nel repertorio",
                detail: "Digita almeno due caratteri. \(store.catalogue.prompt)."
            )
        } else if store.hasSearched, store.resultCount == 0 {
            // Names the two reasons apart, because they call for opposite moves:
            // refine the search, or import the catalogue on the host.
            placeholder(
                systemImage: "tray",
                title: "Nessun risultato",
                detail: "Nessuna voce corrisponde alla ricerca. Se il repertorio non è mai stato importato sull'host, l'elenco è vuoto per qualunque termine."
            )
        } else {
            list
        }
    }

    @ViewBuilder
    private var list: some View {
        switch store.catalogue {
        case .drugs:
            List(store.drugs) { drug in
                VStack(alignment: .leading, spacing: 3) {
                    Text(drug.name)
                        .font(.body.weight(.medium))
                    HStack(spacing: 6) {
                        Text(drug.aic).registro()
                        if let atc = drug.atc { Text("· ATC \(atc)").registro() }
                        if let principle = drug.activePrinciple { Text("· \(principle)") }
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    if let packaging = drug.packaging {
                        Text(packaging)
                            .font(.caption)
                            .foregroundStyle(.tertiary)
                    }
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("repertori-drugs-list")

        case .exemptions:
            List(store.exemptions) { exemption in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(exemption.code)
                            .font(.body.weight(.medium))
                            .registro()
                        exemptionTags(exemption)
                    }
                    Text(exemption.description)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("repertori-exemptions-list")

        case .terminology:
            List(store.terminology) { item in
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.code)
                        .font(.body.weight(.medium))
                        .registro()
                    Text(item.display)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 3)
                .accessibilityElement(children: .combine)
            }
            .accessibilityIdentifier("repertori-terminology-list")
        }
    }

    @ViewBuilder
    private func exemptionTags(_ exemption: HomeBaseExemptionSummary) -> some View {
        if exemption.isPharma == true { PairedPatientFlagChip("Farmaci", tone: .info) }
        if exemption.isSpecialist == true { PairedPatientFlagChip("Specialistica", tone: .info) }
        if exemption.isNational == true { PairedPatientFlagChip("Nazionale", tone: .neutral) }
    }

    private func placeholder(systemImage: String, title: String, detail: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: systemImage)
                .font(.title2)
                .foregroundStyle(.secondary)
            Text(title)
                .font(.headline)
            Text(detail)
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .frame(maxWidth: 420)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
#endif
