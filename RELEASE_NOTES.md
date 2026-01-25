# 🧠 MediFlow v0.2.0 — "Brain Transplant" Release Notes

> **⚠️ ATTENZIONE: BREAKING CHANGE CRITICO**
> Questa versione rappresenta una riscrittura completa ("Brain Transplant") del core dell'applicazione.
> **L'aggiornamento COMPORTA LA PERDITA TOTALE dei dati salvati nelle versioni precedenti (v0.1.x basate su Dexie.js).**

---

## 🏗️ Il Cambio di Paradigma: Perché un "Brain Transplant"?

Nelle prime versioni, MediFlow operava come una semplice Web App confinata nel browser (IndexedDB). Sebbene funzionale, questo approccio limitava fortemente le capacità di evoluzione, sicurezza e integrazione con l'AI.

Abbiamo deciso di **ricostruire le fondamenta** passando da un'architettura puramente browser-based a una **Architettura Ibrida (Native + Docker)**.

### Cosa è cambiato?

| Caratteristica | v0.1.x (Vecchio Cervello) | v0.2.0 (Nuovo Cervello) |
|---|---|---|
| **Storage Dati** | `Dexie.js` (IndexedDB nel Browser) | **SQLite + Drizzle ORM** (File locale su disco) |
| **Persistenza** | Volatile (dipende dalla cache browser) | **Robusta** (File `.db` fisico e backuppabile) |
| **Intelligenza Artificiale** | Simulazione / API Mock | **Local LLM Reale** (Ollama/MLX con MedGemma) |
| **Motore Diagnosi** | ICD-9 statico (JSON) | **ICD-11 Ufficiale WHO** (Docker Container) |
| **Performance** | Limitate dal thread JS | **Multiprocesso** (Node.js + Python + Go) |

---

## 💾 La Questione Dati: Perché abbiamo ricominciato da zero?

La decisione di abbandonare i dati vecchi non è stata presa alla leggera. Il passaggio a **SQLite** criptato ("Zero-Knowledge") ha reso tecnicamente impossibile la migrazione sicura dei vecchi dati IndexedDB per tre motivi:

1. **Schema Rigido vs NoSQL**: Siamo passati da documenti JSON liberi a uno schema relazionale rigoroso per garantire l'integrità clinica.
2. **Crittografia at-Rest**: Il nuovo sistema cifra i dati *prima* che tocchino il disco. I vecchi dati erano in chiaro o usavano metodi di offuscamento deboli non compatibili con i nuovi standard AES-256-GCM.
3. **Integrità Referenziale**: Il nuovo DB impone relazioni strette tra Pazienti, Visite e Terapie che i vecchi dati, spesso incompleti, non avrebbero soddisfatto, rischiando di creare un database "corrotto" in partenza.

> *Abbiamo scelto la stabilità futura a discapito della compatibilità passata.*

---

## 🛠️ Nuovi Strumenti di Diagnostica

Con la maggiore complessità (3 motori che girano in parallelo: App, AI, ICD), "funziona tutto?" non è più una domanda da Sì/No.
Abbiamo introdotto una **Dashboard Diagnostica** nelle Impostazioni per darti il controllo totale:

* **🚦 Semàfori di Sistema**: Monitoraggio in tempo reale dello stato di Next.js, Ollama e Docker ICD.
* **🧠 AI Brain Monitor**: Visualizza quale modello è caricato in memoria e quanta VRAM sta usando.
* **🔗 Connectivity Check**: Verifica che le porte 3000, 11434 e 8888 siano aperte e comunicanti.
* **🔥 Self-Healing**: Script automatici che tentano di riavviare i servizi docker o i processi python se rilevano un crash.

---

## ✨ Altre Novità

* **ICD-11 Ufficiale**: Integrazione certificata con l'API dell'OMS per la codifica diagnosi.
* **Supporto Apple Silicon Nativo**: Su Mac M1/M2/M3, l'AI usa direttamente la GPU Metal (tramite MLX) invece di passare per layer di emulazione, garantendo risposte immediate.
* **Data Seeding Intelligente**: Generatore di pazienti finti verosimili per testare l'app al massimo carico.

---

*Consulta il file `docs/architecture_preview.html` incluso nella documentazione per esplorare visivamente i nuovi flussi di dati e sicurezza.*
