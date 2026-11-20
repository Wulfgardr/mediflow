# Ricevute delle celle I-0

La qualifica di una cella del [registro](registro-0.9.1.json) si calcola con `deriveCellQualification` (`lib/ai-providers/fabric/release-register-qualification.ts`) da ricevute legate per SHA-256. Un valore scritto a mano nel registro che non coincide con il calcolo fa fallire `release-register.test.ts`.

## Criteri per sede

| Sede | Criteri | Fonte nel contratto 0.9.1 |
| --- | --- | --- |
| `local_process` (Ollama) | I-2, arresto della richiesta su annullamento e revoca, C-L, memoria, G-5, C-7 | I-2, C-L, budget D4/I-0, G-5, C-7 |
| `host_subscription` (ChatGPT) | I-4, G-5, C-7 | I-4, G-5, C-7 |

Una ricevuta conta solo se è reale (`method: real`), del piano contrattuale, della stessa revisione e dello stesso profilo del registro (`modelIdentifier`, `osBuild`). Una ricevuta locale deve avere anche lo stesso digest del modello. Le ricevute di I-4 e delle superfici devono essere attestate da Leonardo, e quella di I-4 deve venire dalla sede approvata. Le prove simulate, tecniche, diagnostiche o parziali restano registrate con i motivi, senza effetto sulla qualifica.

## Blocchi

- **Blocchi di criterio.** Sono presenti se e solo se il criterio non è soddisfatto: `I-2_incomplete`, `physical_revocation_not_proved`, `C-L_errors_or_incomplete_distribution`, `memory_not_recorded`, `G-5_surface_not_proved`, `C-7_surface_not_proved`, `I-4`.
- **Limiti di campagne passate.** Restano finché i criteri indicati non sono soddisfatti e non vengono mai aggiunti:
  - `local_only_task`: perimetro locale del censimento del 30/10, si chiude con I-4;
  - `gpu_memory_not_measured`: si chiude con la memoria registrata come descritto sotto;
  - `surfaces_not_verified`: si chiude con G-5 e C-7.
- **Altri blocchi.** Sono veti di prodotto e restano finché un emendamento non li toglie.

C-7 si chiude solo con ricevute valide da entrambi gli host desktop richiesti dal contratto, Claude Desktop (`claude_desktop`) e Codex desktop (`codex_desktop`). Il budget C-L della funzione deve essere il p95 peggiore dei suoi gruppi, misurati e positivi, più il 20% arrotondato per eccesso: un budget che non deriva dalle misure non conta.

Le superfici della cella (`surfaces`) si ricavano dalle stesse ricevute: GPUI da G-5, chat da C-7, Web da I-4 per la sede ChatGPT. Il banco locale usa le API dell'host Web di produzione, non l'interfaccia.

## Memoria

Il contratto chiede di misurare memoria e tempi (I-2) e fissa budget pari alla misura più il 20% (D4, I-0). Non chiede un contatore della sola GPU. La ricevuta locale registra tre grandezze separate, ognuna con la sua fonte:

| Campo | Fonte | Che cosa misura |
| --- | --- | --- |
| `rss` | `ps` ogni 500 ms | RSS di host, client, daemon Ollama e discendenti; il budget RSS è il picco più il 20%. |
| `modelAllocation` | `/api/ps`, campo `size_vram`, ogni 2 s | Allocazione del modello dichiarata dall'Ollama della corsa per il digest misurato. |
| `systemGpu` | `ioreg`, `AGXAccelerator` `PerformanceStatistics`, senza root | Memoria Metal in uso per tutto il sistema; `null` se non leggibile. |

Sul Mac la memoria è unificata: i pesi caricati da MLX possono comparire sia nell'RSS del daemon sia in `size_vram`, e Metal conta ogni processo. Le tre grandezze non si sommano (`summed: false`) e nessuna si presenta come memoria della sola GPU di MediFlow. Il criterio della memoria richiede il budget RSS e `size_vram` registrato durante i campioni. Il 14/11 `size_vram` non era registrato durante i campioni, quindi quel criterio resta non soddisfatto per la misura di quel giorno.

## Storico

`2026-11-14-ollama/registro-storico.json` è il registro com'era pubblicato per la misura del 14/11. La sua impronta del contratto si verifica su `2026-11-14-ollama/contratto-0.9.1-del-registro.txt`, la copia del contratto che attestava, così lo storico resta valido quando il contratto cambia. `2026-11-14-ollama/ricevuta-celle.json` è ricavata da `measurements.json` e `i2-interventions.json`, di cui porta gli hash. Ricalcolata sulla revisione del 14/11, la ricevuta lascia le sei celle non qualificate. Spiega inoltre ogni blocco scritto allora.

L'arresto della richiesta misurato il 14/11 riguarda la revisione `bfddf87a5` e precede la #1039. Il criterio si valuta sulla ricevuta della revisione misurata.
