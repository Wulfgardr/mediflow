# 10 — Superficie e materiale: convergenza fra Lume e Liquid Glass

Data: 2026-07-26
Stato: **proposta**, non canone. Le misure riportate sono verificate; l'adozione della direzione resta una decisione di Leonardo.

## Il fatto da cui parte

La ricognizione mostra che la condivisione di Lume è già presente nei valori: `LumePalette`, nel pacchetto Apple, contiene byte per byte gli stessi esadecimali di `docs/design/lume/tokens/lume.tokens.json`, fra cui `#eef0f2`, `#f5f5f4`, `#fbfaf7`, `#e6e8eb`, e gli stessi tre registri giorno, grafite e guardia. Web, iPhone e iPad usavano già quella sorgente comune.

Sul Mac, invece, `LumeSurface` seguiva un ramo separato che associava ogni zona a un colore di sistema. La modifica descritta in questa nota porta anche le superfici di contenuto macOS sulla palette, lasciando il cromo al sistema.

<a id="perche-quel-ramo-esisteva-e-cosa-era-vero"></a>

## Perché quel ramo esisteva, e cosa era vero

Il ramo separato era motivato da due argomenti. Per valutarli, la ricognizione ha misurato i livelli rispetto a una `NSWindow` reale su macOS 27:

| | livelli | passo singolo | escursione totale |
|---|---|---|---|
| Lume grafite | 4 | 1,033 · 1,080 · 1,112 | **1,241** |
| sistema, scuro | 2 | 1,131 | 1,131 |
| Lume giorno | 4 | 1,075 · 1,047 · 1,045 | 1,177 |
| sistema, chiaro | 2 | 1,081 | 1,081 |

L'argomento secondo cui il passo Lume sarebbe troppo tenue nel buio **trova conferma sul singolo gradino**: il sistema produce uno stacco di 1,131, contro 1,033. Lo fa però una volta sola, perché `windowBackgroundColor`, `textBackgroundColor` e `controlBackgroundColor` risolvono allo stesso valore. Una scheda che annidi pannello, sezione e blocco richiede tre gradini: aumentare un solo stacco non consente di distinguerli tutti.

Rimane invece valido l'altro argomento: **un grigio definito esplicitamente non può seguire il materiale della finestra**. Per questo il cromo resta al sistema: in sidebar e toolbar, traslucenza, vibrancy e bordo in scorrimento sono comportamenti della piattaforma, non semplici colori.

## La tensione vera

La differenza non dimostra che il Mac adottasse una soluzione priva di ragioni. Mette in evidenza **due modi diversi di definire una superficie**, sui quali si fondano Lume e Liquid Glass:

- In Lume la superficie è un **valore**: un esadecimale opaco, esplicito e identico fra piattaforme, misurabile con uno script di contrasto.
- In Liquid Glass è una **relazione**: il materiale lascia passare ciò che ha sotto, quindi il colore risultante dipende dal contesto.

Sovrapporre un colore opaco a una regione di materiale non combina i due approcci: elimina l'effetto del materiale. Il commento macOS descriveva proprio questa tensione, parlando di sezioni collocate su una scala che non apparteneva loro; il ramo separato l'aveva risolta scegliendo i colori di sistema.

## Il minimo comune denominatore proposto

La proposta consiste nel separare il significato affidato a Lume dal modo in cui ciascuna piattaforma lo rende visibile.

**Lume mantiene ciò che porta significato, invariato e condiviso**: l'inchiostro `ink.primary` e `ink.muted`, l'accento `minerale`, i quattro segnali clinici indipendenti dal registro (`warning`, `critical`, `success`, `plum`), il concetto dei tre registri e le relazioni tipografiche e geometriche. Nessun materiale di sistema deve alterare questa parte. Rimane il vincolo di `ClinicalSectionAccent`: un colore che dichiari uno stato clinico non è negoziabile per ragioni estetiche.

**Alla piattaforma verrebbe affidata la materializzazione della superficie.** La zona non sarebbe più soltanto un esadecimale, ma indicherebbe **quanto debba arretrare**: `chrome` sotto tutto, seguito da `canvas`, `field` e infine `focal` in evidenza. Apple renderebbe la scala con un materiale reale dove il contesto lo consenta e con la tinta Lume dove serva un valore certo; il web userebbe uno strato con `backdrop-filter` e la stessa tinta.

Il livello resterebbe dunque dichiarato una sola volta, mentre cambierebbe il meccanismo che lo disegna.

## Cosa costa

Questa separazione richiede però di assumere esplicitamente tre costi di implementazione e verifica:

- **L'adattamento non sarebbe più interamente automatico.** Aumenta contrasto e Riduci trasparenza seguivano i colori di sistema; una tinta Lume richiede una gestione esplicita. `ClinicalSectionTitle` legge già `accessibilityReduceTransparency`, quindi esiste un punto in cui intervenire.
- **Il materiale non corrisponde a un colore misurabile fisso.** `ImageRenderer` non riproduce `NSVisualEffectView`: un test a pixel può verificare una tinta, non la visibilità del materiale. Quella parte della verifica dovrebbe quindi tornare sullo schermo reale.
- **Il contrasto testo-fondo deve essere ricalcolato.** `scripts/check-lume-tokens.mjs` misura coppie di valori fissi; quando il fondo dipende dal contenuto sottostante, la garanzia deve riguardare il caso peggiore, non una sola coppia.

## Domande che restano tue

1. **Guardia deve restare un colore o diventare un materiale più scuro?** Alla data della nota è dichiarato nei token, non attivo sul web e reso distinguibile sul nativo dalla modifica descritta. È l'unico registro il cui significato è prevalentemente clinico, anziché estetico.
2. **La rampa grafite richiede intervalli più ampi?** I passi misurati sono 1,033, 1,080 e 1,112. La critica del ramo macOS alla loro debolezza è fondata sul singolo gradino; ampliarli sarebbe possibile senza cambiare architettura.
3. **Il web deve adottare i materiali o mantenere valori pieni?** La convergenza può riguardare solo la scala dei livelli, lasciando Apple sui materiali e il web sui valori. In quel caso l'omogeneità visiva significherebbe stessa gerarchia, non identità dell'immagine.

<a id="cosa-e-gia-vero-e-come-e-stato-verificato"></a>

## Cosa è già vero, e come è stato verificato

- Palette nativa e token web coincidono byte per byte.
- Le superfici di contenuto macOS usano la palette, mentre il cromo resta al sistema.
- Le quattro zone rendono quattro colori distinti in entrambi i registri. Il test attraversa il modificatore, senza limitarsi a confrontare la palette con se stessa: ripristinando i colori di sistema, i livelli passano da 4 a 2.
- Guardia si distingue da grafite; l'assenza precedente di questa distinzione spiegava il fallimento di `LumeKitTests`.
- Il pacchetto SwiftPM registra 406 test e 0 fallimenti.