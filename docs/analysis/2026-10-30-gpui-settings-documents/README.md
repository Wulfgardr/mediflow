# Impostazioni e documenti GPUI su Mac

Tranche nativa G-2/G-4 da `dad877af34028b579894e301e1d69ff947263c1a`.
G-2/G-4 restano aperti: il delta e i residui sono registrati nel
[censimento G-0](../2026-10-23-gpui-census.md#delta-del-30-ottobre-2026--impostazioni-e-documenti-mac).

Impostazioni ora ha un indice e pagine native distinte. Il ritorno riporta il
fuoco al comando che ha aperto la pagina e conserva la bozza del profilo.
Un enum sostituisce i due flag indipendenti delle sottopagine; le fasi delle
operazioni documentali sono anch'esse un enum. Rendering di impostazioni,
documenti e soglia di conferma escono dalla shell principale in tre moduli
che contengono le implementazioni effettive.

L'importazione respinge file vuoti e verifica i duplicati prima della
revisione e della conferma, usando elenco corrente e byte dei candidati con
stesso formato/dimensione. Una fonte non leggibile non diventa «nuovo file».
Un documento già presente non viene reinviato. Non è deduplicazione atomica
fra client concorrenti. Il writer, i permessi, le route e i contratti host
restano invariati. Le funzioni non native sono dichiarate; nessun rinvio Web
viene contato come migrazione completata.

## Prove native

[Manifest con SHA-256](captures.json): 72 immagini, prima/dopo, Giorno/Grafite,
1200 e 390 punti. Nove stati: indice impostazioni, profilo, aspetto, modelli,
documenti con fonte/sintesi, vuoto, caricamento, errore e conferma documento.
Finestre e renderer GPUI reali su Apple Silicon, macOS 27.2; stati sintetici
predisposti da un harness temporaneo esterno al prodotto. Il codice di
predisposizione non è incluso nell'app consegnata.

Le immagini provano il rendering dei componenti, non il percorso completo
di autenticazione/picker o il comportamento del server. Non attestano
VoiceOver, tutte le scale del testo, installazione o qualifica clinica.
I tentativi iniziali di cattura hanno incontrato un errore di composizione
del fixture e finestre non ancora visibili ai vecchi helper AX. La serie
pubblicata usa dimensioni impostate all'avvio e cattura della finestra nativa.

## Verifiche di comportamento

Rust workspace, tutti i target, toolchain 1.98.1, lockfile e dipendenze locali.
Le nuove prove di importazione usano il trasporto HTTP su loopback: duplicato
senza POST, fonte scomparsa senza POST, risposta 201 seguita da rilettura
fallita senza successo e senza secondo invio, con file conservato.
I test dei file distinguono assenza, cartella, vuoto, contenuto illeggibile,
identità estranea e contenuto diverso a pari dimensione. La navigazione
verifica conservazione della bozza, ritorno del fuoco e ritiro al blocco.

I sette test preesistenti che richiedono un ancestor macOS firmato restano
ignorati. L'avviso upstream di compatibilità futura di `block 0.1.6` resta
presente. Il primo Clippy ha rilevato una clonazione inutile in un nuovo test;
corretta. Tre prove HTTP iniziali si sono fermate sul campo obbligatorio
`taxCode` mancante nella fixture; corretto usando un valore sintetico.
Il selettore CI è stato aggiornato per i nuovi moduli e per il loro ordine
alfabetico imposto da rustfmt; le prove negative rifiutano moduli mancanti
o condizionali. Nessuna soglia di accettazione è stata alzata.
