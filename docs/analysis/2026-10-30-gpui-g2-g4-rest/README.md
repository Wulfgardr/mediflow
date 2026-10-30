# Importazione multipla e originale testuale su GPUI Mac

Contributo parziale G-4 da `c8b27824b0d85b04e122a4b047ce3130ab5cb447`,
per WUL-771. Non chiude G-2, G-4 o la matrice G-7 completa.

Si possono scegliere fino a 20 file, con il limite esistente di 10 MiB per
file. Viene letto un solo candidato alla volta. Ogni file attraversa controllo
dei duplicati, bozza, revisione, conferma separata e rilettura dei byte salvati.
Il file successivo richiede un nuovo gesto. Nome ed esito rimangono visibili
per ciascun candidato: da rivedere, in revisione, registrato e verificato,
già presente oppure non importato. Non esiste un successo unico del gruppo.
Un esito incerto conserva il file nella bozza e impedisce di avanzare o
reinviarlo. Annullamento della bozza, blocco o cambio di contesto ritirano
la selezione rimanente; i documenti già registrati restano nell'archivio.

Originale legge esplicitamente i byte dell'allegato dalla porta autenticata,
verifica identità, tipo, dimensione e codifica e mostra testo UTF-8 letterale.
Le pagine contengono fino a 65.536 caratteri, senza perdere caratteri Unicode
al confine. Testo, sintesi ed estratto salvato restano distinti. Caricamento,
fonte assente, illeggibile e formato non supportato hanno esiti distinti.
Chiudere la vista o cambiare contesto ritira il contenuto; una risposta
precedente non può riaprire la vista. La chiusura non promette di interrompere
una richiesta HTTP già avviata. Apertura e chiusura conservano il fuoco.

## Scritture e autorità

La selezione multipla estende il consumer del writer documentale esistente:
serve review indipendente prima dell'integrazione. Ogni conferma usa la stessa
POST paired e lo stesso controllo dei duplicati prima dell'invio; soltanto
la rilettura positiva permette l'esito registrato e verificato. Nessuna nuova
route, autorizzazione, sessione Web o autorità di scrittura. Il controllo dei
duplicati resta preventivo, senza deduplicazione atomica fra client concorrenti.
Lettura e conferma sono implementate nei moduli documentali esistenti;
la shell conserva composizione e rinnovo del contesto.

## Prove e limiti

- Prove GPUI con trasporto loopback sintetico: una sola POST dopo una conferma,
  avanzamento manuale, esiti misti registrato/assente/duplicato, perdita della
  rilettura senza secondo invio, fonte estranea e risposta tardiva dopo chiusura.
  Blocco e cambio sezione ritirano selezione e originale. Nessuna porta 3000
  o installazione condivisa: le fixture HTTP ottengono una porta dal sistema.
- Test del contenuto: dati assenti, bloccati, dimensione errata, binario dichiarato
  testo, UTF-8 invalido e ricomposizione esatta delle pagine Unicode.
- Workspace Rust: 509 prove passate, zero fallite, 10 ignorate preesistenti.
  Sul delta finale: 28 prove documentali passate.
- Clippy di workspace/tutti i target con warnings negati e fmt passati, usando
  `gpui_platform/runtime_shaders`; resta l'avviso upstream `block 0.1.6`.
  Selettore: 45 test passati, inventario COMPLETE, 1330 file, 1286 selezionati,
  44 esclusioni motivate. Claims e never-regress passati. Nessun JS/TS modificato.
- 48 catture di finestre GPUI reali su macOS 27.2, Giorno/Grafite, 1200/390 punti,
  con stati inventati predisposti in una copia esterna del sorgente. Provano
  il rendering, non picker, login, VoiceOver o funzionamento installato.
  La base mostra l'assenza delle nuove funzioni senza simularne l'equivalenza.
  Le catture e i log completi sono nella galleria esterna
  `~/Antigravity/mf-hillclimb-20261028/gpui-g2-g4-rest-<head>/`.
  I CSV identificano catture e sorgenti con SHA-256; nessuna galleria in Git.
  Le sorgenti del rendering coincidono con il codice runtime finale; la
  differenza nel file document_library è soltanto nelle asserzioni dei test.

Rossi intermedi conservati nei log esterni: import Rust non usato e valore
spostato nel rendering; nome di variante errato in una nuova fixture;
dipendenza `js-yaml` assente prima di `npm ci`; prova multipla inizialmente
fallita perché il rinnovo dell'epoch ritirava anche la selezione da confermare.
La correzione conserva la selezione soltanto nel rinnovo della singola conferma,
senza cambiare il ritiro degli altri contesti. Le prime compilazioni del harness
esterno hanno richiesto toolchain esplicita, uniformazione del tipo renderizzato
e correzione della variante Missing. Nessun guard, test o limite indebolito.

## Residuo dichiarato

| Unità | Residuo |
| --- | --- |
| G-2 | Sicurezza account, gestione completa dei modelli e profilo hardware, account ChatGPT, Fabric/governance, repertori amministrativi, compliance, diagnostica e sviluppo. Invariate le parti già integrate e i claim su cifratura e zero-knowledge. |
| G-4a | Anteprima inline di PDF e immagini, qualifica completa del picker nativo e del ritorno sul prodotto installato. L'originale testuale è un incremento, non l'intero renderer Web. |
| G-4b | Revisione dei dati estratti e curation. Non sono sostituite dalla conferma dell'allegato. |
| G-4c | Mapping CSV, anteprima e conferma per riga. Un CSV può essere allegato come file, senza importarne i dati. |
| G-4d | Nuova scheda da documento: non disponibile. Il comando C-6 di PR #736, ancora aperta alla base del contributo, rimane l'unico punto di innesto; nessuna implementazione duplicata. |
| G-7/8/9 | Matrice completa degli stati, accessibilità nativa, installazione e qualifica del candidato. Nessun esito clinico attribuito a queste prove. |

Implementazione assistita: GPT 6.1 Sol, effort xhigh; nessun collaboratore
aggiuntivo. Consumi non attribuibili a questa esecuzione.
