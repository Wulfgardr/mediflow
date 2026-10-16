import SwiftUI

struct TreatmentReasoningProposalView: View {
    let result: NativeOrdinaryJSON
    @State private var showsSources = false

    private var data: NativeOrdinaryJSON { result["value"]["data"] }
    private var bindings: [NativeOrdinaryJSON] { result["sourceBindings"].array }
    private var sourceIndex: TreatmentReasoningSourceIndex { TreatmentReasoningSourceIndex(result: result) }

    var body: some View {
        VStack(alignment: .leading, spacing: 28) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Circle().stroke(PlatformColors.pencil, lineWidth: 1.5).frame(width: 10, height: 10)
                        .accessibilityHidden(true)
                    Text("Proposta").inkRegister(weight: .semibold).foregroundStyle(PlatformColors.pencil)
                }
                Text("Da verificare sulle fonti. Nessuna modifica alla cartella.").chartMetadata()
            }
            .padding(.vertical, 16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(alignment: .top) { Divider() }
            .overlay(alignment: .bottom) { Divider() }

            VStack(alignment: .leading, spacing: 12) {
                Text("Indicazione da valutare").chartGroupHeading()
                proposalText(data["recommendation"])
                sourceLinks(for: bindings.first { $0["claimPath"].string == "data.recommendation" }?["evidenceRefs"] ?? .null)
                if result["value"]["summary"].string != data["recommendation"].string {
                    proposalText(result["value"]["summary"])
                    sourceLinks(for: bindings.first { $0["claimPath"].string == "summary" }?["evidenceRefs"] ?? .null)
                }
            }

            if !data["safetyFlags"].array.isEmpty || !data["caveats"].array.isEmpty {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Cautele e informazioni mancanti").chartGroupHeading()
                    ForEach(Array(data["safetyFlags"].array.enumerated()), id: \.offset) { _, flag in
                        let urgent = flag["severity"].string == "urgent_review"
                        let information = flag["severity"].string == "info"
                        HStack(alignment: .top, spacing: 12) {
                            Text(urgent ? "◆" : information ? "ℹ" : "▲").accessibilityHidden(true)
                            VStack(alignment: .leading, spacing: 8) {
                                Text((urgent ? "Revisione urgente" : information ? "Informazione" : "Cautela") + " · " + (flag["label"].string ?? ""))
                                    .inkRegister(weight: .semibold)
                                if let text = flag["rationale"].string { Text(text).inkRegister().fixedSize(horizontal: false, vertical: true) }
                                sourceLinks(for: flag["evidenceRefs"])
                            }
                        }
                        .foregroundStyle(urgent ? PlatformColors.signal(.critical) : information ? PlatformColors.secondaryInk : PlatformColors.signal(.attention))
                        .padding(.vertical, 8)
                    }
                    ForEach(Array(data["caveats"].array.enumerated()), id: \.offset) { _, caveat in
                        HStack(alignment: .top, spacing: 12) {
                            Text("▲").accessibilityHidden(true)
                            if let text = caveat.string { Text(text).inkRegister().fixedSize(horizontal: false, vertical: true) }
                        }.foregroundStyle(PlatformColors.signal(.attention))
                    }
                }
            }

            proposalRows("Elementi a sostegno", items: data["keyEvidence"].array, textKey: "statement")
            proposalRows("Azioni da valutare", items: data["suggestedActions"].array, textKey: "rationale")

            if !data["reasoning"].array.isEmpty {
                DisclosureGroup("Come è stata formulata") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(data["reasoning"].array.enumerated()), id: \.offset) { _, item in proposalText(item) }
                    }.padding(.vertical, 12)
                }.inkRegister()
            }
            DisclosureGroup("Fonti della proposta", isExpanded: $showsSources) {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(sourceIndex.references, id: \.self) { reference in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(sourceIndex.label(reference)).inkRegister(weight: .semibold)
                            Text(reference).font(.caption).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }.padding(.vertical, 8).overlay(alignment: .bottom) { Divider() }
                    }
                    ForEach(Array(bindings.enumerated()), id: \.offset) { _, binding in
                        VStack(alignment: .leading, spacing: 8) {
                            proposalText(binding["claim"])
                            ForEach(binding["evidenceRefs"].array.compactMap(\.string), id: \.self) { reference in
                                Text(sourceIndex.label(reference))
                                    .font(.caption).foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }.padding(.vertical, 8).overlay(alignment: .bottom) { Divider() }
                    }
                }.padding(.vertical, 12)
            }.inkRegister()

            if !data["trace"]["limitations"].array.isEmpty {
                DisclosureGroup("Limiti della generazione") {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(data["trace"]["limitations"].array.enumerated()), id: \.offset) { _, item in
                            if let text = item.string { Text(text).inkRegister().fixedSize(horizontal: false, vertical: true) }
                        }
                    }.padding(.vertical, 12)
                }.inkRegister()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .textSelection(.enabled)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("treatment-reasoning-review")
    }

    @ViewBuilder private func proposalText(_ value: NativeOrdinaryJSON) -> some View {
        if let text = value.string, !text.isEmpty {
            Text(text).underline(true, pattern: .dash, color: PlatformColors.pencil)
                .inkVoice(17, relativeTo: .body).lineSpacing(5)
                .foregroundStyle(PlatformColors.pencil)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: 540, alignment: .leading)
        }
    }

    @ViewBuilder private func sourceLinks(for value: NativeOrdinaryJSON) -> some View {
        let values = value.array.compactMap(\.string)
        if !values.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(values, id: \.self) { reference in
                    Button(sourceIndex.label(reference)) { showsSources = true }
                        #if os(macOS)
                        .buttonStyle(.link).font(.caption).frame(minHeight: 32)
                        #else
                        .buttonStyle(.plain).foregroundStyle(Color.accentColor).font(.caption).frame(minHeight: 44)
                        #endif
                        .accessibilityHint("Espande i riferimenti della proposta, senza aprire o modificare la cartella.")
                }
            }
        }
    }

    @ViewBuilder private func proposalRows(_ title: String, items: [NativeOrdinaryJSON], textKey: String) -> some View {
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                Text(title).chartGroupHeading()
                ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                    VStack(alignment: .leading, spacing: 8) {
                        if let label = item["label"].string { Text(label).inkRegister(weight: .semibold) }
                        proposalText(item[textKey])
                        sourceLinks(for: item["evidenceRefs"])
                    }.padding(.vertical, 12).frame(maxWidth: .infinity, alignment: .leading)
                        .overlay(alignment: .bottom) { Divider() }
                }
            }
        }
    }
}
struct TreatmentReasoningSourceIndex {
    let references: [String]

    init(result: NativeOrdinaryJSON) {
        let data = result["value"]["data"]
        let groups = result["sourceBindings"].array + data["keyEvidence"].array
            + data["safetyFlags"].array + data["suggestedActions"].array
        var found: [String] = []
        for group in groups {
            for reference in group["evidenceRefs"].array.compactMap(\.string) where !found.contains(reference) {
                found.append(reference)
            }
        }
        references = found
    }

    func label(_ reference: String) -> String {
        let kind: String
        switch reference.split(separator: ":", maxSplits: 1).first.map(String.init) {
        case "profile": kind = "Profilo clinico"
        case "diagnosis": kind = "Diagnosi"
        case "therapy": kind = "Terapia"
        case "observation": kind = "Parametro"
        case "entry": kind = "Diario"
        case "insight": kind = "Sintesi documento"
        case "attachment": kind = "Allegato"
        default: kind = "Riferimento"
        }
        guard let index = references.firstIndex(of: reference) else { return kind }
        return "\(kind) · Fonte \(index + 1)"
    }
}
