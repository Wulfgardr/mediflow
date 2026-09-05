import SwiftUI

/* @Codex */
struct MobilePairedStatusPresentation: Equatable {
    enum Phase: Equatable {
        case loading, error, online, cached, offline, stale, sessionExpired, notLoaded
    }

    let phase: Phase
    let title: String
    let detail: String
    let symbolName: String
    let actionTitle: String?

    static func make(
        connectionState: PairedPatientsConnectionState,
        isWorking: Bool,
        errorMessage: String?,
        reconciliationLine: String,
        cacheIsStale: Bool = false
    ) -> Self {
        if isWorking {
            return Self(phase: .loading, title: "Aggiornamento in corso", detail: "Mantieni aperto MediFlow.", symbolName: "arrow.triangle.2.circlepath", actionTitle: nil)
        }
        if errorMessage != nil {
            return Self(phase: .error, title: "Aggiornamento non riuscito", detail: "I dati già visibili non vengono modificati.", symbolName: "exclamationmark.triangle.fill", actionTitle: "Riprova")
        }
        if cacheIsStale {
            return Self(phase: .stale, title: "Cache scaduta", detail: "Ricollega l'home-base prima di usare questi dati.", symbolName: "clock.badge.exclamationmark", actionTitle: "Ricollega")
        }
        switch connectionState {
        case .pairedOnline:
            return Self(phase: .online, title: "Home-base collegato", detail: reconciliationLine, symbolName: "checkmark.circle.fill", actionTitle: "Aggiorna")
        case .cached:
            return Self(phase: .cached, title: "Cache locale", detail: reconciliationLine, symbolName: "clock.arrow.circlepath", actionTitle: "Aggiorna")
        case .pairedOfflineDegraded:
            return Self(phase: .offline, title: "Offline, sola lettura", detail: reconciliationLine, symbolName: "wifi.slash", actionTitle: "Riprova")
        case .sessionExpired:
            return Self(phase: .sessionExpired, title: "Sessione scaduta", detail: "Accedi di nuovo per leggere o modificare dati.", symbolName: "person.crop.circle.badge.exclamationmark", actionTitle: "Accedi")
        case .notLoaded:
            return Self(phase: .notLoaded, title: "Home-base non configurato", detail: "Collega questo dispositivo per caricare il perimetro autorizzato.", symbolName: "link.badge.plus", actionTitle: "Configura")
        }
    }
}

#if os(iOS)
/* @Codex */
struct MobilePairedStatusView: View {
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @Environment(\.verticalSizeClass) private var verticalSizeClass

    let presentation: MobilePairedStatusPresentation
    let onPrimaryAction: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            if dynamicTypeSize.isAccessibilitySize {
                // The outer element retains the complete status and detail for
                // assistive technologies. Keeping only the state symbol and its
                // action on screen preserves the first patient row at AX sizes.
                statusSymbol
                Spacer(minLength: 8)
                primaryActionButton(compact: true)
            } else {
                statusSymbol
                VStack(alignment: .leading, spacing: 4) {
                    Text(presentation.title)
                        .font(.headline)
                        .lineLimit(isShortViewport ? 1 : nil)
                    if !isShortViewport {
                        Text(presentation.detail)
                            .font(.subheadline)
                            .foregroundStyle(mutedColor)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 8)
                primaryActionButton()
            }
        }
        .padding(dynamicTypeSize.isAccessibilitySize ? 8 : 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .lumeSurface(zone: .field)
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Stato operativo")
        .accessibilityValue("\(presentation.title). \(presentation.detail)")
        .accessibilityIdentifier("mobile-paired-status")
    }

    @ViewBuilder
    private var statusSymbol: some View {
        if presentation.phase == .loading {
            ProgressView()
                .frame(width: 28, height: 28)
        } else {
            Image(systemName: presentation.symbolName)
                .font(.title3.weight(.semibold))
                .foregroundStyle(tint)
                .frame(width: 28, height: 28)
        }
    }

    private var tint: Color {
        switch presentation.phase {
        case .online: return LumePalette.success
        case .error, .stale: return LumePalette.critical
        case .offline, .sessionExpired: return LumePalette.warning
        case .loading, .cached, .notLoaded: return mutedColor
        }
    }

    @ViewBuilder
    private func primaryActionButton(compact: Bool = false) -> some View {
        if let actionTitle = presentation.actionTitle {
            Button(action: onPrimaryAction) {
                if compact {
                    Image(systemName: actionTitle == "Configura" || actionTitle == "Accedi"
                        ? "slider.horizontal.3"
                        : "arrow.clockwise")
                        .font(.system(size: 20, weight: .semibold))
                } else {
                    Text(actionTitle)
                        .fixedSize()
                        .foregroundStyle(colorScheme == .dark ? Color.black : Color.white)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.primary)
            .controlSize(.large)
            .frame(minWidth: 48, minHeight: 48)
            .contentShape(.interaction, Rectangle())
            .hoverEffect(.highlight)
            .keyboardShortcut("r", modifiers: .command)
            .accessibilityLabel(actionTitle)
            .accessibilityHint("Aggiorna lo stato del collegamento con l'home-base.")
        }
    }

    private var isShortViewport: Bool {
        verticalSizeClass == .compact
    }

    private var mutedColor: Color {
        colorScheme == .dark
            ? LumePalette.guardia.inkMuted
            : LumePalette.giorno.inkMuted
    }
}

#if DEBUG
#Preview("iPhone, offline, light") {
    MobilePairedStatusView(
        presentation: .make(connectionState: .pairedOfflineDegraded, isWorking: false, errorMessage: nil, reconciliationLine: "Cache cifrata locale. Nessuna scrittura offline."),
        onPrimaryAction: {}
    )
    .padding()
    .preferredColorScheme(.light)
}

#Preview("iPad, cache scaduta, dark") {
    MobilePairedStatusView(
        presentation: .make(connectionState: .cached, isWorking: false, errorMessage: nil, reconciliationLine: "Snapshot locale.", cacheIsStale: true),
        onPrimaryAction: {}
    )
    .padding()
    .frame(width: 744)
    .preferredColorScheme(.dark)
}
#endif
#endif
