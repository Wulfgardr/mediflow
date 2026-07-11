---
summary: "Responsive strategy and density model: breakpoint roles, panel layout, touch vs pointer, text scaling."
read_when:
  - "Designing layout behavior across window sizes, adding a density option, or touching mobile/tablet adaptations."
---

# Responsività e densità

## 1. Ruoli dei breakpoint

I breakpoint Tailwind restano quelli standard; quello che il sistema fissa è il ruolo di ciascuna fascia. Ogni vista dichiara come si comporta in ognuna, non solo "si restringe".

| Fascia | Larghezza | Ruolo | Shell |
| --- | --- | --- | --- |
| Compatta | < 768px | Un compito alla volta. Un pannello, navigazione a fondo schermo. | `.mediflow-mobile-header` + `.mediflow-mobile-nav` (safe-area già gestita) |
| Regolare | 768-1279px | Lista o dettaglio, con rail. Il cockpit mostra un pannello primario e la worklist a scomparsa. | Rail + pannello |
| Ampia | 1280-1599px | Cockpit pieno: worklist + Quadro affiancati. | Rail + due pannelli |
| Estesa | >= 1600px | Tre pannelli (worklist, Quadro, azioni/coda): il layout Elation, dove l'80% dei task ricorrenti non cambia schermata. | Rail + tre pannelli |

Equivalenze di piattaforma: compatta = iPhone/size class compact; regolare = iPad ritratto/finestre medie; ampia ed estesa = desktop. Su Apple la scelta la fanno le size class (già così nella root nativa: `TabView` compact, `NavigationSplitView` regular); su GNOME i `AdwBreakpoint`; su Windows `NavigationView` adattiva.

Regole:

- **I pannelli sono ridimensionabili entro minimi sensati** (worklist min 320px, contenuto min 560px), non slot fissi: gli studi medici hanno monitor eterogenei. La colonna lista fissa a 360pt del workspace nativo va resa flessibile.
- **Nessuna funzione esiste solo in una fascia.** In compatta cambia la disposizione, non il vocabolario delle azioni.
- **Il layout scala con il testo**: spaziature in `rem`/`em` sul web (lo zoom testo del browser deve allargare il layout, non romperlo); Dynamic Type sul nativo, verificato alle taglie massime.

## 2. Densità

Due densità, un solo linguaggio. La densità è una preferenza ergonomica (stesso asse di Reduce Motion/Transparency, che già esistono come attributi), non uno stile alternativo: ADR 0047 non è toccato, ma l'introduzione della preferenza richiede il suo mini-ADR.

| | Comoda (default) | Densa |
| --- | --- | --- |
| Riga di lista | 44px | 32px |
| Corpo | 15px | 13px |
| Padding card | 16-20px | 10-12px |
| Target minimi | invariati: 24x24px puntatore, 44x44px touch | invariati |

- La densa serve le superfici di volume: worklist, laboratorio, terapie in polifarmacoterapia. Le superfici di lettura (Quadro, diario) restano comode anche in modalità densa.
- Implementazione: un attributo (`data-ui-density="dense"`) che ridefinisce i token dimensionali, non classi per componente.
- Su touch la densa non scende sotto i target: le righe restano 44px di area interattiva anche se visivamente più strette (padding di hit esteso).

## 3. Touch e puntatore

- **Touch**: target 44x44pt (Apple) / 48dp (dove si arriverà su altri OS mobili); niente affordance solo-hover: ciò che l'hover rivela (azioni riga, scorciatoie) ha un equivalente touch (menu contestuale, azione esplicita).
- **Puntatore**: minimo WCAG 24x24px; hover ricco ammesso (anteprime, azioni riga) purché ridondante.
- **Penna/iPad**: nessun gesto obbligatorio senza alternativa visibile (regola HIG già nel contratto di accessibilità).

## 4. Finestre e multitasking

- Su iPad e macOS l'app regge Split View/finestre strette: sotto i 768px logici si degrada alla fascia regolare/compatta, senza viste rotte.
- Su desktop la finestra minima supportata è 1024x700; sotto, si passa alla disposizione regolare.
- Stato per finestra: due finestre della stessa app (macOS) non si rubano lo stato del cockpit a vicenda.
