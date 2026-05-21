# SISS Live Inspections Private Evidence

Private evidence pack for browser-observed SISS prescribing flows. This folder is
part of `mediflow_private` only and is not intended for OSS export.

## Scope

The pack preserves high-fidelity process evidence from authenticated, operator-led
SISS sessions so MediFlow can model the prescrittivo workflow without pretending
to own the regional authority boundary.

Current contents:

- [2026-05-20-siss-prescription-live-map.md](./2026-05-20-siss-prescription-live-map.md): full technical/process map from the live prescrittivo inspection.
- [derived/2026-05-20-jsonbroker-ledger.tsv](./derived/2026-05-20-jsonbroker-ledger.tsv): normalized request/response ledger for the observed `jsonBroker` and PDF calls.
- [mock-siss-prescription-webapp.html](./mock-siss-prescription-webapp.html): browser-renderable MediFlow web mock for a patient-free prescrittivo workspace.
- [assets/2026-05-20-mediflow-web-mock-prescrittivo-empty.jpg](./assets/2026-05-20-mediflow-web-mock-prescrittivo-empty.jpg): screenshot captured from the internal browser against the local mock.
- [2026-05-20-presentation-brief.md](./2026-05-20-presentation-brief.md): presentation positioning and web-only storyboard for the latest SISS prescribing evidence.

Related private operational archive:

- [../linear-backlog/2026-05-20-mediflow-linear-legacy-snapshot.md](../linear-backlog/2026-05-20-mediflow-linear-legacy-snapshot.md): local snapshot of older Linear items before backlog cleanup.

## Boundary

This folder may contain original regional identifiers and self-test prescription
metadata when they are necessary to understand the end-to-end process. It must
not contain reusable session secrets, raw cookies, authorization headers, SAML
assertions, passwords, PIN/OTP values, raw browser storage dumps, or unreviewed
HAR exports.

Public documentation should keep the same process understanding in generalized
form, without live identifiers, session artifacts, or operator/patient details.
