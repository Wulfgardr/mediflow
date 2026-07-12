---
summary: "Web (localhost) implementation guide for Vetro Clinico: reference implementation, surface-to-class mapping, refactor list, performance budget."
read_when:
  - "Implementing or reviewing UI in app/ or components/ on the Next.js web app."
---

# Piattaforma: web (localhost)

Il web è l'implementazione di riferimento di Vetro Clinico: qui il linguaggio è nato (WUL-271) e qui si valida prima di propagarsi. Stack: Next.js App Router, Tailwind v4 CSS-first, token in `app/globals.css`.

## 1. Mappa superficie -> classe

| Superficie | Materiale | Classe canonica |
| --- | --- | --- |
| Sidebar / rail cockpit | Vetro strutturale | `.mediflow-sidebar-shell` |
| Header mobile | Vetro strutturale | `.mediflow-mobile-header` |
| Command capsule | Vetro strutturale (riposo) / transitorio (espansa) | `.glass-command-capsule` |
| Card e sezioni cliniche | Carta | `.clinical-paper`, `.mf-section` |
| Righe dense di lista | Carta | `.mf-listrow`, `.apple-list-row` |
| Modali | Vetro transitorio + scrim | `.mf-modal-shell` + `.mf-modal-backdrop` |
| Popover / menu | Vetro transitorio | `.mf-popover` |
| Toast | Vetro transitorio | toast di `toast-provider.tsx` |
| Input / textarea | Carta (campo) | `.mf-input`, `.mf-textarea` |
| Azione primaria | Materiale pieno | `.ui-btn-primary` |
| Azione secondaria | Pill su carta | `.mf-btn-secondary` |
| Skeleton | Carta attenuata | `.mf-skeleton` |

Un componente nuovo che non trova posto in questa tabella è un segnale: o manca una voce al vocabolario (si aggiunge qui, con motivo) o il componente non serve.

## 2. Lavori di consolidamento

La lista operativa con i path è in [02-token.md](../02-token.md) sezione 7 (stile unico, card sui token, badge, dark derivato, alias deprecati, scala tipografica, Geist, sorgente DTCG). In aggiunta, specifiche web:

- **Riassorbire il doppione `X-area` / `live-X-area`** in `components/kree8/areas/`: una sola versione per area, alimentata da dati reali, con gli stati onesti di [04-interazione.md](../04-interazione.md).
- **Rimuovere il chrome morto** censito dalla revisione 2026-07-02 (sidebar legacy, `mobile-shell-chrome`, `patient-list`, `dashboard-insights`): due sistemi di navigazione divergenti sono un costo di coerenza, non una riserva.
- **Bordo di scorrimento sfumato** sotto header e capsule al posto dei divisori (ricetta in [03-materiali.md](../03-materiali.md) sezione 4).
- **View Transitions API** per la continuità Quadro/Scheda quando si affronta l'esplorazione Vetro Vivo: disponibile nei browser che servono a un'app localhost (Chromium, Safari 18+); fallback: nessuna transizione, mai una rotta.

## 3. Budget di prestazione visiva

- Massimo 3 superfici con `backdrop-filter` visibili insieme (il compositing del blur costa, specie su schermi 4K degli studi).
- `will-change: transform` solo su elementi in procinto di muoversi, rimosso a fine transizione.
- Animare solo `transform` e `opacity`; mai layout properties (top/left/width) nelle transizioni.
- Le ombre grandi (`--glass-panel-shadow`) non si animano: si anima l'opacità di un layer ombra pre-renderizzato se serve.
- Niente webfont remoti (vincolo esistente, si conserva: app locale-first, avvio offline).

## 4. Regole spicciole

- Colori, radius, blur, durate: solo dai token; un valore letterale in un componente è un difetto di review.
- `style={{...}}` inline solo per valori davvero runtime (tinte dinamiche dei toni); tutto il resto in classi.
- Dark mode: la variante `dark` è legata alla classe `.dark` (con `@custom-variant`); ogni superficie nuova si verifica in entrambi i temi prima del merge, più i tre segnali di accessibilità.
- Stringhe UI: italiano, niente trattino lungo, niente meta-testo; gli stati vuoti seguono i modelli approvati.
