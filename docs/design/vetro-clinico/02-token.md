---
summary: "Vetro Clinico token architecture: DTCG source of truth, consolidated palette, typography, geometry, motion, and the migration actions."
read_when:
  - "Adding or changing any color, font size, radius, shadow, blur, or duration in MediFlow UI."
  - "Wiring design tokens to a new platform (web, SwiftUI, WinUI, GTK)."
---

# Token

## 1. Architettura a tre livelli

```
Livello 1: primitivi        scale grezze (grigi, tinte semantiche, spazi, radius, blur, durate)
Livello 2: semantici        superficie, inchiostro, segnali clinici, focus, geometria dei contenitori
Livello 3: piattaforma      CSS custom properties (web), enum/Asset catalog (SwiftUI),
                            ResourceDictionary (WinUI), GTK CSS (Linux)
```

I componenti consumano SOLO il livello 2. Il livello 3 è generato o trascritto dal 2, mai inventato sul posto. Il materiale (vetro, Mica, flat) non è un token: è la resa che ogni piattaforma dà al token di superficie (vedi [03-materiali.md](./03-materiali.md)).

**Formato sorgente proposto**: un file `docs/design/vetro-clinico/tokens/vetro-clinico.tokens.json` in formato W3C DTCG (specifica stabile 2025.10). Primo passo senza dipendenze: il JSON è la fonte di verità consultata a mano nei PR. Secondo passo, quando parte la lane tri-OS: build automatica (Style Dictionary o script in-house, coerente con ADR 0070) verso CSS/Swift/XAML/GTK. Esempio di forma:

```json
{
  "color": {
    "signal": {
      "critical": { "$type": "color", "$value": "#a33a2f",
        "$description": "Segnale clinico critico. Sempre accompagnato da testo o glifo." }
    }
  }
}
```

## 2. Palette semantica (valori attuali, consolidati)

I valori sono quelli già in produzione (`app/globals.css`): il consolidamento riguarda chi li consuma, non i valori. Cambiarli è una decisione di design, non di refactoring.

| Token semantico | Light | Dark | Uso |
| --- | --- | --- | --- |
| `surface.base` | `#f6f7f9` | `#111318` | Fondo applicazione |
| `surface.elevated` | `#ffffff` | `#1a1f28` | Carta clinica, card |
| `surface.strong` | `#e8edf3` | (derivare, oggi implicito) | Incassi, well |
| `ink.primary` | `#151316` | `#f4f7fb` | Testo primario |
| `ink.muted` | `#667085` | (da token, non letterali) | Testo secondario, etichette |
| `action.primary` | `#2f3a48` | idem con lift | Azione primaria, brand ink |
| `action.accent` | `#4b5565` | idem | Accenti interattivi |
| `signal.plum` | `#555161` | idem | Categoria/neutro qualificato |
| `signal.warning` | `#9a6a2f` | derivato, non `rgb()` a mano | Attenzione clinica |
| `signal.critical` | `#a33a2f` | derivato | Critico, distruttivo |
| `signal.success` | `#4b6354` | derivato | Esito positivo, conferme |
| `focus.ring` | da `--mf-focus-ring` | idem | Unico anello di focus del sistema |

Regole:

- **Il dark deriva dai token, mai da letterali.** Oggi `.graphite-chip-tone-*` in dark usa `rgb()` scritti a mano (`app/globals.css`, blocco graphite): vanno riespressi come funzione dei token (`color-mix()` in CSS o varianti dark esplicite nel JSON sorgente, una sola volta).
- **Ogni coppia testo/superficie dichiarata qui deve passare 4.5:1** (testo normale) e 3:1 (testo grande, elementi non testuali). `ink.muted` su `surface.base` e i segnali su superfici tinte sono i casi limite: la verifica strumentale è nel contratto di [06-accessibilita.md](./06-accessibilita.md).
- **Niente nuove tinte.** Un bisogno di colore nuovo è quasi sempre un bisogno di gerarchia: prima si prova con peso, dimensione e spaziatura.

## 3. Tipografia

Stack attuale confermato: font di sistema, niente webfont remoti.

```
--mf-font-sans: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

### Ruoli (scala clinica)

| Ruolo | Web (px/lh) | SwiftUI | Fluent (Segoe UI Variable) | GNOME | Note |
| --- | --- | --- | --- | --- | --- |
| Titolo vista | 22/28 semibold, -0.01em | `.title2.weight(.semibold)` | Subtitle | `title-2` | Uno per vista |
| Titolo sezione | 17/24 semibold | `.headline` | Body Strong | `heading` | Card e sezioni |
| Corpo clinico | 15/22 | `.body` | Body | `body` | Lettura di default |
| Corpo denso | 13/18 | `.subheadline` | Caption | `caption` | Liste dense, tabelle |
| Etichetta | 11/14 medium, +0.02em | `.caption` | Caption | `caption-heading` | Chip, intestazioni colonna |
| Micro | 10/13, +0.03em | `.caption2` | Caption | `caption` | Solo metadati, mai dati clinici |

Regole:

- **Pavimento a 10px.** Le utility `3xs` (8px) e `micro` (9px) in `tailwind.config.ts` scendono sotto la leggibilità reale in ambulatorio: si ritirano, i call-site salgono a 10-11px. Il tracking cresce leggermente scendendo di corpo, si stringe sui titoli (mai un solo `letter-spacing` per tutte le taglie).
- **Valori clinici sempre in cifre tabellari**: `font-variant-numeric: tabular-nums` su parametri, laboratorio, posologie, orari; `monospacedDigit()` su SwiftUI. Le colonne di numeri devono restare allineate quando i valori cambiano.
- **Codici (ICD, LOINC, AIC) in mono**: `--font-mono` di sistema, corpo denso.
- **La scala segue l'utente**: spaziature in `rem`/`em` sul web così lo zoom testo scala il layout; Dynamic Type sul nativo (già implicito con gli stili semantici: non introdurre `.font(.system(size:))` fissi).
- **Gerarchia con il peso prima che con la dimensione**: semibold per enfasi, non un corpo in più.

## 4. Geometria

### Raggi concentrici

La regola che tiene insieme le cornici è la concentricità: `raggio interno = raggio esterno - distanza tra i bordi`. Valori canonici attuali:

| Token | Valore | Uso |
| --- | --- | --- |
| `radius.panel` | 30px | Pannelli di primo livello, shell |
| `radius.card` | 24px | Card, sezioni |
| `radius.subsection` | 22px | Sottosezioni dentro card |
| `radius.control` | 16px | Input, select, textarea |
| `radius.chip` | 999px | Chip, pill, bottoni secondari |
| `radius.toast` | 14px | Toast |

Disallineamento noto: il bottone primario usa 18px (`--ui-btn-primary-radius`) contro i 16px degli input. Convergenza proposta: controlli a 16px, senza eccezioni; se il bottone primario deve distinguersi, lo fa con materiale e peso, non con un raggio proprio.

Su Apple, dove disponibile, i contenitori annidati usano le shape concentriche di sistema invece di raggi fissi (vedi [07-piattaforme/apple.md](./07-piattaforme/apple.md)); su Windows i controlli seguono i corner radius Fluent (vedi [07-piattaforme/windows.md](./07-piattaforme/windows.md)).

### Spaziatura

Scala a base 4: `4, 8, 12, 16, 20, 24, 32, 40`. Padding interno delle card: 16-20px in densità comoda, 10-12px in densità densa (vedi [05-responsivita.md](./05-responsivita.md)). La prossimità implica relazione: un controllo sta vicino a ciò che modifica.

## 5. Materia (blur, ombre)

I tier esistono già e restano i due soli livelli di vetro del sistema:

| Token | Blur | Saturazione | Uso |
| --- | --- | --- | --- |
| `material.specular` | 22px | 1.06 | Chrome: modali, command capsule, popover |
| `material.vitreous` | 18px | 1.04 | Pannelli strutturali: sidebar, header |
| `material.scrim` | 8px | + velo scuro radiale | Backdrop dei modali |
| `material.paper` | nessuno | opacità >= 0.94 | Carta clinica (contenuto) |

Ombre canoniche: `--glass-shadow`, `--glass-panel-shadow`, `--glass-card-shadow`, `--paper-shadow` (valori in `app/globals.css`, invariati). Regola: superficie più grande, ombra più profonda e blur più forte; i chip non proiettano quasi nulla. Il bordo superiore chiaro (`inset 0 1px 0 rgba(255,255,255,...)`) è la luce che batte sul vetro: si tiene solo sulle superfici traslucide.

## 6. Motion

| Token | Valore | Uso |
| --- | --- | --- |
| `motion.instant` | 100ms ease-out | Feedback al pointer-down (`:active`) |
| `motion.quick` | 200ms | Hover, fade brevi |
| `motion.standard` | spring smorzata, response 0.3-0.35s, senza overshoot | Transizioni di stato, pannelli |
| `motion.momentum` | spring con damping ~0.8 | Solo dopo gesti con quantità di moto (drag, flick) |
| `motion.reduced` | cross-fade 200ms | Sostituto universale con Reduce Motion |

Le regole d'uso sono in [04-interazione.md](./04-interazione.md). Con `prefers-reduced-motion` o `[data-ui-reduce-motion]` ogni movimento spaziale diventa `motion.reduced`.

## 7. Azioni di consolidamento (con path)

In ordine di resa:

1. **Un solo stile**: verificare che `liquid` e il default implicito non siano raggiungibili, poi fondere `redesign` nella base e rimuovere il branching `data-ui-style` da `app/globals.css` e `app/layout.tsx`. Un linguaggio, un ramo CSS.
2. **`components/ui/card.tsx` sui token**: da `border-slate-200/70 bg-white/80` a `--paper-*` (è carta clinica, non vetro).
3. **`components/ui/badge.tsx`**: ritiro del sistema `palette` legacy, call-site migrati a `tone`; `status-glyph.tsx` resta la resa canonica dei toni.
4. **Dark derivato**: riespressione dei `rgb()` letterali dark di `.graphite-chip-tone-*` come derivazioni dei token.
5. **Coppie duplicate**: `.input-field` e `.ui-btn-secondary` diventano alias deprecati con data di rimozione; i nuovi call-site usano solo `.mf-input`/`.mf-btn-secondary`.
6. **Scala tipografica**: ritiro `3xs`/`micro` 8-9px; sostituzione dei `text-[8px]`/`text-[9px]` residui; adozione `tabular-nums` su parametri e laboratorio.
7. **Pulizia `@theme`**: rimozione di `--font-geist-*` se nessun `next/font` li inietta.
8. **Sorgente DTCG**: creazione di `tokens/vetro-clinico.tokens.json` con i valori di questo documento; da quel momento il JSON precede il CSS.
