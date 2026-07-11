---
summary: "Linux platform guide (forward-looking, tri-OS lane): GNOME/libadwaita-first adaptation, flat degradation of Vetro Clinico, KDE and freedesktop conduct."
read_when:
  - "Designing or planning the Linux client (ADR 0068/0071 tri-OS lane), or deciding how Vetro Clinico degrades without glass."
---

# Piattaforma: Linux

Documento previsionale per la lane tri-OS (ADR 0068, ADR 0071). Target primario: GNOME/libadwaita (la HIG più definita); condotta corretta anche su KDE/Plasma via standard freedesktop.

## 1. La regola dura: qui il vetro non esiste

GNOME è flat per scelta di piattaforma: niente blur pesante, niente materiali traslucidi alla Mica o Liquid Glass. Forzare il vetro su GNOME renderebbe MediFlow un corpo estraneo. Vetro Clinico degrada a **Vetro Piatto**: stessa grammatica (token semantici, gerarchia, geometria del canvas, stati onesti, tastiera), materiali resi con superfici piatte e bordi sottili.

| Vetro Clinico | GNOME/libadwaita |
| --- | --- |
| Vetro strutturale | `AdwHeaderBar` e sidebar piatte di sistema |
| Carta clinica | Superficie card standard Adwaita (`.card`), fondo `surface.elevated` |
| Vetro transitorio | `AdwDialog`/popover piatti di sistema |
| Scrim | Dim standard dei dialoghi |
| Segnali clinici | Restano i token MediFlow (il significato non cambia per piattaforma) |
| Azione primaria / distruttiva | Stili `suggested-action` / `destructive-action` |

Il brand su libadwaita si esprime con accent, iconografia e la qualità della struttura, non con materiali custom: è la via indicata dalla HIG GNOME e la assumiamo in pieno.

## 2. Struttura

- **`AdwNavigationSplitView` / `AdwOverlaySplitView`** per worklist + contenuto; **`AdwBreakpoint`** mappa le fasce di [05-responsivita.md](../05-responsivita.md) (compatta: pannello singolo; ampia: split).
- **Header bar** con titolo e azioni integrate: il chrome dell'app è quello di sistema, non una barra propria.
- **Tipografia**: font di sistema (Cantarell su GNOME), ruoli mappati sugli stili Adwaita (`title-2`, `heading`, `body`, `caption`); la scala clinica si rispetta nei rapporti, non nei pixel.
- **Icone**: simboliche, risolte via icon theme (lookup freedesktop, non asset fissi), così Breeze su Plasma le sostituisce correttamente; i glifi di stato clinico mantengono forma e significato.
- **Dark**: seguire la preferenza di sistema via portal (`color-scheme`), mai un toggle che ignora il desktop.

## 3. Condotta cross-desktop (KDE e oltre)

- Rispettare gli standard freedesktop: file `.desktop`, naming delle icone, portals per file/preferenze.
- Mai forzare un tema proprio sopra il tema attivo; su Plasma l'app deve sembrare a casa con Breeze (breeze-gtk fa il grosso se si resta dentro libadwaita).
- Fractional scaling e Wayland come caso primario, X11 come compatibilità.

## 4. Scenario shell nativa + canvas web

Come per Windows ([windows.md](./windows.md)): se il client Linux usa una shell nativa con canvas web, la shell è GTK/libadwaita pura e il canvas interno adotta comunque la variante piatta: su questa piattaforma anche il canvas rinuncia al blur strutturale (coerenza con l'ambiente e costo compositing su hardware eterogeneo). Il vetro resta ammesso solo, con moderazione, negli overlay transitori interni al canvas.

## 5. Verifica

- Smoke visivo su GNOME (ultima stabile) e su Plasma con Breeze.
- Test con testo grande di sistema e con dark attivo via portal.
- Nessuna dipendenza dell'informazione dal materiale: già garantito dalla legge trasversale di [03-materiali.md](../03-materiali.md).

Riferimenti: GNOME HIG (UI styling, adaptive, header bars), documentazione libadwaita (adaptive layouts, breakpoints), KDE HIG per icone e integrazione.
