# NAR / Anagrafe regionale: blueprint read-only MediFlow

> Stato documento: `CANONICAL`

Per `NAR / Anagrafe Regionale`, il primo obiettivo plausibile è leggere e
verificare un’informazione senza modificare né replicare l’anagrafe. Questa
nota delimita un intervento iniziale verificabile e in sola lettura; non
autorizza sincronizzazioni anagrafiche, scritture regionali, scraping di Gaia
o una UI dedicata definitiva.

Riferimenti canonici:
- [ARCHITECTURE.md](../ARCHITECTURE.md)
- [SECURITY.md](../SECURITY.md)
- [docs/README.md](./README.md)
- [docs/markdown-index.md](./markdown-index.md)
- [docs/siss-baseline.md](./siss-baseline.md)
- [docs/siss-ssi-a2a-feasibility.md](./siss-ssi-a2a-feasibility.md)
- [docs/siss-fse-docs-corpus.md](./siss-fse-docs-corpus.md)
- [docs/adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md](./adr/0045-siss-native-integration-boundary-requires-qualified-ssi.md)
- [docs/adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md](./adr/0049-siss-fse-document-corpus-and-local-mcp-layer.md)

<a id="executive-summary"></a>

## Esito della ricognizione

Stato della ricognizione: 2 maggio 2026.

Le fonti pubbliche SISS descrivono l’Anagrafe Sanitaria come riferimento
regionale delle basi anagrafiche locali usate da ATS, ASST, IRCCS ed EEPA.
NAR non è quindi un semplice modulo di ricerca: comprende funzioni
amministrative legate a esenzioni e ticket, anagrafica dei prescrittori e
ricettari assegnati. Il catalogo pubblico riporta inoltre manuali e
segnaposto per Gaia, iscrizione degli assistiti e gestione dell’anagrafe dei
medici specialisti.

MediFlow dispone però soltanto del `portal-handoff` verso `Gaia`, con CF
pronto da incollare, non di un canale applicativo in sola lettura. Ne
discendono tre decisioni:

- `same SISS adapter family`: NAR deve restare nel dominio SISS/SSI, con un
  modulo contrattuale separato, perché identità, posizione assistenziale e
  ricettari hanno modalità di errore proprie.
- `read-only only`: la prima integrazione plausibile deve soltanto leggere e
  verificare, senza scrivere o sincronizzare anagrafiche.
- `handoff-only-for-now`: finché manchino specifiche, credenziali, ambiente e
  percorso di qualifica, MediFlow deve limitarsi all’apertura di `Gaia`.

## Fonti ufficiali rilevanti

| Fonte | Lettura operativa |
| --- | --- |
| [Anagrafe Regionale degli assistiti e delle strutture](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/principali-servizi-offerti/anagrafe-regionale-degli-assistiti-e-delle-strutture) | NAR è il riferimento delle basi dati anagrafiche locali, include esenzioni/ticket, medici prescrittori e ricettari assegnati. |
| [Modello Architetturale SISS](https://www.siss.regione.lombardia.it/wps/portal/site/siss/il-sistema-informativo-socio-sanitario/piattaforma-siss/Modello-architetturale) | Il SISS distingue fruizione A2A, Web Application e componenti di sicurezza come Porta Delegata/Applicativa; il solo modello non basta a provare un servizio NAR consumabile da MediFlow. |
| [FAQ SISS su esenzioni / Identifica Cittadino](https://www.siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/faq.do?voce=28685767) | Le FAQ citano servizi come `Identifica Cittadino` e `Classe di Esenzione`, utili come indizi di capability applicative ma non come specifica completa. |
| [Documentazione SISS - Gestione Anagrafe / iscrizione Assistiti](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=21) | Il catalogo pubblico indicizza manuali Gaia/gestione assistiti, da acquisire come `manual-import` prima di progettare un contratto. |
| [Documentazione SISS - GAMS Gestione Anagrafe Medici Specialisti](https://siss.regione.lombardia.it/EdmaSissPortaleSitoWebPublic/documentoDiProgetto.do?ACT=1&PR=10) | Il catalogo pubblico indicizza il dominio medici specialisti/prescrittori, rilevante per contesto prescrittivo ma non sufficiente a un runtime. |

<a id="capability-matrix"></a>

## Funzioni documentate e limiti

| Capability | Stato | Dati minimi ammessi | Note |
| --- | --- | --- | --- |
| Lookup assistito per CF | `candidate-read-only` | esito match, CF normalizzato, eventuale identificatore regionale opaco, timestamp fonte | Nessuna fusione automatica con la scheda paziente; solo verifica preliminare da rivedere. |
| Verifica posizione / eligibility | `candidate-read-only` | stato assistito sintetico, ATS/ambito se previsto, codice della motivazione con identificativi oscurati | Serve specifica ufficiale: evitare interpretazioni cliniche o amministrative non documentate. |
| Esenzioni / classe di esenzione | `candidate-read-only` | codici esenzione necessari al flusso prescrittivo, validità se prevista | Il catalogo locale delle esenzioni è già disponibile; NAR non deve diventare una sincronizzazione massiva. |
| Medico prescrittore | `metadata-only` | identificatore prescrittore, ruolo/contesto, stato abilitazione se previsto | Utile per readiness prescrittiva, non per gestione anagrafica del medico. |
| Ricettari assegnati | `metadata-only` | presenza/validita contesto ricettario, non elenco completo salvo specifica | Il dato è operativo e sensibile: non salvarlo come inventario locale permanente. |
| Scrittura anagrafica, scelta/revoca, gestione specialisti | `out-of-scope` | nessuno | Resta dentro Gaia/SISS o in futuri scenari autorizzati; MediFlow non deve scrivere su NAR. |
| Cache o replica anagrafe regionale | `blocked` | nessuno | Incompatibile con minimizzazione e local-first prudente senza contratto esplicito. |

<a id="contract-locale-proposto"></a>

## Contratto locale proposto

Il primo contratto deve restare interno e in sola lettura. La struttura
seguente è indicativa: descrive richiesta ed esiti, non un servizio NAR già
collegato.

```ts
type NarReadOnlyLookupRequest = {
  fiscalCode: string;
  purpose: 'prescription-readiness' | 'registry-context';
  operatorContext: 'current-siss-session';
  correlationId: string;
};

type NarReadOnlyLookupResult =
  | { status: 'not-configured'; reason: string }
  | { status: 'unauthorized'; reason: string }
  | { status: 'unavailable'; reason: string; retryable: boolean }
  | { status: 'not-found'; source: 'nar' }
  | { status: 'ambiguous'; source: 'nar'; candidates: number }
  | {
      status: 'verified';
      source: 'nar';
      verifiedAt: string;
      patient: {
        fiscalCode: string;
        registryId?: string;
      };
      eligibility?: {
        status: 'active' | 'inactive' | 'unknown';
        reasonCode?: string;
      };
      exemptions?: Array<{
        code: string;
        validUntil?: string;
      }>;
      prescriberContext?: {
        role: string;
        recipeBookStatus?: 'present' | 'missing' | 'unknown';
      };
    };
```

Il contratto non consente di salvare automaticamente dati NAR nella scheda
paziente. Nei test e nelle fixture non devono entrare dati anagrafici reali;
l’audit locale deve contenere soltanto identificativo di correlazione,
azione, esito, modulo e codice della motivazione con identificativi oscurati.
UI e persistenza restano interventi successivi e separati, da affrontare
dopo contratto e specifiche.

<a id="failure-taxonomy"></a>

## Classificazione degli errori

| Codice | Significato | Comportamento MediFlow |
| --- | --- | --- |
| `not-configured` | Mancano credenziali/canale NAR | Mostrare handoff Gaia, nessun retry automatico. |
| `unauthorized` | Ruolo, sessione o operatore non autorizzati | Restare nel percorso ufficiale SISS. |
| `not-found` | CF non risolto su NAR | Non creare/modificare paziente; chiedere review operatore. |
| `ambiguous` | Più posizioni o identità non univoca | Bloccare automazioni e rimandare a Gaia. |
| `unavailable` | Servizio o rete non disponibili | Degradare a handoff, registrando solo evento PHI-safe. |
| `schema-drift` | Risposta non conforme al contratto atteso | Interrompere senza aggirare il controllo; aprire un approfondimento tecnico. |

<a id="adapter-recommendation"></a>

## Scelta dell’adapter

L’accesso NAR deve usare la stessa famiglia di adapter SISS, così da
condividere autenticazione, sessione operatore, audit e confine `SSI`, senza
aprire un secondo canale regionale non governato. Deve però mantenere un
modulo `registry/nar` distinto per contratto, classificazione degli errori e
test sintetici.

Il punto di ingresso proposto è dunque
`sissAdapter.registry.readOnlyLookup(...)`, non un’area runtime separata da
SISS.

<a id="prima-thin-slice-raccomandata"></a>

## Primo intervento raccomandato

`NAR read-only contract fixture`

Il primo intervento parte dall’importazione autorizzata, fuori Git, dei
manuali Gaia/NAR pertinenti. Su questa base costruisce il contratto
TypeScript interno e le fixture sintetiche, verificando la classificazione
degli errori e la minimizzazione dell’audit. Non comprende chiamate reali a
SISS, una UI definitiva o scritture sul paziente.

Per completarlo servono:

1. Fonti NAR tracciate nel manifest del corpus.
2. Contratto di sola lettura revisionato rispetto alle specifiche ufficiali.
3. Classificazione degli errori coperta da test sintetici.
4. Decisione esplicita prima di qualunque runtime NAR reale.

## Decisione operativa

Il percorso disponibile resta `portal-handoff Gaia`; il primo intervento
tecnico proposto è `NAR read-only contract fixture`.

Restano esclusi sincronizzazione locale dell’anagrafe regionale, scritture
verso scelta/revoca o gestione assistiti e inventario locale dei ricettari.
Una UI NAR dedicata non deve precedere specifiche, qualifica e test ufficiale.
