---
summary: "Lume: the destination design language for MediFlow. Manifesto, relationship to Vetro Clinico, reading order, adoption status."
read_when:
  - "Evaluating or implementing the Lume design language proposal."
  - "Deciding the long-term visual direction of MediFlow beyond Vetro Clinico."
---

# Lume

**Stato: lingua di destinazione** (decisione di Leonardo, 2026-07-12, formalizzata in [ADR 0078](../../adr/0078-lume-lingua-di-design-di-destinazione.md)). Lume è la corsia stilistica nuova derivata dalla review di design del 2026-07-12: ricerca di mercato su lane GPT-5.6 (prodotti premium, frontiera clinica, frontiera estetica, perlustrazione dei gestionali GP e degli applicativi provider USA: [02-derivazione.md](./02-derivazione.md) e [04-perlustrazione.md](./04-perlustrazione.md)) e sintesi progettuale Fable. Il canone operativo transitorio resta [Vetro Clinico](../vetro-clinico/README.md) finché la migrazione ([03-migrazione.md](./03-migrazione.md)) non avanza.

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
4. [04-perlustrazione.md](./04-perlustrazione.md): la perlustrazione EHR/provider e le 12 integrazioni normative alla grammatica.
5. [05-app-native.md](./05-app-native.md): mappa generale delle app native, grammatica compatta iPhone e note tri-OS prospettiche.
6. [06-macos-apple-contract.md](./06-macos-apple-contract.md): contratto di destinazione macOS, fonti Apple, availability, disposizione, materiali, debito corrente e sequenza verificabile.
7. [mockups/lume.html](./mockups/lume.html): dimostratore interattivo (aprire nel browser, nessuna dipendenza): modello focale, filo, due voci, registri giorno/grafite/guardia.

## Rapporto con il canone

- Lume e approvata come lingua di destinazione; Vetro Clinico ([../vetro-clinico/](../vetro-clinico/README.md)) resta il canone operativo transitorio finché le fasi di migrazione non sostituiscono i consumatori. I lavori DS-1..DS-3 servono anche a Lume e non vanno fermati.
- Le esplorazioni Strumento, Guardia e Inchiostro sono compatibili con Lume e vi confluiscono (Guardia diventa il terzo registro di luce; Strumento la densità dello strumento; Inchiostro resta il linguaggio di stampa).
- Vetro Vivo viene sostituita dal modello di motion di Lume (la luce si sposta, le superfici no), più sobrio e meno costoso.
- La decisione di prodotto e registrata in ADR 0074. Restano decisioni di delivery: font non-Apple, ordine delle slice e promozione dei singoli componenti dopo prova reale.
