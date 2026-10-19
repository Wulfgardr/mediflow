# ADR 0152 — Confine delle dipendenze di piattaforma del profilo (BT-08)

- Stato: Accepted con l'integrazione protetta, dopo review indipendente e WUL-579/585
- Data: 2026-10-19
- Riferimenti: WUL-580; ADR 0151; ADR 0145; ADR 0052

## Decisione

Il pacchetto dei contratti del profilo contiene soltanto valori, parser, limiti
e identificativi già provati. Gli unici import ammessi al suo interno sono
relativi a sorgenti TypeScript nello stesso pacchetto. Tutti i sorgenti di quel
grafo sono esaminati dalla scansione esistente
`scripts/check-headless-portable-imports.mjs`, inclusi i moduli intermedi; un
collegamento simbolico non può sottrarre un file alla scansione.

Questo esclude dipendenze Next, database/schema, rete, Keychain, launchd,
systemd, schtasks, MLX e CUDA. I riferimenti ai globali browser e alla piattaforma
del processo sono respinti. Il typecheck dedicato usa `ES2023` e i tipi Node,
senza DOM, React o plugin Next. `TextEncoder`, già usato dal contratto, misura
gli stessi byte UTF-8 nel runtime Node 24 nominato dalla release.

Le route HTTP del pilota rimangono adapter Web e possono importare il framework.
La stessa scansione verifica separatamente che le route paziente Web/v1/paired,
notes-commit, review e selection-epoch non importino direttamente database,
driver o schema. Il loro accesso ai dati passa dalle porte applicative esistenti.
Non si tratta di spostare le dipendenze OS dentro un helper del pacchetto:
qualsiasi import che esca dal suo grafo puro fallisce.

## Confini operativi

SQLite, transazioni, audit, cifratura, custodia delle chiavi e gestione della
generazione dell'archivio conservano i rispettivi owner. I processi di avvio e
gli adapter specifici del sistema restano fuori dal pacchetto. Nessuna scelta
di piattaforma, endpoint o backend viene aggiunta ai messaggi del pilota e non
compare un fallback in caso di errore del writer.

La conformità macOS/Linux/Windows esegue gli stessi vettori nella suite Headless
Node 24 già obbligata a una selezione completa. I negativi della scansione
inseriscono dipendenze vietate in un modulo transitivo e nelle route; la mancanza
del pacchetto è un errore. La CI verifica anche il typecheck senza DOM su ogni
sistema. Non si ricava da questi controlli il funzionamento della finestra GPUI,
del packaging, delle chiavi di sistema o dei dispositivi iPhone/iPad.

La reversione dell'estrazione riguarda import e posizione dei sorgenti, come
BT-07. Non cambia alcun dato persistente né riattiva sessioni o conferme ritirate
da un ripristino dell'archivio.
