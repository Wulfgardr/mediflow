---
summary: "Four design explorations for Vetro Clinico evolution: Strumento (density), Guardia (night), Vetro Vivo (motion), Inchiostro (print). Each with recipe, cost, verdict."
read_when:
  - "Deciding the next evolution of MediFlow's visual and interaction language."
  - "Looking for the rationale behind density mode, night mode, motion language, or print output design."
---

# Esplorazioni

Quattro proposte, tutte dentro il perimetro di Vetro Clinico (nessuna è un tema alternativo: ADR 0047 resta intatto). Ognuna con intento, ricetta, campo di applicazione, costo e verdetto. Il dimostratore statico è [mockups/esplorazioni.html](./mockups/esplorazioni.html).

Registro storico: la direzione calda/carta "Referto" per la UI dell'app è stata valutata e respinta nel 2026-06; nessuna di queste proposte la ripropone. Inchiostro (D) riguarda solo gli artefatti stampati/esportati, non l'app.

---

## A. Strumento (il cockpit come strumento di misura)

**Intento.** Nelle superfici di volume (worklist, laboratorio, terapie in polifarmacoterapia) il clinico non "legge una pagina": consulta uno strumento. La lezione dei terminali professionali: la densità ben gerarchizzata riduce il carico cognitivo, il minimalismo che moltiplica i click lo aumenta. Strumento è Vetro Clinico ad alta densità, non un altro linguaggio.

**Ricetta.**
- Densità densa di [05-responsivita.md](./05-responsivita.md): righe 32px, corpo 13px, padding 10-12px, attivata da `data-ui-density="dense"`.
- Cifre tabellari ovunque ci sia un numero clinico; colonne allineate a destra per i valori, a sinistra per le etichette.
- Layout esteso a tre pannelli (>= 1600px): worklist, Quadro, azioni/coda di revisione, ridimensionabili; l'80% dei task ricorrenti senza cambiare schermata.
- Il vetro si ritira al minimo strutturale: rail e capsule; tutto il resto è carta fitta. Gli orb decorativi spariscono in modalità densa.
- Tastiera al centro: le scorciatoie a lettera singola e la palette comandi ([04-interazione.md](./04-interazione.md)) sono il modo primario di guidare lo strumento.
- Micro-visualizzazioni al posto di testo ripetuto: sparkline per gli andamenti (già presenti sul nativo con Charts), delta compatti (freccia + valore) per i confronti tra rilevazioni.

**Dove si applica.** Worklist del cockpit, laboratorio "per data", terapie, code di revisione. NON si applica a Quadro e diario (superfici di lettura, restano comode).

**Costo.** Medio: la densità è un set di token dimensionali + un attributo; il tre-pannelli è un'evoluzione del layout esteso. Converge con le fasi 2 e 4 della roadmap 2026-07-02 (liste a riga maestra, foglio sinottico).

**Rischi.** Estetica "retro terminale" copiata senza il criterio di prioritizzazione che la giustifica; densità sotto i target di accessibilità (mitigato: i target non scendono, [05-responsivita.md](./05-responsivita.md)).

**Verdetto: adottare.** È l'evoluzione più coerente con i dolori reali censiti (card-soup, polifarmaco). Richiede il mini-ADR della preferenza densità.

---

## B. Guardia (la notte clinica)

**Intento.** Il dark mode attuale è un tema scuro da ufficio. Guardia è il dark portato alla sua conseguenza clinica: studio in penombra, reperibilità notturna, occhi adattati al buio. Non un terzo tema: il perfezionamento del dark esistente.

**Ricetta.**
- Luminanza massima delle superfici abbassata (`surface.base` verso `#0c0e12`, elevated `#151a22`), testo primario leggermente sotto il bianco pieno (`#e8ecf2`) per ridurre l'abbagliamento; contrasti sempre >= 4.5:1.
- Segnali clinici ricalibrati per fondo scuro: il critico non è rosso saturo su nero (vibra e affatica) ma un corallo desaturato; l'attenzione vira all'ambra; il successo resta salvia spenta. Stesse semantiche, tinte derivate dai token con un livello "notte" nel JSON sorgente, non una palette nuova.
- Il vetro si addensa: blur ridotto (14-16px), opacità più alta; di notte la traslucenza rende meno e costa di più in leggibilità.
- Niente superfici bianche piene improvvise (modali, stampe anteprima): anche il vetro transitorio resta scuro.
- Attivazione: segue il tema scuro, come raffinamento dei suoi token; nessun interruttore in più.

**Dove si applica.** Tutto il dark mode, web e nativo (su Apple i colori semantici di sistema fanno già parte del lavoro; i token clinici si allineano).

**Costo.** Basso, MA con prerequisito: il consolidamento del dark derivato dai token ([02-token.md](./02-token.md), azione 4). Ricalibrare letterali sparsi a mano sarebbe lavoro buttato.

**Rischi.** Deriva estetica "gaming" se si esagera con il nero puro; contrasti di frontiera da misurare (il corallo desaturato su `#0c0e12` va verificato, non stimato).

**Verdetto: adottare come evoluzione del dark**, subito dopo il consolidamento dei token. È il tema scuro che il dominio merita.

---

## C. Vetro Vivo (la continuità spaziale)

**Intento.** Oggi il vetro è statico: c'è, ma non si comporta da materiale. Vetro Vivo è il linguaggio di moto di Vetro Clinico: le superfici si fondono, si spostano e si riassorbono con la fisica delle spring, e la transizione Quadro/Scheda diventa un movimento continuo invece di un cambio di pagina.

**Ricetta.**
- **Quadro -> Scheda come elemento condiviso**: l'identità paziente si muove dalla posizione in-cockpit alla testata della Scheda. Web: View Transitions API (Chromium, Safari 18+), fallback senza transizione; nativo: `matchedGeometryEffect` / zoom transition.
- **La command capsule morfa**: da capsula a pannello comandi e ritorno, un'unica superficie che cambia forma. Nativo OS 26+: `GlassEffectContainer` + `glassEffectID` (il morphing è la funzione nativa esatta di questa API); web: spring su clip-path/size con il contenuto in cross-fade.
- **Materializzazione**: gli overlay vetro entrano animando blur e scala insieme (il materiale "arriva"), non con un fade piatto.
- **Bordi di scorrimento vivi**: `scrollEdgeEffectStyle(.soft)` sul nativo, maschera sfumata sul web ([03-materiali.md](./03-materiali.md) sezione 4).
- Fisica: spring smorzata standard; rimbalzo solo dopo gesti con quantità di moto; tutto interrompibile ([04-interazione.md](./04-interazione.md)).
- Con Reduce Motion: tutto degrada a cross-fade, nessuna funzione persa.

**Dove si applica.** Le 3 transizioni che contano: Quadro/Scheda, capsule/palette, apparizione overlay. NON si sparge ovunque: tre movimenti eccellenti valgono più di trenta mediocri.

**Costo.** Medio-alto sul web (View Transitions + spring; dipendenza opzionale da una lib di spring tipo Motion, oppure spring CSS quando basta), basso sul nativo OS 26+ (le API fanno il lavoro). Prerequisito: URL del cockpit (fase 6), altrimenti la continuità non ha fondamenta.

**Rischi.** Motion come decorazione (mitigato: solo le 3 transizioni); prestazioni del blur animato su schermi grandi (budget di [07-piattaforme/web.md](./07-piattaforme/web.md)).

**Verdetto: adottare selettivamente**, dopo Strumento e le fasi 5-6. È ciò che farà percepire il vetro come materiale e non come filtro.

---

## D. Inchiostro (gli artefatti stampati)

**Intento.** MediFlow produce artefatti che escono dall'app: piano terapeutico (export già esistente sul nativo, `TherapyPlanDocument`), stampe per il paziente, PDF. Oggi non hanno un linguaggio. Inchiostro è il linguaggio di stampa di Vetro Clinico: nero su bianco, filetti sottili, tipografia che regge la fotocopiatrice dell'ambulatorio.

**Ricetta.**
- Solo inchiostro su carta: nessun grigio sotto il 45% di copertura per il testo, nessun colore di sfondo; il colore semantico diventa peso + glifo (un triangolo pieno per l'attenzione regge la stampa in bianco e nero, un arancione tenue no).
- Stessa famiglia tipografica di sistema in export; gerarchia con corpo e peso: titolo documento 18 semibold, sezioni 13 semibold maiuscoletto, corpo 10.5/15, tabelle 9.5 con cifre tabellari.
- Tabelle con filetti orizzontali sottili (0.5pt), niente zebra; margini generosi (20mm); intestazione con identità paziente e data; piè di pagina con origine ("Generato da MediFlow il ...") e pagina N di M.
- Il layout di stampa è un foglio di stile dedicato (`@media print` sul web + template PDF condiviso nei concetti sul nativo), non la UI "stampata".

**Dove si applica.** Ogni PDF/stampa: piano terapeutico, esportazioni della Scheda, referti interni. Mai alla UI a schermo.

**Costo.** Basso-medio: un foglio di stile print + revisione del template PDF nativo.

**Rischi.** Nessuno strutturale; unica cura: parità dei contenuti tra export web e nativo, così il linguaggio di stampa è uno.

**Verdetto: adottare.** Colma un vuoto reale con costo contenuto, ed è il posto giusto per la sensibilità "carta": sugli artefatti stampati, non nell'app.

---

## Sequenza consigliata

1. **Strumento** (con fasi 2/4 della roadmap): risponde ai dolori censiti.
2. **Guardia** (dopo il consolidamento token): basso costo, resa quotidiana.
3. **Inchiostro** (parallelizzabile): indipendente dal resto.
4. **Vetro Vivo** (dopo fase 6): il tocco finale, quando le fondamenta reggono.
