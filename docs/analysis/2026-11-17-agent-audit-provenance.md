# Schema 12 e provenienza delle proposte agenti

Data: 2026-11-17. Refs WUL-872, ADR 0190.

## Risultato

Schema 12 aggiunge `proposer_ref`, `mandate_ref` e `model_provider` al
registro audit. La superficie `agent` richiede un autore `user`, riferimenti
opachi di agente e mandato e fornitore dichiarato. Un campo mancante o
invalido interrompe il commit. I dati provengono dal contesto fidato del
writer, senza leggere valori di autorità dal payload HTTP.

Tutti gli otto elementi della prova di composizione conservano nella stessa
transazione medico autore, proponente, mandato e fornitore. Il diario
continua a salvare `recorded_by` dal medico autenticato. La lettura del
registro restituisce i tre campi distinti dall'autore. I wrapper ordinari
mantengono la propria superficie e non acquisiscono una provenienza agente.

Le righe storiche ricevono soltanto colonne nullable, senza riscrivere
attribuzioni o eventi. Le esportazioni mantengono il formato storico delle
righe senza provenienza; le righe agente conservano anche i tre campi. Il
ripristino confronta anche la provenienza quando verifica collisioni.

## Apertura e recupero

L'apertura versionata conserva un originale v11 verificato prima del DDL.
La riapertura di un archivio 12 non esegue DDL. Un errore iniettato dopo la
seconda nuova colonna annulla tutte le colonne e lo stamp, conservando la
possibilità di riprovare.

Il recupero cifrato ammette il predecessore v11 con impronta
`0702a61e6f2a1feaca7df3350ec6597dcd5213c48339fdce723cf4531e33e8ee`,
verificata sul bootstrap v11 originale della revisione `0dd19cf33`.
La ricostruzione delle versioni precedenti esclude le colonne nate con la
12 prima di confrontarle. Le impronte immutabili 3, 4, 5, 6, 9 e 10 non
cambiano e i casi negativi continuano a rifiutare schemi alterati.

## Prove

`lib/agent-audit-provenance.test.ts` prova gli otto writer, il diniego della
provenienza invalida, la lettura del registro, il round trip dell'artefatto
backup e l'errore audit in ciascuna posizione con zero scritture residue.
`lib/sqlite-schema-open.test.ts` prova originale verificato, recuperabilità,
assenza di DDL al reopen e rollback della migrazione.
`lib/recovery-backup.test.ts` aggiunge il recupero cifrato v11 e conserva i
recuperi dei predecessori già qualificati.

Sulla revisione precedente `0dd19cf33`, gli stessi test falliscono con
asserzioni sul proponente assente e sulla versione rimasta 11. I log grezzi
restano negli artefatti locali sintetici della verifica. La selezione
`test:unit` comprende i nuovi test.

## Limiti

Queste prove qualificano schema e writer. Non esiste ancora un canale agente
completo: mandato, credenziali, deposito, applicatore, ricevute, In arrivo,
CLI e prove del percorso medico sono nei pezzi successivi. La provenienza
è predisposta per quel chiamante fidato; la sola presenza dei campi non
prova la sua futura ammissione. Nessuna prova autorizza l'uso clinico.
