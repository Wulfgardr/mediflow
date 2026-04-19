# ADR 0014: Native token bootstrap secure-first

Date: 2026-03-17  
Status: Accepted

## Problema

Il client macOS deve risolvere il token locale in modo deterministico e senza
degradazioni silenziose. Il Portachiavi deve avere precedenza assoluta quando
disponibile; se non esiste, sono ammessi config locale e legacy file. Se invece
il Portachiavi esiste ma non e leggibile, il client deve fermarsi con un errore
esplicito e PHI-safe, senza tentare fallback opachi.

## Opzioni

1. Mantenere fallback opportunistici.
2. Accettare solo il Portachiavi.
3. Imporre `Keychain -> config -> legacy` con failure espliciti quando il Portachiavi e presente ma non accessibile.

## Trade-off

- Opzione 1: semplice, ma puo mascherare bootstrap incompleti e creare drift.
- Opzione 2: piu rigida, ma rompe il bootstrap esistente basato su config.
- Opzione 3: preserva compatibilita minima e rende il comportamento deterministico.

## Decisione

Adottiamo l'opzione 3.

- Risoluzione canonica: `Keychain -> config -> legacy`.
- I fallback secondari scattano solo se il token nel Portachiavi non esiste.
- Se il Portachiavi esiste ma non e leggibile (`interactionNotAllowed`, auth failure, cancel o errore OS), il client espone un failure esplicito di bootstrap incompleto.
- `LocalAPIClient` prefligge il bootstrap prima della rete per gli endpoint autenticati.

## First Thin Slice

1. Introdurre un resolver tipizzato con precedence esplicita.
2. Far fallire `LocalAPIClient` prima della rete se il bootstrap token e mancante o incompleto.
3. Aggiornare `SettingsStore` per caricare e refreshare il token dal resolver secure-first.
4. Coprire con XCTest i casi di precedence e failure mode.
