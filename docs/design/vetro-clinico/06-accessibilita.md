---
summary: "WCAG 2.2 AA contract for Vetro Clinico, glass worst-case verification, platform-specific a11y gaps and test matrix."
read_when:
  - "Reviewing accessibility of any surface, adding a colored signal, or shipping UI that uses translucency or motion."
---

# Accessibilità

Software clinico: chi lo usa può avere vista affaticata, luce ambientale pessima, fretta, o una disabilità. Il contratto è WCAG 2.2 AA su web e l'equivalente di piattaforma sul nativo. Non è una checklist finale: ogni voce qui è un vincolo di progettazione.

## 1. Contratto

| Requisito | Soglia | Note MediFlow |
| --- | --- | --- |
| Contrasto testo | 4.5:1 (normale), 3:1 (grande) | Da verificare per ogni coppia dei token; `ink.muted` e i segnali su superfici tinte sono i casi limite da misurare, non da stimare. |
| Contrasto non testuale | 3:1 | Bordi di input, icone-azione, focus ring, glifi di stato. |
| Target | >= 24x24px puntatore, 44pt touch | Vale anche in densità densa (hit area estesa). |
| Focus visibile | Anello >= 2px, contrasto 3:1 tra stato focused e non | Unico anello: `--mf-focus-ring`, via `:focus-visible`. |
| Tastiera | Ogni flusso completabile senza puntatore | Vedi [04-interazione.md](./04-interazione.md). |
| Reduced motion | Movimento spaziale sostituito da cross-fade | Già cablato web; da rispettare sul nativo quando si aggiungono transizioni. |

## 2. Il caso peggiore del vetro

Le superfici traslucide si verificano con il contenuto peggiore dietro: testo fitto chiaro E scuro in scorrimento. La misura si fa sul risultato composito (screenshot campionato), non sul colore nominale del token. Se una combinazione non regge il 4.5:1 nel caso peggiore, si alza l'opacità del vetro o si sposta il testo su carta: non si "spera" nello sfondo tipico.

## 3. Il colore non lavora mai da solo

Regola già nei principi, qui resa operativa: ogni stato clinico colorato (critico, attenzione, successo) è sempre espresso anche da testo o glifo (`status-glyph.tsx` è la resa canonica; `StatusBadge` sul nativo). Verifica daltonismo: le coppie warning/critical e success/info devono restare distinguibili in simulazione protanopia/deuteranopia; se non lo sono, cambia il glifo, non il colore.

## 4. Preferenze di sistema e in-app

Tre segnali indipendenti, tutti già presenti sul web come attributi (`data-ui-reduce-transparency`, `data-ui-reduce-motion`) e media query (`prefers-contrast`, `prefers-reduced-motion`):

| Segnale | Resa |
| --- | --- |
| Reduce Transparency | Vetro quasi solido, blur 0 (vedi [03-materiali.md](./03-materiali.md)). |
| Reduce Motion | `motion.reduced` ovunque; niente parallasse, niente morphing. |
| Increase Contrast | Bordi definiti 3:1, superfici quasi solide, focus ring rinforzato. |

## 5. Gap nativi Apple (da chiudere)

In ordine di gravità, dalla ricognizione 2026-07-11:

1. **`VetroGlassModifier` ignora `accessibilityReduceTransparency`**: aggiungere `@Environment(\.accessibilityReduceTransparency)` e degradare a superficie solida (stessa legge del web).
2. **`accessibilityLabel` quasi assenti** (2 in tutto, a fronte di centinaia di `accessibilityIdentifier` che servono solo ai test): passata VoiceOver su `PairedPatientsWorkspaceView`, con label per azioni, valori (`accessibilityValue` su parametri e trend) e raggruppamenti (`accessibilityElement(children: .combine)` sulle righe).
3. **`reduceMotion` esiste, ma la copertura va verificata; `differentiateWithoutColor` manca**: `VetroGlassModifier` degrada il materiale e la shell disabilita le animazioni quando richiesto. Verificare ogni transizione esplicita e introdurre la guardia colore insieme ai glifi di stato.
4. **Dynamic Type non verificato agli estremi**: le viste vanno esercitate alle taglie accessibility (AX1-AX5), con `ViewThatFits` o layout alternativi dove il master-detail manuale trabocca.

## 6. Lettori di schermo e semantica

- Overlay: `role="dialog"` + focus trap + ritorno del focus (standard: `useDialogA11y`, già usato da confirm-dialog; i modali restanti si allineano, finding noto della revisione 2026-07-02).
- Esiti: toast già con `aria-live="polite"`/`role="alert"`; gli errori inline si collegano al campo con `aria-describedby`.
- Autocomplete clinici: pattern combobox ARIA completo (vedi [04-interazione.md](./04-interazione.md)).
- Tabelle/liste dense: intestazioni di colonna vere (o `aria-` equivalenti), non solo tipografia.

## 7. Matrice di verifica

| Verifica | Strumento | Quando |
| --- | --- | --- |
| Contrasti token (light, dark, densità) | Misura automatica sulle coppie dichiarate in [02-token.md](./02-token.md) | A ogni modifica dei token |
| Scansione assiomatica pagine | axe (o equivalente) su cockpit, Scheda, form | In CI web, quando la lane CI web nasce |
| Caso peggiore vetro | Screenshot compositi campionati, light e dark | A ogni modifica dei materiali |
| VoiceOver / NVDA / Orca | Passata manuale sui flussi principali | A ogni release che tocca la navigazione |
| Reduce Transparency/Motion/Contrast | Smoke visivo con i tre segnali attivi | A ogni modifica di materiali o motion |
| Dynamic Type estremo (nativo) | Preview/simulatore AX5 | A ogni vista nuova o rivista |
