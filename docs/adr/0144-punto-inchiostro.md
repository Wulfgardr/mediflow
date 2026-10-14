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
[DESIGN.md](../../DESIGN.md). I token canonici sono `design/lume.tokens.json`;
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

## Confini e verifica

Questo cambiamento è presentazionale: non introduce atomicità fra allegati
e voce, nuove modalità di ascolto o garanzie di esito. Le parti funzionali
di WUL-767 e WUL-772 restano nelle rispettive issue. Il sito WUL-769 ha
anteprima e pubblicazione distinte. Nessuna qualificazione clinica deriva
dal cambiamento visivo.

Accettazione: deriva dei token, contrasto testo almeno 4,5:1 nei due temi,
font locali, build web/Apple e navigazione sulle superfici reali con soli
dati sintetici, a larghezza compatta ed estesa e con movimento ridotto.
