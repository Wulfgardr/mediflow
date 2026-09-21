<a id="drizzle-historical-migration-artifacts"></a>

# drizzle/: artefatti storici di migrazione

I file `*.sql` di questa cartella documentano la storia dello schema, ma NON
vengono applicati automaticamente durante l'esecuzione. L'applicazione non
importa un migrator, non ha uno script `db:migrate` e non invoca la migrazione
di drizzle-kit all'avvio. Modificare questi file, da solo, non cambia quindi
il database usato dall'applicazione.

L'allineamento effettivo avviene in `applySchemaGuards()`, dentro
`lib/db-server.ts`. La funzione viene eseguita a ogni apertura del database,
sia all'avvio sia dopo la sostituzione del file durante una riparazione. È
idempotente: aggiunge le colonne mancanti, crea le tabelle di propria competenza
e gli indici secondari. Le tabelle di base derivano storicamente da
`0000_*.sql` e dai successivi file numerati, tramite `drizzle-kit push`;
i controlli a runtime mantengono poi i database esistenti allineati al codice.

Il modello Drizzle in `lib/schema.ts` rimane l'unico riferimento tipizzato per
il codice applicativo. Poiché modello, file SQL e controlli a runtime hanno
ruoli distinti, la loro coerenza va verificata con:

    npm run check:schema-drift

Il comando crea un database SQLite temporaneo attraverso il percorso reale
di db-server: applica le migrazioni SQL Drizzle e poi i controlli a runtime.
Interroga quindi `sqlite_master` e termina con un confronto leggibile se nello
schema così ottenuto manca una tabella, una colonna o un indice dichiarato in
`lib/schema.ts`.

Da questa distinzione discendono tre regole operative:

- Quando aggiungi una colonna o un indice, aggiungilo a `lib/schema.ts` E a
  `applySchemaGuards()` in `lib/db-server.ts`: sono questi controlli a essere
  eseguiti. Un nuovo file `*.sql` può documentare il passaggio storico, ma non
  è un requisito di esecuzione.
- Non considerare sufficiente la modifica di un solo file `*.sql`: non ha
  effetti a runtime.
- Mantieni identici i nomi degli indici in `lib/schema.ts` e nei controlli,
  perché la verifica delle divergenze possa riconoscerli.
