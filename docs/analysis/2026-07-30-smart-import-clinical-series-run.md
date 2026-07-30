# Smart Import: serie di risultati clinici

Stato: candidato locale. Dati usati: solo fixture sintetiche.

## Capacità esistente, gap, estensione minima

| Capacità esistente | Gap provato | Estensione minima |
|---|---|---|
| Smart Import revisiona diagnosi e terapie con fonti citabili | Nessun envelope per risultati clinici | Contratto `clinical_result_import.v1`, sempre `review_only` |
| Osservazioni LOINC/UCUM e link esplicito a item prescrizione | Nessuna proposta fail-closed dal documento | Matching esatto, temporale e source-aware; ambiguità in review |
| UI Smart Import con selezione e revisione prima della scrittura | I risultati clinici non sono presentati | Nessuna UI parallela in questa wave; estensione futura della UI esistente |
| Provider AI dietro servizio clinico | Pipeline non utile senza AI | Normalizzazione e serie deterministiche; provider solo su residui |

La verifica funzionale ha confermato il pannello Smart Import esistente e il
contratto di revisione per diagnosi/terapie tramite test e codice. Un avvio web
ha raggiunto soltanto la schermata di sblocco: è stato interrotto senza accesso
perché non era ancora legato a un database sintetico. Non costituisce prova UI
del nuovo contratto.

## Contratto e decisioni

- I fatti deterministici hanno precedenza e un provider non può sovrascriverli.
- LOINC e UCUM compaiono solo da mapping esatti marcati come verificati.
- La chiave idempotente combina hash documento, id referto, analita/codice,
  data/ora, valore e unità.
- La serie conserva tutti i risultati. `ultimi 3 + massimo 1 per anno
  precedente` è soltanto una vista collassata.
- Il collegamento prescrizione è una proposta: unico, ambiguo o non collegato.
- Nessuna diagnosi, persistenza clinica, chiamata SISS/FSE o accesso al DB vivo.
- La pipeline non-AI conserva normalizzazione, deduplica, serie e matching.

Decision audit: **accettate** le decisioni sopra. **Corretta** la prima
normalizzazione dei decimali, che ora gestisce tutte le virgole nel range.
**Aperto**: integrazione del nuovo envelope nel pannello Smart Import e nella
persistenza esplicita; questa wave non aggiunge una UI parallela né una write
path. Il debito visivo della scheda paziente è trasferito a un task UI separato.

## File posseduti e confini

- `lib/domain/documents/clinical-result-import.ts`
- `lib/domain/documents/clinical-result-import.test.ts`
- questo run record
- sorgente canonica toolkit:
  `skills/data-entry-document-ops/references/mediflow.md`

Nessun file di Intelligence Fabric, provider registry o lifecycle è stato
modificato. Nessun overlap rilevato.

## Verifica

- Baseline Smart Import: 21 test superati.
- Baseline observation range/open loops: 18 test superati.
- Benchmark sintetico corrente: 9 casi; conferma copertura diagnosi/terapie,
  non risultati clinici.
- Test nuovi: nuovo referto, duplicato, date/unità/range diversi, LOINC assente,
  link unico/ambiguo/assente, deterministico-only, locale/cloud e storico lungo.

Stop rule: non promuovere a persistenza finché la UI esistente non presenta
l’envelope e il clinico non approva esplicitamente ogni candidato e link.
