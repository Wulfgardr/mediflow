# MediFlow universal Apple app

One universal SwiftUI app for iOS, iPadOS and macOS, sharing the home-base +
`/api/v1` boundary with the web app. Style: Apple Liquid Glass ("Vetro Clinico").
No long dash in this repo's text by convention.

## Layout

- `MediFlowAppleApp/` — the single shippable artifact: an Xcode project generated
  from `project.yml` (xcodegen). Two app targets, same bundle id
  `com.mediflow.mobile` (universal purchase):
  - `MediFlowMobileApp` (iOS/iPadOS, device family 1,2)
  - `MediFlowMacApp` (native macOS)
  Both mount `AppleFoundationMobileRootView` from the shared library.
- `MediFlowMac/` — the SwiftPM package. Library + tests only (no app executables):
  - `Sources/MediFlowAppleShared/` — the shared module: SwiftUI root + view models
    (`AppleFoundation/`), home-base networking / Bonjour / pairing / cache, the
    `VetroClinico` Liquid Glass design kit, and the `/api/v1` contract primitives
    (`APIPatchValue`, `APIVersionConflict`).
  - `Tests/MediFlowAppleSharedTests/` — XCTest suite.

The two former SPM executables (`MediFlowMac`, `MediFlowMobile`) and ~12k lines of
unmounted "rich Mac UI" were removed in Fase 0; see
`docs/analysis/2026-06-28-fase0-decisioni-apple-universale.md`.

## Toolchain

The Liquid Glass code uses `.glassEffect` behind an `iOS 26 / macOS 26`
availability guard, so building needs an Xcode with the 26 (or newer) SDK. The
bare Command Line Tools toolchain lacks XCTest; `scripts/native-test.sh`
auto-selects a full Xcode. Locally, export `DEVELOPER_DIR` if needed:

    export DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer

## Build and test

    # SwiftPM library + tests
    scripts/native-test.sh                      # swift test (auto-selects Xcode)

    # Regenerate the Xcode project + run the guards (structure + entitlements)
    scripts/generate-apple-xcodeproj.sh

    # Build the apps
    xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
      -scheme MediFlowMacApp   -destination 'platform=macOS' build CODE_SIGNING_ALLOWED=NO
    xcodebuild -project native/MediFlowAppleApp/MediFlowAppleApp.xcodeproj \
      -scheme MediFlowMobileApp -destination 'generic/platform=iOS Simulator' build CODE_SIGNING_ALLOWED=NO

CI runs the same in `.github/workflows/apple-native.yml` (path-filtered to
`native/**`). The guards (`scripts/check-apple-structure.sh`,
`scripts/check-apple-network-entitlements.sh`) fail if the retired executables or
dead roots reappear, or if the Bonjour / local-network keys are missing.

## Known limitations (tracked follow-ups)

- The macOS target builds but does not yet bundle the `WebRuntime` (Next.js), so
  on macOS the home-base does not start at runtime (`HomeBaseRuntimeStatusView`
  shows "not ready", it does not crash). Migrating the WebRuntime bundling (logic
  in git history, pre Fase 0) into the `MediFlowMacApp` build phases is pending.
- The `/api/v1/network` live-contract wiring of `PatchValue` / `VersionConflict`
  into `HomeBasePatientsClient` is Fase 1 work that needs the backend running to
  verify round-trips.
