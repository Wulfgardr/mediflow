---
summary: "Lume language specification: focal light model, matter and palette, il filo, two typographic voices, semantic depth, attention grammar, provenance, motion, platform notes."
read_when:
  - "Implementing or prototyping any Lume surface, token, or interaction."
  - "Understanding how Lume renders hierarchy without glass."
---

# La lingua

## 1. Il modello focale

In ogni istante l'interfaccia ha un solo **fuoco**: l'oggetto clinico in lavorazione (il paziente selezionato, il referto aperto, la terapia in modifica). Tutto il resto si dispone su tre zone di luce:

| Zona | Cosa contiene | Resa |
| --- | --- | --- |
| **Fuoco** | L'oggetto in lavorazione | Superficie più chiara e leggermente più calda, contrasto pieno, ombra corta che la solleva, filo pieno sul bordo sinistro |
| **Penombra** | Il contesto di lavoro (worklist, pannelli vicini) | Superficie neutra, contrasto pieno del testo ma cromatismo trattenuto, nessuna ombra |
| **Buio operativo** | Il telaio (rail, barre, chrome) | Superficie leggermente più scura e più fredda, contenuti attenuati, zero ornamento |

Regole:

- Il fuoco è UNO. Se due zone sembrano fuoco, la gerarchia è rotta.
- Il fuoco non si assegna con il colore ma con la luce: luminanza, temperatura, ombra. Il colore resta ai segnali clinici.
- Il buio operativo non è nascosto: è presente e raggiungibile, ma non chiede attenzione (la lezione Linear: il chrome recede, il lavoro avanza).
- La densità (comoda/densa) e il modello focale sono assi indipendenti: lo strumento denso ha comunque un fuoco.

## 2. La materia

Niente vetro strutturale. Le superfici sono opache, con bordi reali da 1px e ombre corte. La profondità è semantica: si solleva solo ciò che è importante ora.

### Palette dei registri

Tre registri di luce, non tre temi (giorno/grafite seguono il chiaro/scuro di sistema; guardia è il perfezionamento notturno del registro scuro, ereditato dall'esplorazione B di Vetro Clinico):

| Token | Giorno | Grafite | Guardia |
| --- | --- | --- | --- |
| `surface.canvas` (periferia) | `#eef0f2` | `#121417` | `#0c0e12` |
| `surface.field` (penombra) | `#f5f5f4` | `#191c21` | `#14171d` |
| `surface.focal` (fuoco) | `#fbfaf7` | `#22252b` | `#1a1e26` |
| `surface.chrome` (buio operativo) | `#e6e8eb` | `#0e1013` | `#090b0e` |
| `ink.primary` | `#1a1c1e` | `#e9ecef` | `#e3e8ee` |
| `ink.muted` | `#5f6b76` | `#8f9aa6` | `#8792a3` |
| `accent.minerale` (interattivo) | `#33506b` | `#8fb0cc` | `#7fa0bc` |

Il gradiente di temperatura è la novità: il fuoco è appena più caldo (avorio), la periferia appena più fredda (minerale). Sotto la soglia del dichiarabile a parole, sopra la soglia del percepibile: è la lampada, non un tema.

I segnali clinici NON cambiano: `signal.warning #9a6a2f`, `signal.critical #a33a2f`, `signal.success #4b6354`, `signal.plum #555161` (e le loro derivazioni scure/notturne dai token). La semantica clinica è patrimonio, non stile.

### Grana

Una grana sub-percettiva (rumore monocromo, opacità <= 2%) è ammessa SOLO su `surface.canvas` e `surface.chrome`, per togliere sterilità alle campiture grandi. Mai su fuoco, tabelle, testo, stampa. Con Increase Contrast sparisce.

### Dove finisce il vetro

Il blur resta ammesso in un solo punto: gli overlay transitori (modale, popover), come rendering opzionale di piattaforma (su Apple gli sheet di sistema sono già vetro; sul web è una scelta di budget). La gerarchia NON deve dipenderne: lo scrim e l'ombra fanno il lavoro da soli.

## 3. Il filo

La firma grafica di Lume è una linea sottile (1px, `accent.minerale` o tono semantico) con un solo significato: la continuità della cura.

| Dove | Cosa fa |
| --- | --- |
| Bordo sinistro dell'oggetto focale | Marca il fuoco (al posto delle campiture di selezione) |
| Spina della timeline del diario | Le voci si appendono al filo, in ordine di tempo |
| Storia di un valore di laboratorio | Il filo collega le rilevazioni, con la banda di riferimento dietro |
| Connettore di provenienza | Lega un contenuto alla sua fonte (referto, trascrizione) |

**Il tratto è lo stato epistemico**: tratteggiato = bozza (contenuto proposto o non ancora rivisto), pieno = firmato/verificato dal medico. Una regola sola, applicata ovunque: si vede a colpo d'occhio cosa è consolidato e cosa no, senza badge chiassosi. I contenuti proposti dagli strumenti di supporto seguono la stessa regola: entrano tratteggiati e diventano pieni solo con la revisione esplicita del medico.

Il filo non si moltiplica: mai più di un filo per contenitore. Non è un divisore (i divisori restano bordi neutri): se una linea è `accent.minerale`, porta significato.

## 4. Le due voci

| Voce | Famiglia | Ruolo |
| --- | --- | --- |
| **La Voce** | Sans umanista variabile. Web/tri-OS: font variabile impacchettato nell'app (candidato: Inter Variable con asse ottico; niente fetch remoti, l'app è locale-first). Apple: SF Pro (idiomatico, ha già optical sizing). | Discorso: titoli, etichette, prosa clinica, navigazione |
| **Il Registro** | Mono leggibile impacchettato (candidato: IBM Plex Mono; Apple: SF Mono). | Certificazione: ogni atomo verificabile |

**La regola del Registro**: qualunque dato che il medico potrebbe leggere ad alta voce per verificarlo si compone nel Registro con cifre tabellari: dosi (`5 mg`), valori (`158 mmHg`), codici (ICD, LOINC, AIC), date e orari, ID. Il discorso resta nella Voce. Questo crea una distinzione istantanea tra dato e narrazione, che è la fiducia resa tipografia.

Scala: invariata da Vetro Clinico ([../vetro-clinico/02-token.md](../vetro-clinico/02-token.md)): pavimento 10px, gerarchia con il peso, tracking per taglia, `rem` per lo zoom. L'asse ottico della Voce si usa dove c'è: display più stretto e disegnato ai corpi grandi, forme più aperte ai corpi piccoli.

## 5. Profondità semantica

Tre livelli, resi con luce e non con blur:

| Livello | Resa | Uso |
| --- | --- | --- |
| 0, appoggiato | `surface.field`, bordo 1px, nessuna ombra | Penombra, liste, pannelli |
| 1, sollevato | `surface.focal`, bordo 1px, ombra corta (`0 2px 8px` a bassa opacità) | Il fuoco |
| 2, sospeso | `surface.focal`, ombra media + scrim dietro | Overlay transitori |

Niente livelli intermedi, niente ombre decorative. Un componente che "vuole" un'ombra senza essere fuoco o overlay sta chiedendo una gerarchia che non merita.

Geometria: si eredita la concentricità di Vetro Clinico ma si raffredda la curva: `radius.panel 20px`, `radius.card 14px`, `radius.control 10px`, `radius.chip 999px`. Raggi più asciutti spostano il carattere dal morbido consumer al preciso professionale (il foglio tecnico della frontiera, senza arrivare allo spigolo vivo).

## 6. La grammatica dell'attenzione

Il layout di Lume non presenta dati: presenta decisioni.

1. **Testata invariabile**: identità paziente, allergie, alert, terapie critiche, sempre nello stesso posto, mai sotto scroll. È l'unico elemento che non partecipa al modello focale: è sempre leggibile.
2. **La colonna dell'attenzione**: ciò che richiede una decisione (esiti nuovi, delta rilevanti, referti da rivedere, rinnovi in scadenza), ordinabile e spiegabile. Non è un feed di tutto: ogni voce dichiara perché è lì.
3. **Baseline prima del benchmark**: i valori si confrontano prima con la storia del paziente (banda personale sul filo) e poi con il range di laboratorio (banda di riferimento con fonte). "Diverso dal solito per questo paziente" pesa più di un semaforo generico.
4. **L'anatomia della riga di laboratorio** (canonica): nome (Voce), valore (Registro, allineato a destra), unità, banda di range con fonte, delta dal precedente comparabile, data. Il grafico della storia è il filo con punti datati e banda dietro: mai sparkline ornamentali senza assi ancorati.
5. **Densità a strati**: riga -> pannello laterale di contesto -> documento sorgente, senza perdere il punto. I pannelli laterali sostituiscono le navigazioni distruttive.
6. **Fiducia ispezionabile**: lo stato di salvataggio, backup e cifratura è sobrio ma sempre raggiungibile dal buio operativo; una bozza dichiara di esserlo (tratteggio), un dato salvato non lo urla.

## 7. Motion: la luce si sposta

- Quando il fuoco cambia, si muove la luce, non le superfici: cross-fade di luminanza e temperatura (150-200ms, ease-out) dal vecchio al nuovo fuoco; il filo si ridisegna sul nuovo bordo.
- Il filo può estendersi (una linea che si allunga, 200ms) per esprimere continuità: Quadro -> Scheda è il filo che prosegue, non una pagina che vola.
- La manipolazione diretta (drag, riordino) mantiene le spring interrompibili di Vetro Clinico ([../vetro-clinico/04-interazione.md](../vetro-clinico/04-interazione.md)): la fisica resta dove c'è un gesto.
- Niente parallasse, niente morphing di superfici, niente blur animato. Reduce Motion è quasi già soddisfatto per costruzione: il cross-fade è il comportamento di default, non il fallback.

## 8. Note per piattaforma

- **Web**: implementazione di riferimento. I registri sono set di custom properties; il modello focale è un attributo (`data-lume-focus`) che sposta le variabili di zona; il filo è un bordo/pseudo-elemento, la sua estensione è una transizione su `height`/`width` in compositor (scale). Il font variabile impacchettato entra nel bundle locale (nessun fetch remoto).
- **Apple**: SF Pro/SF Mono al posto delle voci impacchettate; il fuoco usa i colori semantici custom sopra i materiali opachi; gli overlay restano gli sheet di sistema (vetro nativo dove l'OS lo dà: è idiomatico, non è una violazione: la legge riguarda le superfici strutturali e cliniche). `matchedGeometryEffect` solo per il filo che prosegue.
- **Windows**: Mica resta il fondo di finestra (è il "canvas" idiomatico); i tre livelli di luce vivono nei layer fill; Registro = Cascadia Mono se non si impacchetta Plex.
- **Linux/GNOME**: Lume degrada meglio del vetro per costruzione (è già opaco e piatto): zone di luce come toni Adwaita-compatibili, filo come accent, nessun blur da rimuovere.
- **Stampa**: Inchiostro ([../vetro-clinico/08-esplorazioni.md](../vetro-clinico/08-esplorazioni.md), D) è già il registro di stampa di Lume; il Registro mono per i valori vi si estende naturalmente.

## 9. Contratti invariati

Accessibilità ([../vetro-clinico/06-accessibilita.md](../vetro-clinico/06-accessibilita.md)), interazione e stati onesti ([../vetro-clinico/04-interazione.md](../vetro-clinico/04-interazione.md)), responsività e densità ([../vetro-clinico/05-responsivita.md](../vetro-clinico/05-responsivita.md)) valgono in Lume parola per parola. I contrasti dei registri vanno misurati come da matrice (i valori di palette qui sopra sono progettati per passare 4.5:1 ma la misura fa fede).
