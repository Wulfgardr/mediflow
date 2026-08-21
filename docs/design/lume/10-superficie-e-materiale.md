# 10 — Superficie e materiale: convergenza fra Lume e Liquid Glass

Data: 2026-07-26
Stato: **proposta**, non canone. Le misure sono verificate; la direzione e' una
decisione di Leonardo.

## Il fatto da cui parte

Lume e' gia' condiviso piu' di quanto sembrasse. `LumePalette` nel pacchetto
Apple contiene gli stessi esadecimali di `docs/design/lume/tokens/lume.tokens.json`,
byte per byte: `#eef0f2`, `#f4f6f8`, `#fbfcfe`, `#e6e8eb` e i tre registri
giorno, grafite, guardia. Web, iPhone e iPad disegnavano gia' da quella stessa
sorgente.

Il Mac no. `LumeSurface` prendeva un ramo separato e mappava ogni zona su un
colore di sistema. Da oggi anche il Mac usa la palette per le superfici di
contenuto, mentre il cromo resta di sistema.

## Perche' quel ramo esisteva, e cosa era vero

La motivazione scritta aveva due argomenti. Misurati contro una `NSWindow` reale
su macOS 27:

| | livelli | passo singolo | escursione totale |
|---|---|---|---|
| Lume grafite | 4 | 1,033 · 1,080 · 1,112 | **1,241** |
| sistema, scuro | 2 | 1,131 | 1,131 |
| Lume giorno | 4 | 1,075 · 1,047 · 1,045 | 1,177 |
| sistema, chiaro | 2 | 1,081 | 1,081 |

Il secondo argomento — "il passo Lume e' troppo timido nel buio" — **e' vero sul
singolo gradino**. Il sistema stacca piu' forte, 1,131 contro 1,033. Ma lo fa una
volta sola: `windowBackgroundColor`, `textBackgroundColor` e `controlBackgroundColor`
risolvono tutti allo stesso valore. Una scheda che annida pannello, sezione e
blocco ha bisogno di tre gradini, e un gradino piu' largo non si puo' spendere
tre volte.

Il primo argomento — "un grigio scritto a mano non puo' seguire il materiale
della finestra" — **resta valido, e non e' stato contraddetto**. Per questo il
cromo non passa a Lume: sidebar e toolbar sono il posto dove traslucenza,
vibrancy e bordo in scorrimento sono comportamento della piattaforma, non colore.

## La tensione vera

Non e' "il Mac sbagliava". E' che Lume e Liquid Glass hanno **due teorie diverse
di cosa sia una superficie**.

- Per Lume una superficie e' un **valore**: un esadecimale opaco, dichiarato,
  identico ovunque, misurabile da uno script di contrasto.
- Per Liquid Glass una superficie e' una **relazione**: un materiale che lascia
  passare cio' che ha sotto, e il cui colore finale non esiste finche' non c'e'
  un contesto.

Le due cose non si sommano. Un esadecimale opaco steso su una regione di
materiale lo spegne, ed e' esattamente cio' che il commento macOS descriveva
quando parlava di sezioni che galleggiano su una scala che non e' la loro. Chi
ha scritto quel ramo aveva sbattuto contro questa tensione e l'aveva risolta
scegliendo un lato.

## Il minimo comune denominatore proposto

Separare cio' che Lume possiede da cio' che possiede la piattaforma.

**Resta a Lume, invariato e condiviso.** L'inchiostro (`ink.primary`,
`ink.muted`), l'accento `minerale`, i quattro segnali clinici indipendenti dal
registro (`warning`, `critical`, `success`, `plum`), i tre registri come
concetto, e le relazioni tipografiche e geometriche. Sono la parte che porta
significato clinico, e nessun materiale di sistema deve poterla spostare. Il
vincolo dichiarato in `ClinicalSectionAccent` vale qui: il colore che dichiara
uno stato clinico non e' negoziabile con l'estetica.

**Passa alla piattaforma il modo in cui una superficie si materializza.** La
zona smette di essere un esadecimale e diventa **quanto quella superficie
recede**: `chrome` sotto tutto, poi `canvas`, poi `field`, poi `focal` in
evidenza. Ogni piattaforma rende quella scala col proprio meccanismo. Su Apple
un materiale reale dove il contesto lo permette e la tinta Lume dove serve un
valore certo; sul web uno strato con `backdrop-filter` e la stessa tinta.

Il livello resta dichiarato una volta sola. Cambia solo chi lo disegna.

## Cosa costa

Va detto, perche' non e' gratis.

- **Si perde l'adattamento automatico** che i colori di sistema portavano con
  se': Aumenta contrasto e Riduci trasparenza agivano da soli. Con una tinta
  Lume vanno gestiti a mano. `accessibilityReduceTransparency` e' gia' letto da
  `ClinicalSectionTitle`, quindi il posto dove metterlo esiste.
- **Un materiale non ha un colore misurabile.** `ImageRenderer` non riproduce
  `NSVisualEffectView`: i test a pixel possono dimostrare che una tinta e'
  giusta, non che un materiale sia visibile. Se le superfici diventano materiali,
  quella parte di verifica torna a dipendere da uno schermo.
- **Il contrasto testo-fondo va ricalcolato.** `scripts/check-lume-tokens.mjs`
  misura oggi coppie di valori fissi. Su un materiale il fondo dipende da cio'
  che passa sotto, quindi la garanzia va espressa come caso peggiore, non come
  coppia.

## Domande che restano tue

1. **Il registro guardia sopravvive come colore o diventa un materiale piu'
   scuro?** Oggi e' dichiarato nei token, non attivo sul web, e da oggi funziona
   sul nativo. E' l'unico registro il cui senso e' clinico piu' che estetico.
2. **La rampa grafite va ridisegnata piu' larga?** I passi misurati sono 1,033,
   1,080 e 1,112. La critica scritta nel ramo macOS diceva che sono troppo
   timidi, e sul singolo gradino ha ragione. Allargarli e' possibile senza
   toccare l'architettura.
3. **Il web adotta i materiali o resta a valori pieni?** La convergenza funziona
   anche a senso unico, con Apple sui materiali e il web sui valori, purche' la
   scala dei livelli sia la stessa. Ma allora "omogeneita' di look" significa
   stessa gerarchia, non stessa immagine.

## Cosa e' gia' vero, e come e' stato verificato

- La palette nativa e i token web coincidono byte per byte.
- Le superfici di contenuto macOS usano la palette; il cromo no.
- Le quattro zone rendono quattro colori distinti in entrambi i registri,
  asserito attraverso il modificatore e non confrontando la palette con se'
  stessa. Rimettendo i colori di sistema il test cade da 4 a 2 livelli.
- Il registro guardia si distingue dal grafite. Prima non si distingueva, ed e'
  la ragione per cui `LumeKitTests` falliva.
- Pacchetto SwiftPM: 406 test, 0 fallimenti.
