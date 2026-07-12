---
summary: "The Vetro Clinico material system: structural glass, clinical paper, transient glass, layering laws, legibility and dark mode rules."
read_when:
  - "Deciding which surface treatment (glass, paper, scrim) a UI region gets."
  - "Touching backdrop-filter, materials, shadows, or scroll edges on any platform."
---

# Materiali

Il sistema ha tre materiali. Tutto ciò che si vede appartiene a uno di questi; se non è chiaro a quale, la risposta è quasi sempre carta.

## 1. I tre materiali

### Vetro strutturale (`material.vitreous`)

Il telaio persistente dell'applicazione: sidebar, header mobile, rail del cockpit, command capsule a riposo. Traslucido perché sotto ci scorre il contenuto, e la trasparenza comunica che il telaio galleggia sopra il lavoro senza possederlo.

- Web: `blur(14px) saturate(1.02)` su fondo `--glass-bg`, bordo `--glass-border`, luce superiore inset. Già applicato da `data-ui-style="redesign"` a `.mediflow-sidebar-shell`, `.mediflow-mobile-header`, `.glass-command-capsule`.
- Apple: `.glassEffect(.regular, in: shape)` su OS 26+, `.regularMaterial` sotto (già così in `VetroClinico.swift`).
- Windows: Mica sulla finestra principale (non Acrylic). Linux GNOME: superficie piatta, niente blur (vedi i documenti di piattaforma).

### Carta clinica (`material.paper`)

La superficie dove si legge e si scrive clinica: Scheda, Quadro, diario, terapie, laboratorio, form. Opaca (>= 0.94), bordo sottile, ombra tenue. È il materiale dominante per area a schermo.

- Web: `.clinical-paper`, `--paper-bg/border/shadow`. La regola `backdrop-filter: none` per le superfici paziente è la norma; gli override successivi che la contraddicono sono debito da ritirare.
- Apple: fondo `surface.elevated` con fill+stroke; le card cliniche non usano `glassEffect`.

### Vetro transitorio (`material.specular`)

Superfici che appaiono e scompaiono: modali, popover, toast, menu, command capsule espansa. Il tier più denso (blur 22px, saturazione 1.06), sopra uno scrim (`material.scrim`: blur 8px + velo scuro) quando l'interazione è modale.

- Web: `.mf-modal-shell`, `.mf-popover`, toast. Apple: sheet e popover di sistema (già glass nativo su OS 26+). Windows: Acrylic (è esattamente il suo dominio: superfici light-dismiss). Linux: dialoghi piatti libadwaita.

## 2. Le leggi di sovrapposizione

1. **Il vetro non tocca mai il dato clinico.** Testo clinico solo su carta. Un modale di conferma può essere vetro perché il suo contenuto è di servizio (titolo, motivazione, bottoni); una card terapia no.
2. **Mai vetro su vetro.** Due superfici traslucide sovrapposte annullano la gerarchia e distruggono la leggibilità (regola HIG esplicita). Se un popover vetro si apre sopra la sidebar vetro, lo scrim li separa, oppure il popover vince e la sidebar sotto è coperta dallo scrim.
3. **Un solo layer di vetro strutturale per regione di schermo**, e budget totale di 3 superfici con `backdrop-filter` visibili contemporaneamente (anche per costo di compositing: il blur è caro su schermi grandi).
4. **La gerarchia si comunica con la profondità** (materiale, ombra, scrim), non aggiungendo colore o bordi pesanti.
5. **Modale = scrim; parallelo = niente scrim.** Un task che blocca (conferma, form modale) attenua lo sfondo. Un pannello parallelo (popover informativo, capsule) convive senza scrim, con la sola separazione del materiale.

## 3. Leggibilità sul vetro

Il vetro ha uno sfondo che cambia: la leggibilità si progetta sul caso peggiore, misurato con contenuto chiaro E scuro sotto la superficie.

- Testo su vetro: mai grigio piatto. Inchiostro pieno (`ink.primary`), peso leggermente maggiore per i corpi piccoli, tracking +0.01-0.02em (ricetta vibrancy).
- Il colore semantico sta sulla carta o nei glifi, non appoggiato sul vetro: sul vetro il colore perde saturazione percepita e affidabilità di contrasto.
- Contrasto misurato nel caso peggiore: 4.5:1 per il testo, 3:1 per icone e bordi di controlli (WCAG 1.4.11), qualunque cosa scorra dietro.
- La lezione della prima release di Liquid Glass (Apple ha ridotto la trasparenza di default e introdotto un regolatore utente nel ciclo 2026): i nostri valori restano conservativi, `--glass-bg` a opacità 0.74 in light è già più prudente del default Apple e non va abbassato.

## 4. Bordi di scorrimento

Niente divisori a 1px sotto il chrome appiccicoso: dove il contenuto passa sotto una barra, si usa il bordo di scorrimento sfumato.

- Web: maschera sfumata (gradiente di `mask-image` o pseudo-elemento con gradiente + blur leggero) che appare solo quando c'è contenuto sotto la barra.
- Apple: `scrollEdgeEffectStyle(.soft, for:)` (iOS 26+); `.hard` solo dove serve un confine netto (liste dense con intestazioni fisse).

## 5. Dark mode

- Il vetro in dark si scurisce, non si schiarisce: fondo scuro traslucido, luce superiore inset ridotta.
- La carta in dark è `surface.elevated` (`#1a1f28`): l'elevazione si comunica schiarendo la superficie, non aumentando l'ombra (l'ombra su fondo scuro sparisce).
- Gli orb decorativi (`--ui-orb-opacity`) scendono ulteriormente in dark; con Reduce Transparency spariscono.
- I segnali clinici dark derivano dai token (vedi [02-token.md](./02-token.md)): mai ricampionati a mano.

## 6. Degrado controllato

| Condizione | Resa |
| --- | --- |
| `prefers-reduced-transparency` / `[data-ui-reduce-transparency]` | Vetro diventa superficie quasi solida: opacità >= 0.95, blur 0. Già cablato sul web; sul nativo va aggiunta la guardia `accessibilityReduceTransparency` in `VetroGlassModifier` (oggi assente). |
| `prefers-contrast: more` / Increase Contrast | Superfici quasi solide + bordi definiti a contrasto 3:1. |
| OS sotto il floor Liquid Glass (iOS < 26, macOS < 26) | `.regularMaterial` o fill+stroke (già così). |
| Windows: Battery Saver, High Contrast, trasparenza OS off | Mica/Acrylic degradano a tinta solida da soli: il layout non deve dipendere dal materiale. |
| Linux GNOME | Il vetro non esiste: carta e superfici piatte con gli stessi token semantici. |

La regola trasversale: **nessuna informazione vive solo nel materiale**. Se il vetro sparisce, la gerarchia resta leggibile con bordi, superfici e spaziatura.
