---
summary: "Manifest degli artefatti visuali Lume, con distinzione tra target, studi, evidenza corrente e materiale legacy."
read_when:
  - "Valutando quale artefatto Lume sia il riferimento visivo da applicare."
  - "Confrontando una superficie web o macOS con il canone visuale Lume."
---

# Lume: manifest degli artefatti visuali

Lume è la lingua visiva approvata da [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md). Il manifest documenta il percorso avviato nella candidata locale v0.8, nella quale erano attivi contratto DTCG e mirror web, ma non era consegnata la parità estetica con il canone. Quella candidata non costituiva una release.

Per confrontare una superficie occorre scegliere il riferimento corretto: il canone indica la destinazione, gli studi esplorano possibilità e le catture documentano ciò che è stato osservato. Questo manifest li distingue dal materiale storico, evitando che uno studio o una schermata siano assunti come canone.

## Inventario

| Stato | Artefatto | Uso e limite |
| --- | --- | --- |
| `TARGET` | [Canone Lume](#target-canone-versionato) | Riferimento visuale da applicare e verificare. |
| `STUDY` | [Sei mock interattivi](#study-mock-interattivi) | Studi esplorativi, non prova di parità. |
| `CURRENT EVIDENCE` | [Catture runtime](#current-evidence-catture-runtime) | Evidenza dello stato corrente, non del target. |
| `LEGACY` | [Kree8](#legacy-riferimenti-storici) | Riferimenti storici, non direzione visuale attiva. |

## TARGET: canone versionato

Il riferimento sorgente è [lume-cockpit.template.html](./canon/lume-cockpit.template.html). Il template non richiama font esterni: durante la build vengono inserite le versioni base64 dei font locali, mentre l'HTML generato non viene versionato.

| Campo | Valore |
| --- | --- |
| URL sorgente | <https://claude.ai/code/artifact/03b0bb95-0e4f-4383-b54b-c3b5c07a0e75> |
| Titolo | `Lume: il cockpit clinico di MediFlow` |
| Ultimo aggiornamento | 2026-07-15 |
| Provenienza | Ricostruito il 2026-07-16 dal transcript della sessione che lo ha pubblicato, tramite replay di Write, Edit e script di build. Il contenuto è stato verificato byte-identico all'artefatto live. |
| SHA-256 template | `a540eafbe7c3b216f9b1324f5b9a7a66631ed68a01eb1da4c752c2acef0e6502` |
| SHA-256 build atteso | `0c265db8c4174fd22d7b2e532e27669b6f76b8eed44da215432ee2cedcaab127` |

La build sostituisce nell'ordine `__INTER__`, `__PLEX400__` e `__PLEX500__` con `app/fonts/Inter-Variable-Latin.woff2`, `app/fonts/IBM-Plex-Mono-400-Latin.woff2` e `app/fonts/IBM-Plex-Mono-500-Latin.woff2`.

Rigenerazione e verifica:

```bash
node scripts/build-lume-canon.mjs --verify
```

Senza argomenti, la build produce un file temporaneo e ne stampa percorso e hash. Per indicare una destinazione si usa:

```bash
node scripts/build-lume-canon.mjs /tmp/lume-cockpit.html
```

Il canone osservato organizza il lavoro secondo queste caratteristiche:

- Il telaio operativo lascia la lista in penombra e assegna il fuoco alla superficie paziente.
- La selezione non è indicata da una striscia colorata.
- La prosa clinica usa Inter; codici, date, valori e dosi usano IBM Plex Mono.
- La cronologia è collegata da un Filo continuo.
- Il colore rimane riservato alla semantica clinica.
- Sono presenti le varianti Giorno e Grafite.

## STUDY: mock interattivi

I file di [mockups/](./mockups/) si aprono nel browser senza dipendenze. Servono a discutere ipotesi e comportamenti, non a certificare il raggiungimento del target.

| File | Oggetto dello studio |
| --- | --- |
| [lume.html](./mockups/lume.html) | Modello focale, due voci e registri Giorno, Grafite e Guardia. |
| [lume-cockpit-vivo.html](./mockups/lume-cockpit-vivo.html) | Studio più vicino al canone, ma non coincidente con esso. |
| [lume-dinamica.html](./mockups/lume-dinamica.html) | Confronto tra filo lineare e luce con inchiostro. |
| [lume-campi.html](./mockups/lume-campi.html) | Campi e densità dell'informazione. |
| [lume-voce.html](./mockups/lume-voce.html) | Ruoli tipografici di Voce e Registro. |
| [lume-impostazioni.html](./mockups/lume-impostazioni.html) | Applicazione del linguaggio alle impostazioni. |
| [lume-un-fuoco-una-risposta.html](./mockups/lume-un-fuoco-una-risposta.html) | Studio di consolidamento web: testata unica, rail a 4 gruppi, delta prima dei conteggi, stati azionabili, palette ⌘K. |
| [mini-sessione.html](./mockups/mini-sessione.html) | Studio della CLI headless «Mini»: sessione tipo con lease, provenance, diniego onesto e artefatti a scope chiuso. |

## CURRENT EVIDENCE: catture runtime

Le catture documentano lo stato nel quale sono state acquisite. Per usarle come prova di una candidata locale occorrono l'identità ancora valida di worktree e runtime e la verifica associata; da sole non dimostrano che il target Lume sia stato raggiunto.

Gli snapshot web di produzione del 2026-07-17 usano il registro Giorno, viewport 1440x900 a scala 2 e fixture esclusivamente sintetiche. La rigenerazione avviene con:

```bash
node scripts/build-screenshots.mjs
```

- [01-worklist.png](../../../screenshots/01-worklist.png)
- [02-scheda.png](../../../screenshots/02-scheda.png)
- [03-quadro.png](../../../screenshots/03-quadro.png)
- [04-review.png](../../../screenshots/04-review.png)
- [05-security.png](../../../screenshots/05-security.png)

[macos-clinical-workspace.png](../../../screenshots/0.8/macos-clinical-workspace.png) documenta invece una prova nativa separata: usa fixture sintetiche deterministiche e non appartiene alla pipeline web.

## LEGACY: riferimenti storici

- [components/kree8/](../../../components/kree8/)
- [app/mockups/kree8/](../../../app/mockups/kree8/)

Kree8 resta un riferimento storico: questi materiali non definiscono il canone Lume e non provano la parità con esso.

## Documenti e contratti collegati

1. [01-lingua.md](./01-lingua.md): specifica della lingua, del modello focale, del filo e della tipografia.
2. [02-derivazione.md](./02-derivazione.md): ricerca e motivazioni della direzione.
3. [03-migrazione.md](./03-migrazione.md): percorso di migrazione e rischi dichiarati.
4. [04-perlustrazione.md](./04-perlustrazione.md): perlustrazione EHR e provider.
5. [05-app-native.md](./05-app-native.md): mappa delle app native e note tri-OS.
6. [06-macos-apple-contract.md](./06-macos-apple-contract.md): contratto di destinazione macOS.
7. [07-gesto-e-movimento.md](./07-gesto-e-movimento.md): grammatica del gesto e del movimento.
8. [Token Lume](./tokens/lume.tokens.json): contratto DTCG dei registri e dei colori.
9. [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md): decisione di prodotto, ledger di implementazione e condizioni della convivenza.
