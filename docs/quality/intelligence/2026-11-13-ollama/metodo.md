# Metodo congelato WUL-840

Candidato: 8954e9c97b4ea2016c20c8433b43ee0f5231607a. Mac17,10, 48 GB, macOS 27.3 26C5035r. Node 24.22.3. Solo CLI, dati sintetici, nessuna finestra. Congelato prima della prima misura.

## Ordine e durata

Identità e ammissione, tre percorsi I-2, poi C-L, registro e test. La matrice completa richiede almeno 480 operazioni. A 30 secondi ciascuna servono 4 ore, oltre alle 2 ore massime di I-2 (12 operazioni con timeout 600 secondi). Si taglia dal fondo, senza ridurre il campione di una distribuzione dichiarata completa. Limite totale 5 ore di macchina. Le celle negate dall'ammissione non vengono inferite direttamente.

## Scenari previsti

- Patient Insight: 100 eventi, 30 terapie e 10 documenti sintetici.
- Redazione: fixture JSON versionata, esattamente 10.000 caratteri Unicode BMP.
- Import: PDF testuale e PDF scansionato, ciascuno 10 pagine e 10 MiB. File e archivi sintetici fuori da Git.
- I-2: per ciascuna delle tre funzioni, proposta con fonti, errore, annullamento durante inferenza e revoca. Solo il percorso reale standalone vale come esecuzione della funzione. Il rifiuto dell'ammissione ferma quel percorso.

## Distribuzioni e confini

30 esecuzioni fredde e 30 calde per ogni scenario disponibile. p50 e p95: rango superiore (ceil(p*n)), massimo ed errori sull'intero denominatore. Nessun timeout o errore si elimina. Freddo del modello significa nessun modello in /api/ps. Freddo del redattore significa nuovo processo Python; cache filesystem del sistema non svuotata. Caldo significa un'estrazione preliminare sullo stesso runner, separata e registrata, prima del campione. Il core di preparazione chiude il runner a ogni operazione: non si modifica il prodotto per tenerlo caldo.

Per il solo componente redattore, banco diretto con createGlinerRedactionRunner, createRedactionSession e controllo del round trip. Non è una misura del broker completo, del consenso o della latenza percepita. Il ramo locale indipendente può essere misurato anche con Ollama negato. Queste misure non diventano budget end-to-end delle funzioni.

Timeout componente 120.000 ms (quello di produzione), percorsi completi 600.000 ms. Ogni errore è rosso, soglia zero. Nessuna accettazione clinica da HTTP 200. Il budget di una distribuzione senza errori è ceil(p95 * 1,2), memoria ceil(picco RSS osservato * 1,2). Gli errori o l'assenza di campioni lasciano il budget nullo con motivo. Non si converte una mancanza di campioni in zero.

Campionamento RSS ogni 500 ms: somma dei processi posseduti del banco, del server standalone e del server Ollama, inclusi tutti i discendenti, seguendo PPID fino al punto fisso. Salvare PID, PPID, nascita, comando e RSS. Picco campionato, non memoria GPU o picco continuo. Nessun filtro per nome del runner. Nessuna compilazione o suite contemporanea alla misura. Stop di sicurezza a 38 GiB RSS del banco o spazio libero sotto 25 GiB, non budget qualificato.

## Isolamento e semaforo

Nessuna misura finché non esiste COMPILAZIONE-FINITA.md. Se assente, attendere almeno fino alle 21:29 UTC del 13/11 (limite più conservativo di 90 minuti dal primo clock acquisito), poi verificare con pgrep -fl assenza di cargo, rustc e Next build. Durante ogni misura esiste misure-in-corso, rimosso nel finally. Comandi lunghi con caffeinate -i.

Ollama.app sulla sola 11434, cloud disabilitato e modelli protetti da scritture. Usare i pesi già presenti su Vision, come WUL-832, senza pull o cambio modello. Sandbox di processo con sola rete loopback e sonda esterna TCP 192.0.2.1:9 che deve fallire EPERM. Nessuna modifica di rete del Mac. L'host deve essere production standalone del candidato e usare una cartella dati sintetica esplicita.

## Consegna

Campioni di tempi, RSS, identità, risposte d'ammissione e log fuori da Git. Si versionano soli campioni numerici sintetici e aggregati, metodo e banco. Nessun output generato o archivio in Git. Contratto e regole di consenso/ammissione invariati. Ollama spento alla fine, /api/ps vuoto prima della chiusura. Si chiudono solo PID propri dopo verifica della nascita.
