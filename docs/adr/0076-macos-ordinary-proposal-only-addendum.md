# Addendum ADR0076 — sole proposte OpenAI ordinarie su Mac

Data: 18 settembre 2026. Stato: candidato locale, non ammissione runtime.
Run: 3f2e6f2ad2e84651b2069c50776bfe16. Decisione da integrare prima del codice.

L'ADR0076 originale è citato dall'indice ma non incluso nella fotografia fornita.
Questo addendum non ne ricostruisce né sostituisce il contenuto.

La deroga mirata consente al solo Mac paired, con sessione operatore autentica e
capability di inferenza correnti, di richiedere i quattro percorsi nominati di
ADR0134 e ricevere una proposta review-only nella funzione di origine.
Smart Import e Document Synthesis non acquisiscono alcun endpoint di apply,
persistenza document-derived, aggiornamento automatico del paziente o writer.
Patient Insight e Treatment Reasoning rimangono anch'essi proposta-only.

L'accesso al contenuto documentale passa dall'Application Service di acquisizione
esistente e dal suo source authority, con soli raccordi di issuer/registry per Mac.
Non cambia la decodifica, non si introduce decrittazione server, non si cambia OCR,
né si aggirano dinieghi preesistenti (per esempio sorgenti cifrate non estraibili
nel percorso host). L'autorità nativa non espone commit di review durevole o OCR.

Consenso, ruolo/capability, selezione, appartenenza all'ambulatorio, revisioni,
redazione, parser, pubblicazione e chiusura restano condizioni congiunte. Le UI
non chiamano writer e non riutilizzano risultati dopo cambio contesto. Nessun
ampliamento riguarda mobile, la UI Web o l'ammissione di dati reali WUL-688.
