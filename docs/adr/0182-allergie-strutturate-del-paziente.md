# ADR 0182: Allergie strutturate del paziente

Data: 2026-11-07. Stato: Accepted.

Le allergie devono comparire nella testata della scheda. Le note libere non
permettono di riconoscerle senza interpretare il testo clinico.

Il paziente riceve una colonna nullable `allergies TEXT`. Contiene un elenco
JSON cifrato con lo stesso AES-256-GCM ed involucro `ENC:iv:ciphertext` degli
altri campi clinici. Il client sblocca la chiave e cifra l'intero elenco.
Ogni elemento ha `substance` obbligatoria (1-200 caratteri), `reaction`
facoltativa (massimo 500) e `severity` facoltativa (`mild`, `moderate`, `severe`),
riferita alla reazione. Sono ammessi fino a 100 elementi. Non si inferiscono
sostanza, reazione o gravità dalle note. Non sono disponibili verifica
allergologica, data di insorgenza, stato clinico o codifica terminologica.

Lo schema SQLite passa da 8 a 9 attraverso l'apertura versionata di ADR 0080:
originale verificato, aggiunta nullable, verifica e stamp nella stessa
transazione IMMEDIATE. I pazienti esistenti ricevono null, senza modificare
note, versioni cliniche o storico. `drizzle/0038_patient_allergies.sql`
documenta l'aggiunta per le migrazioni storiche, senza replay runtime.

Creazione e modifica usano i writer paziente esistenti. Le API accettano solo
un involucro ENC oppure null. L'host privo della chiave controlla la forma
dell'involucro, non può attestare il contenuto cifrato. Il campo omesso in PUT
rimane invariato. Una scrittura usa `patients.version`, CAS ed audit richiesto
nella stessa transazione. L'audit contiene il nome `allergies`, mai il suo
contenuto. Il registro comune dei campi cifrati include il nuovo campo anche
per backup portabile e ripristino.

OpenAPI v1 passa da 1.55.0 a 1.56.0. Il campo facoltativo `allergies` è esposto
nel dettaglio già letto da Web, Apple e GPUI:

- `GET /api/patients/{id}`;
- `GET /api/v1/patients/{id}`;
- `GET /api/v1/network/patients/{id}`.

I client decifrano `allergies` con la chiave corrente ed interpretano il JSON
come elenco degli elementi descritti sopra. Nessun cambiamento alla lista
compatta dei pazienti. La modifica paired usa la capability del profilo già
esistente, il suo controllo dell'ambulatorio e la stessa verifica dei campi
sigillati. Anche la creazione paired ammette soltanto il campo cifrato.
Il golden crittografico aggiunge `patient.allergies`, conservando i vettori
precedenti. La resa Apple e GPUI resta alle lane native.

Il modulo Web permette aggiunta, modifica e rimozione. La testata mostra una
pillola con ▲ per ogni sostanza. Null ed elenco vuoto producono «Allergie:
nessuna registrata», che non significa assenza accertata di allergie. Un dato
non decifrabile o con forma non riconosciuta produce «Allergie: dato non
disponibile». Il modulo non converte questo dato in elenco vuoto: si arresta
prima di poterlo sovrascrivere. Le testate di modifica e nuova voce condividono
la stessa resa delle allergie.

L'export FHIR esistente non ha un adapter AllergyIntolerance. Questa PR non lo
aggiunge: stato clinico e verifica allergologica richiedono un contratto
esplicito, che il nuovo elenco non possiede. Il bundle FHIR continua quindi ad
escludere le allergie. Nessuna estrazione automatica, decisione clinica,
integrazione SISS o avviso sulle prescrizioni è introdotto.
