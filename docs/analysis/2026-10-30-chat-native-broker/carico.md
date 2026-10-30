# Preparazione della baseline C-L

Il profilo attuale del broker è 1 evento, 2 terapie e 2 misure: non va
presentato come il carico contrattuale 100/30/10. Il benchmark GLiNER sugli
otto casi è diagnostico; i suoi tempi non sono la baseline end-to-end.

| Scenario obbligatorio | Confine da misurare | Stato |
| --- | --- | --- |
| 100 eventi, 30 terapie, 10 documenti | selezione, paginazione, rendering, picco RAM | non implementato nel profilo v1 |
| 10.000 caratteri | riduzione, GLiNER reale, controllo finale | protocollo preparato, run mancanti |
| PDF testuale 10 pagine / 10 MiB | estrazione locale, redazione, consegna | C-6 non collegato |
| PDF scansionato 10 pagine / 10 MiB | OCR locale, redazione, consegna | C-6 non collegato |
| PIN e Touch ID | apertura nativa, conferma, ricezione inline | separare tempo umano e lavoro runtime |

Per ciascuno scenario e host: congelare SHA del candidato, bundle/hash,
versioni, account, cache iniziale e fixture/hash. Almeno 30 run freddi e 30
caldi, warm-up separato. Registrare ogni campione con scenario, modalità,
inizio/fine, esito, timeout, bytes, picco RAM e fasi. Conservare timeout ed
errori nel denominatore; p50/p95/massimo sui campioni completati insieme a
conteggio e motivi dei non completati. Non usare i tempi del reference host
come misura del desktop. Non aumentare la soglia FCP di 300 ms.

Il runner corrente viene chiuso dopo ogni preparazione; non possiede un
percorso neurale caldo persistente. Una futura misura «calda» deve dire se
misura cache OS/modello o riuso del processo. I budget dopo baseline
richiedono la decisione prevista dal contratto, senza rinnovi automatici.
