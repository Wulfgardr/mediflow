# ADR 0156 — Cambio stato terapia: esito incerto nel client Web

Data: 2026-10-21. Stato: Proposed, in attesa di review indipendente.

## Problema e confine

Un abort di fetch termina l'attesa del browser, ma non dimostra che il writer
host sia terminato. Una GET con la versione precedente non esclude un commit
successivo. Il blocco del nuovo intento deve quindi sopravvivere al rimontaggio
e al reload della schermata sullo stesso archivio.

Il writer corrente incrementa `therapies.version` anche per un aggiornamento
che non cambia lo stato. CAS, transazione e audit restano invariati; non si
introducono endpoint, ricevute host o idempotenza durevole.

## Decisione

Prima della PUT il client conserva un singolo marker di blocco per paziente
nel `localStorage` della stessa origine. La chiave contiene la generazione
dell'archivio già osservata dal trasporto Web e il riferimento del paziente.
Il valore contiene soltanto un identificatore casuale del tentativo, riferimenti
opachi di paziente e terapia, versione attesa ed esito `unknown`, `accepted`
o `rejected`. Non contiene nome, farmaco, dose, stato finale o credenziali.
La matrice dei dati a riposo classifica questa nuova copia di metadati.

Web Locks serializza verifica e creazione del marker fra tab della stessa
origine. Anche aggiornamento e rimozione richiedono il lock e l'identità del
tentativo: un owner precedente non può cancellare o risolvere il marker di un
nuovo intento. Senza storage, generazione o Web Locks la PUT non parte.
Il controller non può riassociarsi a un archivio diverso durante la sua vita.

Il marker non è legato alla durata della sessione: la richiesta già ammessa
può sopravviverle. Una sessione rinnovata sullo stesso archivio eredita il blocco,
ma deve ancora ottenere una lettura autorizzata. Il marker non concede alcuna
autorità. Nessun retry è automatico e non esiste scadenza temporale di sblocco.

Dopo una risposta di successo si dichiara `Registrata` solo dopo una GET con
versione avanzata e dati coerenti con la conferma ancora in memoria. Una risposta
di rifiuto autorevole permette di uscire dal blocco dopo una rilettura valida.
Un errore di rete o un abort lasciano l'esito ignoto: GET alla stessa versione
mantiene il blocco; versione maggiore dimostra che la vecchia CAS non può più
scrivere. In questo caso si mostra il confronto con lo stato corrente, senza
attribuire la modifica al tentativo interrotto. Anche dopo reload si mostra
solo il confronto, perché il marker non conserva l'intento clinico.

## Limiti e alternative

Il marker è una barriera del flusso Web nello stesso profilo/origine browser,
non una prova host recuperabile né un controllo di concorrenza universale.
Altri profili, origini e client restano governati dalla CAS host; non condividono
questo blocco. Cancellazione o manomissione dello storage non sono coperte.
I riferimenti e l'esito sono metadati in chiaro: l'assenza di contenuti clinici
non equivale a cifratura. I marker irrisolti non vengono rimossi al logout o per
età; se la versione non avanza e non arriva un rifiuto autorevole il flusso resta
bloccato. Una terapia non più leggibile non consente risoluzione automatica.

Una garanzia estesa a ogni client, alla perdita dello storage o con recupero
certo dopo un esito indefinitamente ignoto richiede un contratto host distinto:
identità durevole del comando, ricevuta atomica con il commit e interrogazione
che distingua esecuzione in corso, rifiuto e commit. Non si deduce tale contratto
dalla GET delle terapie e non lo si aggiunge in questa modifica.
