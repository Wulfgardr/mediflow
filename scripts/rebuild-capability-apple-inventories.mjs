/* @Codex */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (path) => JSON.parse(readFileSync(`${ROOT}/${path}`, 'utf8'));
const write = (path, value) => writeFileSync(`${ROOT}/${path}`, `${JSON.stringify(value)}\n`);
const node = (id, sourceKind, identifier, surface, ref, locator) => ({ id, sourceIdentity: { sourceKind, identifier }, description: `Frozen ${surface} symbol`, surface, stage: 'unresolved', authority: 'unresolved', input: 'unresolved', output: 'unresolved', provider: 'unresolved', venue: 'unresolved', egress: 'unresolved', evidence: [{ evidenceKind: 'code', ref, locator, claim: 'directly declared functional entry or SwiftUI symbol' }], terminalDisposition: 'unmapped' });

write('docs/capability-mapping/nodes/ios-ipados-runtime-surfaces.v1.json', {
  schema: 'mediflow.capability-mapping.ios-ipados-runtime-surfaces.v1', sourceRef: '7bb2fe7d6931bdadb42d43c65b747ed1977f5722', status: 'candidate_not_integrated', applyPolicy: 'none', records: [
    node('surface:ios-ipados:app:MediFlowMobileShellApp@7bb2fe7d6931', 'ios_ipados_app_entry', 'MediFlowMobileShellApp', 'ios_ipados_app_entry', '7bb2fe7d6931bdadb42d43c65b747ed1977f5722:native/MediFlowAppleApp/Sources/MediFlowMobileApp/MediFlowMobileShellApp.swift', '@main MediFlowMobileShellApp')
  ]
});
const macRef = '7a8f12c8c94ed2110f4c2a4b8150fd3924cb18c4';
write('docs/capability-mapping/nodes/macos-runtime-surfaces.v1.json', {
  schema: 'mediflow.capability-mapping.macos-runtime-surfaces.v1', sourceRef: macRef, status: 'candidate_not_integrated', applyPolicy: 'none', records: [
    node('surface:macos:app:MediFlowMacShellApp@7a8f12c8c94e', 'macos_app_entry', 'MediFlowMacShellApp', 'macos_app_entry', `${macRef}:native/MediFlowAppleApp/Sources/MediFlowMacApp/MediFlowMacShellApp.swift`, '@main MediFlowMacShellApp'),
    node('surface:macos:view:MediFlowMacRootView@7a8f12c8c94e', 'macos_swiftui_view', 'MediFlowMacRootView', 'macos_swiftui_view', `${macRef}:native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift`, 'MediFlowMacRootView: View'),
    node('surface:macos:commands:MediFlowMacCommands@7a8f12c8c94e', 'macos_commands', 'MediFlowMacCommands', 'macos_commands', `${macRef}:native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/MacWorkspaceRootView.swift`, 'MediFlowMacCommands: Commands'),
    node('surface:macos:view:HomeBaseRuntimeStatusView@7a8f12c8c94e', 'macos_swiftui_view', 'HomeBaseRuntimeStatusView', 'macos_swiftui_view', `${macRef}:native/MediFlowMac/Sources/MediFlowAppleShared/AppleFoundation/HomeBaseRuntimeStatusView.swift`, 'HomeBaseRuntimeStatusView: View')
  ]
});
for (const [output, rosterPath, sourceRef] of [['docs/capability-mapping/nodes/ios-ipados-doc-surfaces.v1.json', 'docs/capability-mapping/sources/ios-ipados-docs.v1.json', '14d23caef5513a61dd10f16afcec41b1381179ef'], ['docs/capability-mapping/nodes/macos-receipt-surfaces.v1.json', 'docs/capability-mapping/sources/macos-boundary-receipt.v1.json', 'fd442fda1fb1cc0f9f30d61b238ae5fdc51b0b18']]) {
  const roster = read(rosterPath);
  write(output, { schema: 'mediflow.capability-mapping.document-evidence.v1', sourceRef, status: 'candidate_not_integrated', applyPolicy: 'none', records: roster.records.map((record) => ({ id: `evidence:${record.path}@${sourceRef.slice(0, 12)}`, evidenceKind: 'document', ref: `${sourceRef}:${record.path}`, gitBlob: record.gitBlob, byteLength: record.byteLength, sha256: record.sha256, claim: 'frozen document evidence only; not a product surface' })) });
}
write('docs/capability-mapping/keyboard-boundary.v1.json', { schema: 'mediflow.capability-mapping.keyboard-boundary.v1', sourceRef: '5fbe5eaa16b6f79eb578644afe0131dd58544238', status: 'candidate_not_integrated', applyPolicy: 'none', terminalDisposition: 'out_of_catalog', reason: 'The frozen file is an end-to-end keyboard test and declares no standalone product route, page, Mini command, or Apple surface.', evidence: [{ evidenceKind: 'test', ref: '5fbe5eaa16b6f79eb578644afe0131dd58544238:e2e/kree8-keyboard.spec.ts', locator: 'keyboard navigation assertions', claim: 'test evidence only; no additional surface is declared' }] });
