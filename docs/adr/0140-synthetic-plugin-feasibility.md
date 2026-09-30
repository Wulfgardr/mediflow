---
summary: "WUL-756: prototipo plugin con sole fixture inventate, MCP Apps/Extensions isolate e aggiunta esplicita al contesto; nessun accesso clinico."
read_when:
  - "Valutando plugin MediFlow per Codex o le estensioni MCP OpenAI."
  - "Distinguendo fattibilità sintetica, qualifica host e distribuzione."
---

# ADR 0140 — fattibilità del plugin con esempi inventati

Data: 2026-09-30. Stato: proposta implementata per riesame, perimetro WUL-756.
Base verificata: `bf7cd61bd8c779e0b3f28906af8a7923ae7c98fb`.

## Contesto

ADR 0114 e ADR 0117 governano Supervisor locale, processi Web/MCP distinti e
IPC AIP ereditato. Production espone letture e proposte bounded; il commit
checkup rimane nella Web UI trusted. Mini è una superficie CLI separata e non
coincide con l'API Headless. Questi contratti non autorizzano automaticamente
invio di cartelle a un host intelligente.

Main non contieneva manifest o pacchetto plugin. Le nuove
[OpenAI MCP Extensions](https://github.com/openai/mcp-extensions) documentano
ingressi globali e per conversazione e aggiornamento del contesto del modello.
La [spec](https://github.com/openai/mcp-extensions/blob/main/docs/spec.md)
precisa che il supporto Web riguarda Work, escludendo ChatGPT classico, e che
file opening, file viewers e composer mentions hanno limiti per piattaforma.
La [guida SDK](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md)
richiede registrare `ontoolresult` prima della connessione e verificare le
API disponibili dopo l'inizializzazione.

## Decisione

Creare `plugins/mediflow-synthetic` come pacchetto indipendente. Il server
inizializza `OpenAIExtensions` e pubblica due tool con argomenti stretti `{}`,
resource UI incorporata e fallback testuale. La UI usa gli SDK pubblicati;
nessun polyfill o adapter MCP production viene introdotto.

Le versioni pubblicate sono state verificate sul registry npm ufficiale:
extension SDK 0.1.0 dichiara peer MCP SDK `^1.29.0` e MCP Apps `^1.7.5`.
Il prototipo fissa SDK 1.31.0 e Apps 1.7.5; Apps 2.0.3 appartiene a un'altra
generazione. Il runtime production `@modelcontextprotocol/server` 2.0.0
rimane invariato. Le dipendenze del prototipo hanno un lockfile separato.

La fixture di proposta riusa la forma del contratto
`followUpProposalOutputSchema`, verificata direttamente nei test. Nessun
Application Service, broker, authority, grant, credenziale o DB viene importato.
I riferimenti e hash ripetuti sono valori inventati compatibili con lo schema,
non ricevute valide o prova di lineage. Non si concede autorità nuova.

La UI permette una sola scelta tra due testi fissati nel pacchetto. Un gesto
separato mostra destinazione e conseguenza, seguito da conferma o annullamento.
Solo la conferma chiama `modelContext.update`, con il testo inventato scelto;
non trasmette la fixture completa né accetta input libero. Nessun update viene
eseguito durante apertura o selezione. I risultati MCP contengono già i soli
esempi inventati per il fallback. Il codice evita update concorrenti e
ripetizioni dell'ultimo invio confermato durante la stessa apertura.

Una capability assente lascia il testo leggibile e disabilita l'azione.
Risultati non confermati o errori dell'host non vengono presentati come
successi. L'aggiunta al contesto può inviare testo al modello dell'host:
`audience: assistant` non è un confine di privacy e non viene usato per
nascondere tale effetto. Il CSP non abilita domini rete; postMessage resta
un confine di invio verso l'host, non una garanzia di elaborazione offline.

## Packaging e distribuzione

Root `plugin.json`/`mcp.json` adottano i JSON Schema Agent Plugins 1.0.0.
Il manifest `.codex-plugin/plugin.json` e il companion `.mcp.json` conservano
la rappresentazione legacy richiesta; test schema-aware impediscono divergenze
di identità, presentazione e comando server. Non sono presenti apps mappings,
hook, marketplace o impostazioni personali. La skill limita l'uso a esempi
inventati. I dettagli e le prove sono nel [README del pacchetto](../../plugins/mediflow-synthetic/README.md).

Questa slice è sorgente di sviluppo, richiede build e dipendenze esplicite e
non dichiara un installer. Nessun install è stato eseguito sull'account.
Le pagine correnti di [submission](https://developers.openai.com/plugins/deploy/submission),
[packaging](https://developers.openai.com/plugins/build/plugins) e
[conversione Claude](https://developers.openai.com/plugins/guides/submit-claude-plugin)
devono essere valutate separatamente: la prima usa un percorso ZIP-first,
le altre conservano indicazioni di contatto per casi locali. L'ammissibilità
pubblica locale resta non verificata/HOLD, senza tunnel o export clinici.

## Gate e conseguenze

WUL-756 produce evidenza di fattibilità sintetica. Non completa WUL-757,
che dipende da WUL-731, WUL-756 e WUL-590, né i suoi prerequisiti transitivi
WUL-736 e WUL-585/587/588. WUL-758 governa install/update/removal;
WUL-759 governa la directory eventuale. Nessuna dipendenza ODS/FHIR viene aggiunta.

Il workflow CI dedicato verifica build, schemi, fixture, client MCP e UI con
host browser simulato. Non qualifica un host reale, il percorso clinico,
distribuzione, revoca di grant clinici o deployment. PR365 e PR372 rimangono
lane separate, con i loro blocker OCR upstream e nessuna modifica da questa slice.

Una futura integrazione clinica richiede riesame dedicato di confini dati,
identità, autorizzazione, consenso/egress, attivazione/revoca e revisione trusted,
riusando ADR 0114/0117. La disponibilità delle estensioni non basta a superare
quei gate.
