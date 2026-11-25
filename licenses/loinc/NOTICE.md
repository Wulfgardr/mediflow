# LOINC: attribuzione e licenza

This material contains content from LOINC® (http://loinc.org). LOINC is
copyright © 1995-2026, Regenstrief Institute, Inc. and the Logical Observation
Identifiers Names and Codes (LOINC) Committee and is available at no cost under
the license at https://loinc.org/license/. LOINC® is a registered United States
trademark of Regenstrief Institute, Inc.

Versione usata: LOINC 2.83. [Licenza](https://loinc.org/license/).

La tabella `assets/reference-data/loinc/esami-laboratorio-it.csv` è un
sottoinsieme di 84 codici. Codice, Long Common Name e parti assiali
(componente, proprietà, sistema, scala, metodo) sono riportati senza modifiche,
come letti a novembre 2026 sul server terminologico HL7
(`https://tx.fhir.org/r4/CodeSystem/$lookup?system=http://loinc.org&code=<codice>`,
indicato riga per riga nella colonna `fonte_url`). Sono colonne locali di
MediFlow, non contenuto LOINC: `nome_it`, `sinonimi_it`, `unita_ucum`,
`unita_alternative`, `verifica`, `ambiguita` e `stato`.

L'attribuzione non implica affiliazione o approvazione di MediFlow da parte
del Regenstrief Institute. Il contenuto LOINC non è coperto dalla licenza MIT
di MediFlow.
