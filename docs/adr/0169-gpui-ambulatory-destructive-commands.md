# ADR 0169: clear e delete ambulatori da GPUI tramite comandi host nominati

Date: 2026-10-26
Status: Proposed — disegno tecnico sintetico; nessuna qualifica o GO clinico
Refs WUL-771; ADR0161, ADR0167 e ADR0168.

Solo `ambulatory.clear-test.v1` e `ambulatory.delete.v1`, nessuna amministrazione paired generica. Preparazione RAM e login WebP3 dedicato successivo, stesso amministratore e dispositivo autenticati correnti. Nessun riuso del grant bootstrap o C4a. Profilo iniziale di qualifica: preparazione5min e challenge30s dal completamento auth; una operazione, nessun rinnovo. Non è un budget prestazionale o un GO clinico.

Piano canonico host con identità/versioni, appartenenze M2M, lifecycle e tipi delle sedi pertinenti, effetti e fallback. Il client riceve solo sede e conteggi distinti, mai piano pazienti o snapshot audit. Execute ricontrolla autorità, generazione e piano nella stessa IMMEDIATE di core, audit obbligatorio e receipt. Wrapper legacy usano i medesimi piccoli core sincroni; nessun secondo writer o semantic drift.

Clear conserva la selezione M2M, i figli clinici e i tombstone precedenti; live/NULL proteggono, versioni aggiornate per ogni modifica e sede anche vuota. Delete nega pazienti primari attivi, qualsiasi membership e figlio; nessuna cascata. Il nuovo port richiede admin, tutte le versioni incrementabili e fallback massimo createdAt non ambiguo; a pareggio chiede di impostare prima un'altra sede predefinita. Legacy mantiene la propria selezione fallback.

ABA usa il set ordinato degli eventId canonici created/deleted di target e fallback, non timestamp. Create con ID arbitrario e delete canonici sono auditati; bootstrap delega, fix-orphans audita. Setup/migrate storici possono avere set vuoto: generano UUID host nuovi a elenco vuoto, non sovrascrivono ID. Delete/recreate ordinario dello stesso ID introduce eventi e cambia il piano. Restore ritira generation. Non si inventa backfill e non si ammette SQL esterno al confine.

Un solo ledger terminale dedicato, append-only, ID UUID globale e binding immutabile attore/dispositivo/operazione/generazione/scope/target/versione/digest. Nessun running/TTL/GC/CASCADE. Applied/rejected/closed; assenza=unknown, nessun retry automatico. Close senza target corrente/CAS/piano ricostruito serializza con execute e blocca l'ID tardivo. Non attesta l'intento né il logout WebP3. Un ID non è bearer: altro owner/device non legge o chiude. Un ID assente conosciuto può essere ritirato prima dal medesimo owner/device autorizzato: rischio di disponibilità esplicito.

Read/close richiedono nuova autorità corrente admin e paired originale, senza selezione sede/target esistenti. tokenHash lega la credenziale dispositivo: revoca, rotazione o nuovo pairing non ricostruiscono l'autorità storica dal solo clientId. Il ritiro della propria WebP3 rimane tentabile separatamente anche dopo revoca/generation change e non usa logout generico/Supervisor. Closed e autorità ritirata sono attestazioni diverse.

Schema6: backup manuale/scheduled, JSON/raw/recovery conservano union exact di terminali e audit anche locali postbackup, collisioni prima effetti. Receipt applied storica dopo restore non riapplica e non prova currentstate. Encrypted recovery ammette solo canonici4/5 e corrente6; impronte immutabili prima del nuovo DDL, migrazione soltanto copia isolata dopo auth/integrità/chiavi, validazione completa6 prima promozione. Nessuna cancellazione di ledger per ammettere una destinazione non vuota.

Prove richieste: identità diverse a parità conteggio, membership/tipo/lifecycle/figli/fallback/ABA legacy; audit/DML/receipt FAIL e IGNORE; due processi e crash pre/postcommit; actor/device/control/revoca/scadenza/generation; backup/restore con postbackup e collisioni. Consumer GPUI e prove interattive successivi al checkpoint del core. Nessuna chiusura G-3d aggregata o ammissione clinica.
