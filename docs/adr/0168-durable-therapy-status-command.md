# 0168 — Comando durevole per il solo stato della terapia

Stato: Proposed — disegno C-5a/G-6 accettato per implementazione; review indipendente del diff finale e integrazione ancora richieste.

## Decisione

Il percorso Web autenticato del medico usa `therapy.status.change.v1`: execute,
read receipt e close espliciti. Nessun MCP, consumer chat, semplice lettore o
applicazione AI riceve questa autorità. C4a concede solo access-status. La PUT
legacy e il marker ADR0156 restano separati: una PUT non rispetta il tombstone;
un marker legacy irrisolto impedisce un nuovo comando nella UI.

Una sola tabella append-only conserva i terminali applied/rejected/closed.
L'ID UUID è globale, senza TTL. Execute lega immutabilmente generation originale,
attore autenticato, paziente, terapia, expectedVersion, protocollo e target.
Ogni divergenza su un ID esistente è negata prima di mutazioni. Stesso binding
ritorna lo stesso terminale; assenza significa unknown, mai prova di mancato
commit. Non esiste retry automatico.

Execute serializza CAS, UPDATE, audit obbligatorio e receipt nello stesso
`BEGIN IMMEDIATE`. Ogni scrittura attesa deve modificare esattamente una riga:
anche RAISE(IGNORE) è un fault con rollback. Il writer di terapia resta comune.
Un unico istante host al commit determina updatedAt, occurredAt audit e receipt:
Concludi imposta endDate a quell'istante, Riprendi a NULL, Sospendi preserva
endDate. Questa policy differisce dalla data del browser nel vecchio percorso.

Il marker browser conserva soltanto ID casuale robusto, generation, riferimenti
opachi paziente/terapia, expectedVersion e protocollo. Non conserva target,
nome o dose. Close riceve questa tuple nonclinica e derivazione fresca di
attore/scope host; non richiede CAS sulla versione corrente. Se assente inserisce
closed con target NULL, mai dedotto dallo stato corrente: attesta il ritiro ID,
non l'intento originale. Tutti i target di execute su quell'ID sono negati.
Se il commit vince la gara, close restituisce applied; se vince close, la
richiesta tardiva non scrive. La chiusura non annulla effetti già commessi.

Un ID non è un bearer. Solo un medico autorizzato alla risorsa può usare le
porte; un owner diverso non riceve receipt e non chiude righe esistenti.
Resta il rischio che un altro medico autorizzato, conoscendo l'ID ancora
assente, lo ritiri per primo. Gli ID non vengono esposti ad altri attori;
questa tranche non aggiunge host issuance o un motore di intenti generico.
Le limitazioni del confine HTTP autenticato e di dimensione del body restano
obbligatorie. Nessun reset o garbage collection di tombstone.

## Conservazione e restore

Schema SQLite 4→5. I terminali non hanno FK cascading verso righe cliniche.
Backup manuale e scheduled esportano ledger e audit coerenti. JSON e raw restore
validano e uniscono globalmente righe backup e locali, incluse quelle locali
successive al backup; stesso ID richiede uguaglianza esatta, altrimenti rifiuto
prima della mutazione. Ogni applied conserva l'audit esatto. Nessun effetto
clinico viene riapplicato dal ledger.

Una receipt applied conservata dopo restore è storica nella generation
originale: non attesta che la terapia ripristinata conservi quell'effetto.
Il consumer rilegge separatamente lo stato corrente. Rotazione generation
nega vecchi execute; la lettura storica non concede nuova scrittura.
La recovery cifrata conserva l'ammissione solo a destinazione vuota/bootstrap:
righe locali ne impediscono l'uso, non vengono eliminate per farla riuscire.
Lo staging raw si unisce sotto esclusione maintenance prima del digest/swap.

## Prove richieste

SQL reale e fault audit/update/receipt ABORT e IGNORE; crash prima/dopo commit;
gare SQLite a due processi execute/execute e execute/close nei due ordini;
collisioni di ciascun binding, owner/scope e tutte le varianti target su closed;
migrazione, export, JSON/raw/recovery, record postbackup e audit divergenti;
Web perdita risposta/abort/reload, doppia conferma, marker legacy, lock e cambio
paziente/archivio senza retry automatico. Prove sintetiche e review indipendente
non equivalgono a qualifica clinica o ammissione della futura scrittura chat.

## Compatibilità cifrata precedente

I backup recovery v4 già supportati restano recuperabili. La copia decifrata
isolata deve corrispondere integralmente al contratto canonico v4 della base
`3828bb17d4883b28a646c16af10f9505fddded38`. La derivazione sottrae esclusivamente
`therapy_status_commands` dal canonico corrente e deve uguagliare l'impronta
SHA-256 fissata nel validatore: modifiche future non assorbono drift implicitamente.
Solo quella copia può migrare a5 e deve poi superare l'ammissione completa.
Altre versioni, colonne/indici/trigger alterati e un v5 privo di ledger sono
rifiutati. Il backup originale resta immutato e la destinazione resta vuota/bootstrap.
