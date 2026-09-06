# ADR 0121: stato delle funzioni distinto dalle prove di esecuzione

Date: 2026-09-06
Status: Accepted
Issue: WUL-674
Program line: candidato locale 0.8.6

## Decisione

Le impostazioni mostrano una proiezione in sola lettura dei prerequisiti delle
funzioni. `GET /api/system/function-status` richiede la normale sessione Web,
non accetta parametri e restituisce un envelope versionato senza dati paziente,
credenziali, endpoint configurabili o contenuto delle esecuzioni.

Le fonti restano gli owner esistenti: interruttori nel database, lifecycle del
provider, binding clinico locale, presenza dell'artifact ATHENA e readiness WHO.
Questa lettura non invoca modelli, non qualifica il motore OCR, non cerca termini
WHO, non abilita servizi e non modifica la configurazione. La data esposta e la
data di lettura dei prerequisiti, mai un tentativo di inferenza inventato.

La proiezione distingue spento, configurazione da completare, bloccato, da
provare, percorso manuale e risposta WHO gia osservata dal relativo owner.
Un interruttore acceso o un lifecycle `available_unqualified` non produce lo
stato operativo. Non esiste una sorgente globale delle ultime esecuzioni:
`lastExecutionAt` rimane null; le prove sul documento/paziente appartengono ai
rispettivi owner e alle loro ricevute. Questa API non e una decisione di routing.

AnyDoc con fallback PDF Apple Vision, disciplinato da ADR 0119, viene descritto
separatamente dalla capability Fabric `ocr` ritirata. Su sistemi diversi dal
Mac la proiezione non promette equivalenza OCR. Immagini singole conservano il
percorso manuale corrente. La modalita Home-base configurata non e una prova
di raggiungibilita: la relativa osservazione resta `unknown/not_probed` finche
non esiste una sonda effettiva.

## Verifica e limiti

Test delle combinazioni interruttore/lifecycle/binding, mancata lettura delle
fonti, WHO configurato/risposta osservata e piattaforme. UI con caricamento,
errore, riprova, data e azioni pertinenti. Nessun contratto `/api/v1` modificato.
La proiezione informa l'utente; non certifica disponibilita, accuratezza clinica
o qualificazione del modello. Il catalogo Fabric e i suoi controlli restano
accessibili nei dettagli tecnici.

Gli errori di lettura del binding o del lifecycle hanno stato `unavailable`:
non vengono trasformati in configurazione assente o non valida. La lettura
riuscita di un interruttore spento resta sufficiente per mostrare `off`.
