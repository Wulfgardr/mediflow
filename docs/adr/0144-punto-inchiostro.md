---
summary: "Punto d'inchiostro aggiorna Lume: caratteri locali, tre inchiostri, piano unico, filetti e adattamenti delle superfici."
read_when:
  - "Modificando una superficie MediFlow o i token condivisi."
---

# ADR 0144: Punto d'inchiostro, evoluzione di Lume

Date: 2026-10-14

Status: Accepted. Aggiorna ADR 0078 per colore, tipografia, forma e movimento.

## Decisione

La direzione scelta il 9 ottobre viene anticipata sulle superfici esistenti
su richiesta del 14 ottobre. La specifica è nel
[dossier](../design/punto-inchiostro/README.md), il contratto in
[DESIGN.md](../../DESIGN.md). I token canonici sono `docs/design/lume/tokens/lume.tokens.json`;
CSS e implementazione Apple mantengono gli alias Lume per i consumatori.

Newsreader locale rende titoli, nomi in testata e prosa; sistema rende
controlli, tabelle, date e valori; Plex Mono rende soltanto i codici.
Un piano in luce sulla penombra raccoglie tabelle a filetti. Il punto vuoto
indica proposta, quello blu bozza, quello asciutto registrazione riletta:
sempre con una parola, mai come segnale clinico generico. I gesti ripetuti
non animano posizione o scala; movimento ridotto elimina transizioni.

Il web conserva comandi e guardie di compilazione, affianca quadro e diario
nel riepilogo e usa navigazione compatta a quattro destinazioni. Le app
Apple adottano gli stessi ruoli attraverso controlli della piattaforma.
Windows e Linux usano il runtime web esistente. Mini conserva il suo
contratto JSON/NDJSON: una nuova interfaccia terminale non è implicita.
L'icona candidata Giorno/Grafite è approvata il 14 ottobre.

L’accettazione comprende la composizione di tutte le schermate esistenti:
moduli clinici, Agenda, Diario, Repertori, Analisi, Scale, Impostazioni e
moduli anagrafici seguono il banco e la mappa del dossier, oltre ai token.
Il banco navigabile viene pubblicato come simulazione distinta dalle
catture del prodotto sul sito.

## Confini e verifica

Questo cambiamento è presentazionale: non introduce atomicità fra allegati
e voce, nuove modalità di ascolto o garanzie di esito. Le parti funzionali
di WUL-767 e WUL-772 restano nelle rispettive issue. Il sito WUL-769 ha
anteprima e pubblicazione distinte. Nessuna qualificazione clinica deriva
dal cambiamento visivo.

Accettazione: deriva dei token, contrasto testo almeno 4,5:1 nei due temi,
font locali, build web/Apple e navigazione sulle superfici reali con soli
dati sintetici, a larghezza compatta ed estesa e con movimento ridotto.

## Emendamento 2026-10: scala tipografica web

Il web definisce i ruoli in `app/globals.css`, come classi `type-*` e proprietà
`--type-*` riusate dai CSS module. I corpi della specifica sono espressi in rem
con riferimento di 16 px, senza fissare il corpo della radice: seguono così
la dimensione del testo scelta nel browser. Il nome paziente passa da 28 a
26 px in larghezza compatta. Il nome prodotto resta Newsreader 500 a 21 px.

Tailwind 4 carica esplicitamente `tailwind.config.ts`: `text-xs` vale 12 px,
`text-sm` 13 px, `text-base` 14 px e `text-lg` 15 px. `sm` serve soprattutto
date, note e metadati; i controlli condivisi fissano il ruolo ordinario a 14 px.
`medium` equivale a 400; `semibold` a 600. Gli alias storici dei pesi maggiori
equivalgono a 600 ma non sono ammessi nei nuovi sorgenti. Le classi da `xl`
in su non sostituiscono il ruolo di titolo. Titoli, nomi e prosa clinica
usano Newsreader; comandi, errori, tabelle e valori usano il sistema. Il mono
a 12 px e peso 400 identifica codici e righe di comando, mai stati vuoti.
L'enfasi nel testo clinico ricco usa il registro 600, senza sintetizzare
un grassetto Newsreader fuori specifica.

Il punto finale dei titoli di pagina è decorativo, escluso dal nome
accessibile; i nomi delle persone restano senza punto. È l'applicazione
del punto di chiusura previsto dalla specifica, senza associarlo allo stato
di salvataggio. Avvio e sblocco mostrano il marchio corrente MediFlow.

`check:type-scale` controlla utility, CSS e stili inline in `app/` e
`components/`, con due sole eccezioni per testo nascosto nella navigazione
contratta. Il test `e2e/type-scale.spec.ts` misura famiglia, peso e corpo
del testo renderizzato, con campi, segnaposto, dettagli e pannelli della
scheda, nei due temi e con dimensioni della radice aumentate. Le rotte
delle impostazioni sono enumerate dal filesystem. L'insieme ammesso nel
test è indipendente dai valori dei ruoli implementati.

Il test non copre ogni dialogo, ogni stato remoto, documenti incorporati
o app Apple. Lo zoom reale del browser resta distinto dal controllo in rem.
L'esistenza dello spec non attesta una sua esecuzione riuscita: le prove
sulla revisione restano necessarie prima dell'accettazione visuale.
