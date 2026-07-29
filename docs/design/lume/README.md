---
summary: "Manifest degli artefatti visuali Lume, con distinzione tra target, studi, evidenza corrente e materiale legacy."
read_when:
  - "Valutando quale artefatto Lume sia il riferimento visivo da applicare."
  - "Confrontando una superficie web o macOS con il canone visuale Lume."
---

# Lume: manifest degli artefatti visuali

Lume è la lingua visiva attiva approvata in [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md). Il contratto DTCG e il mirror web sono attivi nella candidata locale v0.8. La parità estetica con il canone non è consegnata e la candidata non è una release.

Questo manifest distingue il riferimento da applicare, gli studi, le prove dello stato corrente e il materiale storico. Uno studio o una cattura non sostituiscono il canone.

## Inventario

| Stato | Artefatto | Uso e limite |
| --- | --- | --- |
| `TARGET` | [Canone Lume](#target-canone-versionato) | Riferimento visuale da applicare e verificare. |
| `STUDY` | [Sei mock interattivi](#study-mock-interattivi) | Studi esplorativi, non prova di parità. |
| `CURRENT EVIDENCE` | [Catture runtime](#current-evidence-catture-runtime) | Evidenza dello stato corrente, non del target. |
| `LEGACY` | [Kree8](#legacy-riferimenti-storici) | Riferimenti storici, non direzione visuale attiva. |

## TARGET: canone versionato

Il canone sorgente è [lume-cockpit.template.html](./canon/lume-cockpit.template.html). Il template non contiene font esterni: il build inserisce le versioni base64 dei font locali. Il file HTML generato non è versionato.

| Campo | Valore |
| --- | --- |
| URL sorgente | <https://claude.ai/code/artifact/03b0bb95-0e4f-4383-b54b-c3b5c07a0e75> |
| Titolo | `Lume: il cockpit clinico di MediFlow` |
| Ultimo aggiornamento | 2026-07-15 |
| Provenienza | Ricostruito il 2026-07-16 dal transcript della sessione che lo ha pubblicato, tramite replay di Write, Edit e script di build. Il contenuto è stato verificato byte-identico all'artefatto live. |
| SHA-256 template | `a540eafbe7c3b216f9b1324f5b9a7a66631ed68a01eb1da4c752c2acef0e6502` |
| SHA-256 build atteso | `0c265db8c4174fd22d7b2e532e27669b6f76b8eed44da215432ee2cedcaab127` |

Il build usa `app/fonts/Inter-Variable-Latin.woff2`, `app/fonts/IBM-Plex-Mono-400-Latin.woff2` e `app/fonts/IBM-Plex-Mono-500-Latin.woff2` per sostituire, nell'ordine, `__INTER__`, `__PLEX400__` e `__PLEX500__`.

Rigenerazione e verifica:

```bash
node scripts/build-lume-canon.mjs --verify
```

Senza argomenti il build scrive un file temporaneo e stampa percorso e hash. Per scegliere la destinazione:

```bash
node scripts/build-lume-canon.mjs /tmp/lume-cockpit.html
```

Caratteristiche osservate del canone:

- telaio operativo con lista in penombra e superficie paziente focale;
- nessuna striscia di selezione colorata;
- Inter per la prosa clinica e IBM Plex Mono per codici, date, valori e dosi;
- Filo continuo per la cronologia;
- colore riservato alla semantica clinica;
- varianti Giorno e Grafite.

## STUDY: mock interattivi

Gli studi in [mockups/](./mockups/) sono apribili nel browser e non hanno dipendenze. Servono a discutere ipotesi e comportamento, non a certificare il target.

| File | Oggetto dello studio |
| --- | --- |
| [lume.html](./mockups/lume.html) | Modello focale, due voci e registri Giorno, Grafite e Guardia. |
| [lume-cockpit-vivo.html](./mockups/lume-cockpit-vivo.html) | Studio più vicino al canone, ma non coincidente con esso. |
| [lume-dinamica.html](./mockups/lume-dinamica.html) | Confronto tra filo lineare e luce con inchiostro. |
| [lume-campi.html](./mockups/lume-campi.html) | Campi e densità dell'informazione. |
| [lume-voce.html](./mockups/lume-voce.html) | Ruoli tipografici di Voce e Registro. |
| [lume-impostazioni.html](./mockups/lume-impostazioni.html) | Applicazione del linguaggio alle impostazioni. |

## CURRENT EVIDENCE: catture runtime

Queste immagini sono evidenza dello stato acquisito. Non dichiarano il target
Lume raggiunto né provano la candidata locale senza identità corrente di
worktree, runtime e verifica associata.

Snapshot web di produzione: 2026-07-17, registro Giorno, viewport 1440x900 a
scala 2, fixture esclusivamente sintetiche. Si rigenera con:

```bash
node scripts/build-screenshots.mjs
```

- [01-worklist.png](../../../screenshots/01-worklist.png)
- [02-scheda.png](../../../screenshots/02-scheda.png)
- [03-quadro.png](../../../screenshots/03-quadro.png)
- [04-review.png](../../../screenshots/04-review.png)
- [05-security.png](../../../screenshots/05-security.png)

La cattura
[macos-clinical-workspace.png](../../../screenshots/0.8/macos-clinical-workspace.png)
è evidenza nativa separata. Usa fixture sintetiche deterministiche e non
appartiene alla pipeline web.

## LEGACY: riferimenti storici

- [components/kree8/](../../../components/kree8/)
- [app/mockups/kree8/](../../../app/mockups/kree8/)

Questi materiali sono legacy. Non sono il canone Lume e non dimostrano la parità con il target.

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
