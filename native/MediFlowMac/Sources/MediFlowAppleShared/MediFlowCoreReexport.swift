// ADR 0071 Fase 1 compatibility shim: MediFlowCore was split out of
// MediFlowAppleShared. Re-export it so existing consumers of MediFlowAppleShared
// (the universal Xcode app) keep seeing the core's public symbols (e.g.
// CryptoService) without code changes while the module split proceeds.
@_exported import MediFlowCore
