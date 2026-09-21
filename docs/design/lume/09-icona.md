---
summary: "Icona di applicazione MediFlow: concetto, conformità HIG Liquid Glass, asset e rigenerazione."
read_when:
  - "Modificando o rigenerando l'icona dell'app per macOS, iOS o web."
  - "Valutando varianti di aspetto (default, dark, tinted) o il passaggio a Icon Composer."
---

# L'icona: il Filo del diario

L'icona riprende la geometria con cui il cockpit collega le voci del diario: un Filo verticale lungo il quale il tempo clinico procede dall'alto verso il basso. Il presente è il nodo di luce circondato dall'inchiostro, fra due punti di riposo agli estremi; continuità della cura e unicità del fuoco rimangono così riconoscibili anche fuori dalla cartella.

Per mantenere leggibile questa forma fino a 16 pixel, l'icona non contiene testo né croci, caducei o tracciati cardiaci. L'identità deriva dalla lingua Lume, non da un simbolo medico convenzionale.

## Registri

| Variante | Sfondo | Filo | Nodo |
| --- | --- | --- | --- |
| Default (giorno) | gradiente carta `#fbfaf7 -> #eef0f2` | minerale profondo `#33506b` | core bianco, anello d'inchiostro |
| Dark (grafite) | gradiente `#191c21 -> #121417` | minerale chiaro `#8fb0cc` | core `#fbfaf7`, anello minerale |

Le due varianti usano i valori dei token Lume in `docs/design/lume/tokens/lume.tokens.json`; la variante tinted viene invece derivata dal sistema.

## Conformità alla HIG (guida Liquid Glass, giugno 2026)

- I layer restano quadrati e non mascherati, perché sia il sistema ad arrotondarne gli angoli su ciascuna piattaforma.
- Gli asset non incorporano glow, ombre, riflessi speculari o bevel: luce e vetro vengono applicati dal sistema.
- Lo sfondo è un gradiente verticale semplice, con contenuto centrato e il minimo numero di forme.
- Il default chiaro costituisce la base; la variante dark mantiene le stesse forme e usa colori complementari.
- Per conservare la leggibilità nelle taglie piccole, il generatore adatta lo spessore del Filo a 16, 32, 64 e 128 pixel.

## Asset

- `native/MediFlowAppleApp/Assets.xcassets/AppIcon.appiconset`: iOS single-size 1024, any + dark, e matrice macOS 16-512 @1x/@2x.
- `app/icon.svg`, `app/favicon.ico`, `app/apple-icon.png`: asset web per Next App Router.
- `docs/design/lume/icona/`: master SVG dei due registri e layer foreground `-fg.svg`, con filo e nodi senza sfondo, predisposti per Icon Composer.

## Scelte dichiarate

1. Su macOS 14/15 l'icona quadrata piatta non adotta la piastra arrotondata legacy: la scelta privilegia macOS 26 e successivi, dove il sistema applica maschera e vetro. Le versioni precedenti mantengono la resa di ripiego.
2. Il passaggio facoltativo a Icon Composer (`.icon`) può partire dai layer foreground già versionati, per ottenere varianti annotate default, dark e mono ed effetti di gruppo. Richiede lo strumento grafico incluso in Xcode.

## Rigenerazione

```bash
node scripts/build-app-icons.mjs /tmp/icone
```

Il generatore usa Chromium tramite Playwright per renderizzare master e preview. Poiché l'antialiasing può cambiare fra versioni di Chromium, il confronto byte per byte deve fare riferimento ai PNG committati: il generatore serve a modificarli deliberatamente, non a riprodurne necessariamente gli stessi byte.