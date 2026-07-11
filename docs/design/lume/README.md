---
summary: "Lume: the proposed next design language for MediFlow. Manifesto, relationship to Vetro Clinico, reading order, adoption status."
read_when:
  - "Evaluating or implementing the Lume design language proposal."
  - "Deciding the long-term visual direction of MediFlow beyond Vetro Clinico."
---

# Lume

**Stato: proposta.** Lume è la corsia stilistica nuova derivata dalla review di design del 2026-07-12: ricerca di mercato su tre lane GPT-5.6 (prodotti premium, frontiera clinica, frontiera estetica: [02-derivazione.md](./02-derivazione.md)) e sintesi progettuale Fable. Diventa canone solo con l'approvazione di Leonardo e un ADR dedicato; fino ad allora il canone operativo resta [Vetro Clinico](../vetro-clinico/README.md).

## Il manifesto

Il vetro era il materiale. Il lume è l'attenzione.

Vetro Clinico ha dato a MediFlow una disciplina dei materiali: vetro per il telaio, carta per la clinica, colore solo come segnale. Lume fa il passo successivo: smette di chiedersi di cosa sono fatte le superfici e si chiede dove deve andare lo sguardo. In un ambulatorio la risorsa scarsa non è lo schermo: è l'attenzione del medico, sei ore al giorno. L'interfaccia si organizza come la lampada sul tavolo di visita: una zona in piena luce (il caso in lavorazione), una penombra leggibile (il contesto), un buio operativo che non chiede nulla (il telaio). E "a lume di ragione" è esattamente il registro del prodotto: ciò che si vede deve poter essere verificato.

Quattro rotture rispetto al paradigma attuale, tutte motivate dalla ricerca:

1. **La luce sostituisce il vetro come sistema di gerarchia.** Profondità e importanza si esprimono con luminanza, temperatura e ombre brevi, non con blur e trasparenza. Il vetro si ritira a rendering opzionale degli overlay transitori. È la direzione post-glass della frontiera 2026 e la lezione della stessa Apple, che ha ridotto la trasparenza di default un anno dopo averla lanciata.
2. **Il filo è la firma grafica.** Una sola linea sottile porta il significato di continuità della cura: spina della timeline, bordo dell'oggetto focale, connettore della storia di un valore. E il suo tratto codifica lo stato epistemico: tratteggiato è bozza, pieno è firmato. Niente ornamento: la linea è dato.
3. **Due voci tipografiche.** La Voce (sans umanista, con optical sizing dove disponibile) parla; il Registro (mono) certifica. Ogni atomo verificabile della clinica (dose, valore, codice, orario) è composto nel Registro con cifre tabellari: si riconosce a colpo d'occhio cosa è dato e cosa è discorso.
4. **La grammatica dell'attenzione.** Testata paziente invariabile, colonna di ciò che richiede attenzione (non di tutto ciò che esiste), baseline personale prima del benchmark, provenienza sempre visibile. Il layout non presenta dati: presenta decisioni da prendere.

Ciò che NON cambia: le leggi cliniche di Vetro Clinico restano fondamenta anche di Lume. Colore solo come semantica, stati onesti, tastiera di prima classe, contratto WCAG 2.2 AA, densità a due livelli, materiali idiomatici per piattaforma, niente meta-testo, trattino lungo bandito.

## Ordine di lettura

1. [01-lingua.md](./01-lingua.md): la specifica completa: modello focale, materia, filo, tipografia, profondità, grammatica dell'attenzione, provenienza, motion, note per piattaforma.
2. [02-derivazione.md](./02-derivazione.md): la ricerca di mercato (tre lane GPT-5.6 Terra con fonti), cosa è stato scartato e perché ogni scelta di Lume discende dai dati.
3. [03-migrazione.md](./03-migrazione.md): il percorso da Vetro Clinico: mappa dei token, fasi, rischi, cosa sopravvive.
4. [mockups/lume.html](./mockups/lume.html): dimostratore interattivo (aprire nel browser, nessuna dipendenza): modello focale, filo, due voci, registri giorno/grafite/guardia.

## Rapporto con il canone

- Vetro Clinico ([../vetro-clinico/](../vetro-clinico/README.md)) resta il canone finché Lume non è approvata: i lavori di consolidamento DS-1..DS-3 della sua roadmap servono ANCHE a Lume (stessi token semantici, stessi componenti) e non vanno fermati.
- Le esplorazioni Strumento, Guardia e Inchiostro sono compatibili con Lume e vi confluiscono (Guardia diventa il terzo registro di luce; Strumento la densità dello strumento; Inchiostro resta il linguaggio di stampa).
- Vetro Vivo viene sostituita dal modello di motion di Lume (la luce si sposta, le superfici no), più sobrio e meno costoso.
- Decisione richiesta: ADR "Lume come lingua di design di destinazione", dopo la valutazione del dimostratore.
