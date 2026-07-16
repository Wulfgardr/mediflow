---
summary: "Icona di applicazione MediFlow: concetto, conformità HIG Liquid Glass, asset e rigenerazione."
read_when:
  - "Modificando o rigenerando l'icona dell'app per macOS, iOS o web."
  - "Valutando varianti di aspetto (default, dark, tinted) o il passaggio a Icon Composer."
---

# L'icona: il Filo del diario

L'icona di MediFlow è il Filo del diario in verticale: il tempo clinico che scorre
dall'alto verso il basso, con il presente come nodo di luce cerchiato dall'inchiostro
e due punti di riposo agli estremi. È la stessa geometria che nel cockpit connette le
voci del diario: continuità di cura, un solo fuoco.

Non ci sono croci, caducei o tracciati cardiaci: la lingua Lume rifiuta il cliché
medico. Non c'è testo. La forma resta leggibile a 16 pixel.

## Registri

| Variante | Sfondo | Filo | Nodo |
| --- | --- | --- | --- |
| Default (giorno) | gradiente carta `#fbfaf7 -> #eef0f2` | minerale profondo `#33506b` | core bianco, anello d'inchiostro |
| Dark (grafite) | gradiente `#191c21 -> #121417` | minerale chiaro `#8fb0cc` | core `#fbfaf7`, anello minerale |

I valori provengono dai token Lume (`docs/design/lume/tokens/lume.tokens.json`).
La variante tinted la deriva il sistema.

## Conformità alla HIG (guida Liquid Glass, giugno 2026)

- Layer quadrati non mascherati: gli angoli li arrotonda il sistema su ogni piattaforma.
- Nessun effetto cotto negli asset: niente glow, ombre, speculari o bevel; luci e vetro
  li applica il sistema.
- Sfondo semplice (gradiente verticale), contenuto centrato, numero minimo di forme.
- Default chiaro come base; la dark preserva le stesse forme con colori complementari.
- Tratti spessi alle taglie piccole: il generatore adatta lo spessore del filo per
  16, 32, 64 e 128 pixel.

## Asset

- `native/MediFlowAppleApp/Assets.xcassets/AppIcon.appiconset`: iOS single-size 1024
  (any + dark) e matrice macOS 16-512 @1x/@2x.
- `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`: web (Next App Router).
- `docs/design/lume/icona/`: master SVG dei due registri piu' i layer foreground
  (`-fg.svg`, filo e nodi senza sfondo) pronti per Icon Composer.

## Scelte dichiarate

1. Su macOS 14/15 l'icona quadrata piatta non ha la piastra arrotondata legacy: scelta
   deliberata a favore della resa su macOS 26 e successivi, dove il sistema maschera e
   applica il vetro. Le versioni precedenti restano bersagli di ripiego.
2. Il passo successivo facoltativo è il formato Icon Composer (`.icon`) a partire dai
   layer foreground già versionati: consente varianti annotate (default, dark, mono) e
   gli effetti di gruppo. Richiede lo strumento grafico incluso in Xcode.

## Rigenerazione

```bash
node scripts/build-app-icons.mjs /tmp/icone
```

Il generatore rende i master e le preview con Chromium (Playwright). L'antialiasing
può variare tra versioni di Chromium: i PNG committati restano la fonte binaria di
verità; il generatore serve a modificarli con intenzione, non a verificarli byte a byte.
