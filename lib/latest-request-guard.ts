export interface LatestRequestGuard {
    issue(): number;
    isLatest(requestId: number): boolean;
    discard(): number;
}

export function createLatestRequestGuard(): LatestRequestGuard {
    let latestRequestId = 0;

    return {
        issue() {
            latestRequestId += 1;
            return latestRequestId;
        },
        isLatest(requestId: number) {
            return requestId === latestRequestId;
        },
        discard() {
            latestRequestId += 1;
            return latestRequestId;
        },
    };
}
