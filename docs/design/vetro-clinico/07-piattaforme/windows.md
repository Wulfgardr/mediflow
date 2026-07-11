---
summary: "Windows platform guide (forward-looking, tri-OS lane): Fluent 2 mapping for Vetro Clinico, Mica/Acrylic usage, type ramp, chrome boundary."
read_when:
  - "Designing or planning the Windows client (ADR 0068/0071 tri-OS lane), or mapping Vetro Clinico onto Fluent."
---

# Piattaforma: Windows

Documento previsionale: guida la lane tri-OS (ADR 0068, ADR 0071) quando il client Windows nativo prende forma. Riferimento: Fluent 2 + WinUI 3.

## 1. Mappa dei materiali

Fluent ha già i suoi materiali: Vetro Clinico si traduce, non si trapianta.

| Vetro Clinico | Fluent | Nota |
| --- | --- | --- |
| Vetro strutturale | **Mica** sulla finestra principale | Mica è opaco e tinto dal wallpaper: è il vetro "calmo" di Windows. MAI Acrylic su superfici persistenti. |
| Pannelli con contenuto denso | **Mica Alt** | Maggiore profondità tonale per pannelli laterali. |
| Carta clinica | **Layer fill** (`LayerFillColorDefaultBrush`) sopra Mica | Il contenuto clinico sta su layer solidi. |
| Vetro transitorio | **Acrylic** | Il suo dominio naturale: flyout, menu, popover light-dismiss. |
| Scrim | Smoke layer di sistema per i dialoghi | |

I materiali degradano da soli (High Contrast, Battery Saver, trasparenza OS disattivata): il layout non deve dipendere dal materiale, stessa legge di [03-materiali.md](../03-materiali.md).

## 2. Struttura

- **Navigazione**: `NavigationView` in modalità left rail = il rail del cockpit; adattiva da sola sulle fasce di [05-responsivita.md](../05-responsivita.md).
- **Titlebar**: contenuto esteso nella barra del titolo (`ExtendsContentIntoTitleBar`) con drag region esplicita e controlli finestra di sistema intatti; l'identità dell'app vive lì come nel chrome web.
- **Controlli**: corner radius Fluent (controlli 4-8px), NON i 16-24px del web: i controlli appartengono alla piattaforma. La geometria Vetro Clinico (card 24px, pannelli 30px) si conserva solo dentro il canvas clinico, dove è brand, non piattaforma.
- **Tipografia**: Segoe UI Variable con il type ramp Fluent; la scala clinica di [02-token.md](../02-token.md) si mappa sui ruoli (Body 14, Body Strong, Subtitle 20, Caption 12), non si impone al pixel.
- **Colore**: i segnali clinici restano i token Vetro Clinico (il significato clinico non segue l'accent utente); l'accent di sistema può guidare gli stati interattivi neutri (focus, selezione) dove non c'è semantica clinica.

## 3. Scenario shell nativa + canvas web

Se la lane tri-OS approda a shell nativa con canvas renderizzato in web tech (pattern Raycast, coerente con il core condiviso di ADR 0071), il confine è netto:

- La shell (titlebar, menu, tray, notifiche, finestre) è Fluent puro.
- Il canvas interno conserva Vetro Clinico web ([web.md](./web.md)), con Mica dietro al posto del fondo `surface.base`.
- Niente doppio chrome: il rail vive o nella shell o nel canvas, mai in entrambi.

## 4. Integrazione di sistema

- Temi: seguire light/dark di Windows; High Contrast mappato sul segnale Increase Contrast del sistema.
- Snap layouts, ridimensionamento per-monitor DPI, finestra minima 1024x700.
- Scorciatoie: `Ctrl` al posto di `Cmd`, stessa mappa logica del cockpit.
- Icone: Segoe Fluent Icons per il chrome di sistema; i glifi clinici del sistema restano i nostri (coerenza cross-piattaforma del significato).

Riferimenti: Fluent 2 (materiali, tipografia), Microsoft Learn su Mica/Acrylic/system backdrops, guida WinUI 3 per titlebar custom.
