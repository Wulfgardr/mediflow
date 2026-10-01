/* Invented data only. No patient/database adapter or runtime authority. */
export type FixtureId = 'demo-a' | 'demo-b';
export const PROFILE = 'mediflow.synthetic.open-loops-disclosure.v1' as const;
export function projectionFor(id: FixtureId) {
    const a = id === 'demo-a';
    return Object.freeze({
        schemaVersion: PROFILE, synthetic: true as const, caseRef: id,
        snapshotRevision: a ? 1 : 2, truncated: false,
        items: Object.freeze([Object.freeze({
            loopRef: 'aipl_' + (a ? 'a' : 'b').repeat(64),
            kind: a ? 'results_pending' as const : 'series_stalled' as const,
            temporalState: a ? 'open' as const : 'overdue' as const,
            openedAt: 1790762400000, dueAt: 1790848800000, revision: a ? 1 : 2,
        })]),
    });
}
export type Projection = ReturnType<typeof projectionFor>;
