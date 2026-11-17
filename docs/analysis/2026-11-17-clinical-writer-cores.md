# Composizione sincrona dei writer clinici

Data: 2026-11-17. Refs WUL-868, prerequisito di ADR 0190.

## Risultato verificato

Il test `lib/clinical-writer-composition.test.ts` porta in CI il difetto
registrato nella [prima prova](2026-11-17-agent-writer-composition.md).
Con i writer di `origin/main` alla revisione
`a3abfb53e2d668b4ea0613709e1c87f48344c382`, l'asserzione di atomicità
fallisce: restano una nota, una terapia e due audit di successo dopo
l'errore SQL della prestazione. Con i nuclei sincroni passa.

I wrapper esistenti conservano il proprio contratto. Diario, terapia,
osservazione, aggiornamento del profilo, creazione della prestazione e
creazione dell'allegato Web espongono un nucleo sincrono che riceve la
transazione del chiamante. Diagnosi ed esenzioni usano l'aggiornamento del
profilo; nota e trascrizione usano il diario. Ammissione, validazioni e
audit restano nel writer esistente. Un diniego restituito dal nucleo deve
essere convertito dal chiamante in un errore per annullare il lotto.

L'allegato del percorso Web conserva i byte nel campo `attachments.data`:
inserimento, contenuto e audit sono nella stessa transazione. Il nucleo non
crea file e il rollback non richiede compensazioni. Il futuro applicatore
deve utilizzare questo percorso con contenuto cifrato, senza introdurre
riferimenti a file pubblicati prima del commit.

## Prove sintetiche

Il test crea un archivio temporaneo separato prima di importare il DB.
La matrice copre otto elementi: nota, trascrizione, allegato, terapia,
prestazione, diagnosi, esenzione e osservazione.

- Errore dopo ogni posizione: tutte le righe, i byte dell'allegato, le
  modifiche al profilo e gli audit del tentativo vengono annullati.
- Audit SQL fallito in ogni posizione: nessuna scrittura del lotto rimane.
- Interruzione del chiamante in ogni posizione: rollback completo.
- Revisione attesa diversa: nessuna scrittura.
- Retry dopo un errore sull'ultimo elemento: applicazione possibile.
- Due processi distinti, aperti sullo stesso DB e rilasciati da una barriera:
  uno applica, l'altro legge la revisione cambiata. Un successivo tentativo
  non duplica righe o audit.
- Controllo positivo: due voci di diario, un allegato con byte, una terapia,
  una prestazione, un'osservazione, due modifiche al profilo e otto audit.
  L'autore delle voci è il medico sintetico autenticato.

Comando locale e selezione CI `test:unit`:

```sh
MEDIFLOW_DATA_DIR="$(mktemp -d /tmp/mediflow-writer-test-XXXXXX)" \
node scripts/run-strip-types.mjs --test lib/clinical-writer-composition.test.ts
```

Il test originale mantiene un adattatore limitato ai tre writer storici:
sulla base chiama le API pubbliche allora disponibili, sulla correzione i
nuclei sincroni. L'errore del writer asincrono viene osservato prima
dell'asserzione finale; il fallimento atteso sulla base è la presenza
delle righe parziali, non l'assenza di un export.

Il guard audit segue il passaggio wrapper → nucleo solo se il wrapper
restituisce esattamente la transazione IMMEDIATE e inoltra gli stessi
argomenti. Continua a controllare DML, cardinalità, audit obbligatorio e
ordine sul corpo reale del nucleo. Mutazioni valide sintatticamente
provano il rifiuto di transazione o input sostituiti, Promise, mancato
return, nucleo asincrono e audit condizionale.

## Confine della prova

Il compositore di questa prova è una fixture, non l'applicatore della
cassetta. Il controllo di revisione e il rifiuto del duplicato provano la
componibilità su SQLite, non ricevute, consumo durevole degli elementi,
revoca del mandato o autorizzazione clinica di A5. Questi restano da
implementare insieme al canale. Nessuna issue funzionale è chiusa da
questa sola modifica.

Non sono provati schema 12, mandato, abbinamento, ECIES, deposito,
In arrivo, CLI/MCP, identità della cassetta, condivisione delle chiavi,
percorso del medico o end-to-end delle dieci visite di ADR 0190.

## Raccordo del controllo membership

La CI del primo rebase ha rilevato un controllo statico ancora legato al
corpo del wrapper di aggiornamento paziente. Il test membership ora usa
lo stesso normalizzatore del gate audit: il nucleo viene seguito soltanto
se il wrapper restituisce la transazione IMMEDIATE, inoltra gli stessi
argomenti ed il nucleo è sincrono. Restano i controlli che membership ed
audit usino il medesimo `tx`. Mutanti aggiuntivi fanno fallire il test se
cambiano handle o input, manca il return o il nucleo diventa async.
La suite mirata di membership, composizione e gate audit passa con 57 test.
