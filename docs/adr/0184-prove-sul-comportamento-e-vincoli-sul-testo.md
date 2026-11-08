# ADR 0184: Prove sul comportamento e vincoli sul testo dei sorgenti

Data: 2026-11-08. Stato: Proposta.

Related: regola "Verifica, non review" del 3 novembre 2026,
[ADR 0080](./0080-serialize-sqlite-schema-guards-at-bootstrap.md) per le impronte immutabili dei
predecessori.

## Contesto

Il giro di snellimento dell'8 novembre 2026 ha tolto circa 35.000 righe di
codice mai raggiunto dal prodotto. Ogni rimozione ha richiesto di aggiornare,
oltre ai test del modulo, file che descrivono altri file: allowlist, inventari
degli import, impronte SHA-256, conteggi fissati, test che leggono il sorgente
di un componente e ne controllano il testo con un'espressione regolare.

Misura su `main` 5afa7f0f2, esclusi `experiments/` e `docs/`:

| Che cosa | Quanti |
| --- | --- |
| File di test | 1.015 (192.651 righe) |
| File di test che leggono il testo di un altro sorgente | 160 (38.474 righe) |
| Asserzioni regex sul testo in quei file | 956 |
| Digest SHA-256 fissati in `scripts/`, `lib/`, `components/`, `packages/` | 677 |
| Lunghezze o conteggi fissati nei test | 1.264 |
| Script `check-*` | 28 (8.790 righe) |

I 160 file stanno in `lib/` (70), `lib/security/` (46), `scripts/` (25),
`components/` (10), `packages/` (5) ed altrove (4).

Molti di questi vincoli hanno uno scopo preciso: tengono fermo un confine di
sicurezza, un formato di dati a riposo, un'impronta che un backup già scritto
deve continuare a soddisfare. Altri fissano soltanto la forma attuale del
codice: falliscono a ogni modifica, anche quando il comportamento resta lo
stesso, e restano verdi quando il comportamento cambia senza toccare il testo
controllato. La regola del 3 novembre chiede prove empiriche sul comportamento
osservabile e prove formali su stati ed invarianti. Un controllo sul testo del
sorgente non è né l'una né l'altra.

## Decisione proposta

1. I test nuovi verificano il comportamento: chiamano il codice, una rotta, un
   processo, ed osservano risultati, scritture, errori. Un controllo sul testo di
   un sorgente è ammesso solo nei casi dei punti 2, 3 e 4.
2. Confini di import e di autorità (chi può importare un modulo di sicurezza,
   chi può scrivere una tabella): restano, perché il comportamento da escludere
   non si può osservare prima che qualcuno scriva l'import.
3. Contratti immutabili sui dati: impronte dei predecessori di schema, formati
   di backup, golden condivisi fra Web e client nativi. Restano, con la data e
   il motivo accanto all'impronta.
4. Verifica formale: la copertura di `docs/formal/` fissa i digest dei file
   modellati, così una modifica riapre il controllo del modello.
5. I conteggi fissati nelle selezioni dei test lasciano il posto al controllo
   di completezza che già esiste (`check-test-selection`): un test non
   selezionato è già un errore.

## Piano

- Tranche 1: conteggi fissati delle selezioni (`ci-disposition-selection`,
  `portable-local-test-selection` e simili) sostituiti dal controllo di
  completezza.
- Tranche 2: i dieci file di `components/` che leggono il sorgente di un
  componente: ogni asserzione diventa un test di render o di interazione,
  oppure esce se ripete un test di comportamento esistente.
- Tranche 3: `lib/` e `scripts/`, file per file, con la stessa regola. Per
  `lib/security/` ogni asserzione rimossa ha accanto il test di comportamento
  che la sostituisce o il caso del punto 2 che la giustifica.

Ogni tranche è una PR con la suite completa e il confronto dei nomi dei test
prima e dopo.

## Punto aperto

La scelta dei tre casi ammessi e l'ordine delle tranche restano da approvare.
Fino all'approvazione l'ADR non cambia nessun test esistente.
