# ADR 0127: Import locale atomico del catalogo esenzioni

Date: 2026-09-07
Status: Proposed
Issue: WUL-690

## Problema e contesto

ADR 0004 conserva codici nel catalogo e assegnazioni cifrate nei pazienti. Il
vecchio importer deduplicava implicitamente e scriveva batch separati: un errore
poteva lasciare aggiornamenti parziali. Questa slice modifica solo il catalogo.

## Opzioni e decisione

Scegliamo anteprima senza scritture e merge in un'unica transazione SQLite
IMMEDIATE, con ricevuta nella stessa transazione. Non usiamo clear/reload né
sostituzione di snapshot: completezza e attualità normativa della fonte non sono
provate. I codici assenti dal file restano; nessuna assegnazione pregressa cambia.
Il catalogo ridotto non dimostra eleggibilità o validità prescrittiva.

## Contratto del file, versione 1

Un file per operazione, massimo 2 MiB, 20.000 righe dati e 2.000 caratteri per
cella. UTF-8 rigoroso (BOM iniziale ammesso), separatore `|`, terminatori CRLF;
una sola riga finale vuota ammessa. Delimitatore finale facoltativo, coerente
con l'header. Nessun quoting, escape di separatori o conversione di encoding.
Header esatti, unici; tutte le righe hanno lo stesso numero di campi.

Subset obbligatorio: `CD_ESENZIONE`, `DS_ESENZIONE`, `CD_TIPO_ESENZIONE`,
`DT_INIZIO_VALIDITA`, `DT_FINE_VALIDITA`, `FL_AMBITO_FARMACEUTICO`,
`FL_AMBITO_SPECIALISTICO`, `FL_NAZIONALE`.
Codici ASCII maiuscoli, cifre, punto, trattino o underscore (1–32 caratteri);
nessuna normalizzazione silenziosa. Descrizione non vuota. Per i campi opzionali
solo `\N` significa null: celle vuote o spazi esterni sono errori. Date YYYYMMDD
con verifica calendario, anni 0100–9999, inizio non successivo alla fine. Flag
mappati solo S/N oppure null. Qualsiasi codice duplicato, anche identico, blocca
l'intero file; nessuna selezione implicita della versione "attiva".

Colonne note escluse: `FL_ESENZIONE`, `DT_INSERT`, `DT_UPDATE`,
`FL_ESENZIONE_LOMBARDI`, `FL_SOLO_RESIDENTI`, `FL_LIMITE_GENERE`, `NR_ETA_MINIMA`,
`NR_ETA_MASSIMA`, `FL_MS`, `FL_MRSA`, `FL_MMG`, `FL_ATTR_CRED`.
Sono validate solo strutturalmente come celle opache bounded o null, non
interpretate; nomi e numero di valori non nulli sono dichiarati nell'anteprima.
Non si attribuisce loro significato normativo né si attesta validazione
semantica. Colonne ulteriori sconosciute sono rifiutate. Il commit richiede
accettazione esplicita del subset; il file originale resta presso l'operatore.

## Protocollo e persistenza

Nuove route web `/api/exemptions/import/preview`, `/commit`, `/status` richiedono
sessione web valida, senza estendere l'autorità dei token locali. Input bounded;
nessun percorso filesystem dal client, nessun egress, nessun dato di riga nei log.
Anteprima: hash SHA-256 dei byte, nome fonte, versioni parser/schema/policy,
conteggi e diagnostica per riga/colonna, campione di massimo 10 record, revisione.
Solo un file integralmente valido riceve proof firmato dal processo, legato
all'utente, alla fonte, al subset e alla revisione; scade dopo 30 minuti e al
riavvio o passando a un altro processo server. Commit: stessi byte, rivalidazione completa e verifica proof.

La revisione è il digest deterministico di tutte le colonne del catalogo e
dell'ultimo commit import: rileva anche upsert manuali e cancellazioni.
Sotto lock IMMEDIATE vengono verificati revisione e idempotenza, applicati gli
upsert senza REPLACE/DELETE e persistita la ricevuta. La chiave idempotente lega
hash fonte, nome, versioni, policy e revisione di partenza. Un retry restituisce
la ricevuta precedente senza riscrivere; lo stato corrente resta distinto dalla
revisione della ricevuta. Non è una verifica di attualità normativa della fonte.

Una sola tabella additiva `exemption_import_receipts`, con migrazione esplicita
e bootstrap allineato, conserva metadati e provenienza; nessuna tabella clinica
viene scritta dal servizio. La lettura status restituisce revisione, conteggio
e ultima ricevuta per una verifica successiva al commit.

Il vecchio importer a batch e `db.exemptions.bulkPut` falliscono chiusi. Gli
array POST web e `/api/v1/exemptions` sono rifiutati con 400
`EXEMPTION_IMPORT_PREVIEW_REQUIRED`; l'upsert manuale singolo resta compatibile.
Impatto v1 deliberato sulla superficie esclusa dalla slice stabile in
`docs/openapi/contract-policy.json`; GET, DELETE e POST singolo restano invariati.
I client batch devono migrare al flusso web con anteprima. Nessuna modifica
alla superficie paired o ai contratti paziente.

## Verifica e limiti di promozione

Fixture interamente inventate: encoding/header/flag/date/null, duplicati,
anteprima senza scritture, retry, conflitto, rollback per guasto intermedio,
provenienza riletta e riferimenti invariati. UI in Repertori: selezione,
anteprima, consenso al subset, commit esplicito, rilettura e conflitto visibile.
La scelta conservativa di rifiutare duplicati o encoding non UTF-8 limita i file
accettabili; supportare fonti diverse richiede un contratto esplicito successivo.
Build integrata, uso con fonte reale e validazione normativa non sono attestati
da questa candidatura locale. ADR resta Proposed fino alla review del programma.

## Comandi di verifica della slice

```bash
node scripts/run-strip-types.mjs --test lib/exemption-import.test.ts lib/exemption-import-route.test.ts lib/exemption-import-ui.test.ts
npm run check:schema-drift
npm run check:schema-writers
npm run check:openapi:drift
```

Il test UI usa Chromium, il componente reale e le route reali su SQLite
temporaneo; intercetta il trasporto senza aprire listener. Non verifica layout
Next/Tailwind, autenticazione interattiva o pacchetto distribuito. `esbuild` è
risolto dalle dipendenze di sviluppo già fissate dal lockfile.
La UI non propone più lo svuotamento del repertorio come parte dell'import.
Le ricevute sono persistite nel database locale e nel backup JSON secondo il
raccordo descritto sotto.

## Backup JSON e completamenti tardivi

La collezione additiva `exemptionImportReceipts` entra nel backup JSON v1:
righe `{id, operationKey, receiptJson}`, schema ricevuta identificato da
`manifest.schemaVersion = 1`, parser/policy esatti e contatori coerenti. Export
web e schedulato applicano la stessa validazione. Restore conserva id, chiave e
JSON originali nella transazione del catalogo; i backup storici senza la
collezione sono validati col checksum originale e normalizzati a lista vuota,
svuotando eventuali ricevute del catalogo precedente. La ricevuta resta prova
tecnica dell'import, non validazione normativa né nuova autorità di sessione.

L'upload usa `readBoundedJsonBody` canonico in modalità strict, con massimo byte,
deadline di 30 secondi e cancellazione su abort richiesta o ritiro della sessione.
Un resource port dell'owner web verifica l'autorità dopo l'await del body, prima
del commit sincrono, dentro la transazione prima di scrivere e prima di pubblicare l'anteprima; lock/logout revocano la
risorsa e cancellano la lettura. Nessun completamento tardivo produce proof,
ricevute o scritture. Il proof resta un vincolo sulla fonte; non sostituisce
l'autorità attiva della richiesta corrente.

Verifica callsite: i client Swift cercano il repertorio tramite GET; non è
presente un import bulk nativo. Il seed first-party del test cataloghi paired
inviava un array di un record: viene migrato al POST manuale singolo. L'import
web usa già preview/commit; nessun caller runtime di `exemptions.bulkPut` o del
vecchio `importExemptionFiles` rimane nel tree ispezionato.
