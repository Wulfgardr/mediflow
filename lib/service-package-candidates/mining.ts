import { v5 as uuidv5 } from 'uuid';
import { isEncryptedFieldValue, isLockedDataPlaceholder } from '../locked-field-guard';
import {
    CANDIDATE_TEXT_LIMIT,
    candidateLabel,
    DEFAULT_MINING_THRESHOLDS,
    PERSONAL_SERVICE_CANDIDATE_KIND,
    type AssociatedDiagnosisStat,
    type CandidateHistoryDiagnosisInput,
    type CandidateHistoryPrescriptionInput,
    type CandidateHistoryPrescriptionItemInput,
    type CandidateServiceCategory,
    type CandidateServiceItem,
    type CandidateSufficiencyStatus,
    type DeriveRecurringCandidatesInput,
    type MiningThresholds,
    type RecurringServiceCandidateAnalysis,
    type RecurringServiceGroupCandidate,
} from './contract';

const HARD_MAX_GROUP_SIZE = 6;
const HARD_MAX_SERVICES_PER_PRESCRIPTION = 16;
const HARD_MAX_CANDIDATE_SETS_PER_LEVEL = 1000;
const HARD_MAX_RETURNED_CANDIDATES = 100;
const HARD_MAX_DIAGNOSES_PER_CANDIDATE = 10;

type NormalizedDiagnosis = Readonly<{
    key: string;
    code: string;
    system: string;
    description: string;
}>;

type NormalizedPrescription = Readonly<{
    patientId: string;
    serviceKeys: readonly string[];
}>;

type ServiceMetadataAccumulator = {
    codeSystem: string | null;
    serviceCode: string | null;
    category: CandidateServiceCategory | null;
    nameCounts: Map<string, number>;
};

type ObservedGroup = Readonly<{
    keys: readonly string[];
    signature: string;
    prescriptionCount: number;
    patientCount: number;
    prescriptionIndices: readonly number[];
}>;

function cleanReadableText(value: string | null | undefined): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (isLockedDataPlaceholder(trimmed) || isEncryptedFieldValue(trimmed)) return null;
    return trimmed;
}

function normalizeLookupToken(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/gu, '')
        .replace(/\s+/gu, ' ');
}

function resolveThresholds(overrides?: Partial<MiningThresholds>): MiningThresholds {
    const minPrescriptionCount = Math.max(2, Math.floor(overrides?.minPrescriptionCount ?? DEFAULT_MINING_THRESHOLDS.minPrescriptionCount));
    const minPatientCount = Math.max(1, Math.floor(overrides?.minPatientCount ?? DEFAULT_MINING_THRESHOLDS.minPatientCount));
    const minObservationCount = Math.max(2, Math.min(minPrescriptionCount, Math.floor(overrides?.minObservationCount ?? DEFAULT_MINING_THRESHOLDS.minObservationCount)));
    const minGroupSize = Math.max(2, Math.min(HARD_MAX_GROUP_SIZE, Math.floor(overrides?.minGroupSize ?? DEFAULT_MINING_THRESHOLDS.minGroupSize)));
    const maxGroupSize = Math.max(minGroupSize, Math.min(HARD_MAX_GROUP_SIZE, Math.floor(overrides?.maxGroupSize ?? DEFAULT_MINING_THRESHOLDS.maxGroupSize)));
    const maxServicesPerPrescription = Math.max(2, Math.min(HARD_MAX_SERVICES_PER_PRESCRIPTION, Math.floor(overrides?.maxServicesPerPrescription ?? DEFAULT_MINING_THRESHOLDS.maxServicesPerPrescription)));
    const maxCandidateSetsPerLevel = Math.max(20, Math.min(HARD_MAX_CANDIDATE_SETS_PER_LEVEL, Math.floor(overrides?.maxCandidateSetsPerLevel ?? DEFAULT_MINING_THRESHOLDS.maxCandidateSetsPerLevel)));
    const maxReturnedCandidates = Math.max(1, Math.min(HARD_MAX_RETURNED_CANDIDATES, Math.floor(overrides?.maxReturnedCandidates ?? DEFAULT_MINING_THRESHOLDS.maxReturnedCandidates)));
    const maxDiagnosesPerCandidate = Math.max(1, Math.min(HARD_MAX_DIAGNOSES_PER_CANDIDATE, Math.floor(overrides?.maxDiagnosesPerCandidate ?? DEFAULT_MINING_THRESHOLDS.maxDiagnosesPerCandidate)));

    return Object.freeze({
        minPrescriptionCount,
        minPatientCount,
        minObservationCount,
        minGroupSize,
        maxGroupSize,
        maxServicesPerPrescription,
        maxCandidateSetsPerLevel,
        maxReturnedCandidates,
        maxDiagnosesPerCandidate,
    });
}

function normalizeServiceEntry(
    input: {
        codeSystem?: string | null;
        serviceCode?: string | null;
        serviceName?: string | null;
        catalogDisplayName?: string | null;
        category?: CandidateServiceCategory | null;
    },
): {
    key: string;
    codeSystem: string | null;
    serviceCode: string | null;
    serviceName: string;
    category: CandidateServiceCategory | null;
} | null {
    const codeSystem = cleanReadableText(input.codeSystem);
    const serviceCode = cleanReadableText(input.serviceCode);
    const catalogDisplayName = cleanReadableText(input.catalogDisplayName);
    const serviceName = catalogDisplayName ?? cleanReadableText(input.serviceName);
    const displayName = serviceName ?? serviceCode;
    if (!displayName) return null;

    if ((codeSystem?.length ?? 0) > CANDIDATE_TEXT_LIMIT || (serviceCode?.length ?? 0) > CANDIDATE_TEXT_LIMIT) return null;
    const prefix = serviceCode ? 'code' : 'name';
    const parts = serviceCode ? [normalizeLookupToken(codeSystem ?? 'unspecified'), normalizeLookupToken(serviceCode)] : [normalizeLookupToken(displayName)];
    const readable = [prefix, ...parts].join(':');
    const key = readable.length <= CANDIDATE_TEXT_LIMIT && !parts.some(part => /[:|]/u.test(part))
        ? readable : `service:${uuidv5(JSON.stringify([prefix, ...parts]), uuidv5.URL)}`;

    return {
        key,
        codeSystem,
        serviceCode,
        serviceName: candidateLabel(displayName),
        category: input.category ?? null,
    };
}

function normalizePatientDiagnoses(diagnoses: readonly CandidateHistoryDiagnosisInput[] | null | undefined): readonly NormalizedDiagnosis[] {
    if (!Array.isArray(diagnoses) || diagnoses.length === 0) return [];
    const seen = new Map<string, NormalizedDiagnosis>();
    for (const diagnosis of diagnoses) {
        const code = cleanReadableText(diagnosis?.code);
        const description = cleanReadableText(diagnosis?.description);
        if (!code && !description) continue;
        const system = cleanReadableText(diagnosis?.system) ?? 'ICD-11';
        const resolvedCode = code ?? normalizeLookupToken(description ?? '');
        if (system.length > CANDIDATE_TEXT_LIMIT || resolvedCode.length > CANDIDATE_TEXT_LIMIT) continue;
        const resolvedDescription = candidateLabel(description ?? resolvedCode);
        const key = `${normalizeLookupToken(system)}:${normalizeLookupToken(resolvedCode)}`;
        if (!seen.has(key)) {
            seen.set(key, {
                key,
                code: resolvedCode,
                system,
                description: resolvedDescription,
            });
        }
    }
    return [...seen.values()];
}

function buildSignature(sortedKeys: readonly string[]): string {
    const signature = sortedKeys.join('|');
    return signature.length <= CANDIDATE_TEXT_LIMIT ? signature : `group:${uuidv5(JSON.stringify(sortedKeys), uuidv5.URL)}`;
}

function isSubset(smaller: readonly string[], larger: readonly string[]): boolean {
    if (smaller.length >= larger.length) return false;
    let i = 0;
    let j = 0;
    while (i < smaller.length && j < larger.length) {
        const cmp = smaller[i].localeCompare(larger[j]);
        if (cmp === 0) {
            i += 1;
            j += 1;
        } else if (cmp > 0) {
            j += 1;
        } else {
            return false;
        }
    }
    return i === smaller.length;
}

function buildCandidateServiceItem(key: string, meta: ServiceMetadataAccumulator): CandidateServiceItem {
    let bestName = meta.serviceCode ?? key;
    let bestCount = -1;
    for (const [name, count] of meta.nameCounts.entries()) {
        if (count > bestCount || (count === bestCount && name.localeCompare(bestName) < 0)) {
            bestName = name;
            bestCount = count;
        }
    }
    return {
        key,
        codeSystem: meta.codeSystem,
        serviceCode: meta.serviceCode,
        serviceName: bestName,
        category: meta.category,
    };
}

function compareKeyArrays(a: readonly string[], b: readonly string[]): number {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i += 1) {
        const cmp = a[i].localeCompare(b[i]);
        if (cmp !== 0) return cmp;
    }
    return a.length - b.length;
}

class BoundedTopK<T> {
    private readonly heap: T[] = [];
    private wasCapped = false;

    constructor(
        private readonly maxSize: number,
        private readonly isBetter: (candidate: T, reference: T) => boolean,
    ) {}

    get capped(): boolean {
        return this.wasCapped;
    }

    isFull(): boolean {
        return this.heap.length >= this.maxSize;
    }

    peekWorst(): T | undefined {
        return this.heap[0];
    }

    push(item: T): void {
        if (this.maxSize <= 0) {
            this.wasCapped = true;
            return;
        }
        if (this.heap.length < this.maxSize) {
            this.heap.push(item);
            this.siftUp(this.heap.length - 1);
            return;
        }
        this.wasCapped = true;
        if (this.isBetter(item, this.heap[0])) {
            this.heap[0] = item;
            this.siftDown(0);
        }
    }

    toSortedArray(): T[] {
        return [...this.heap].sort((a, b) => (this.isBetter(a, b) ? -1 : this.isBetter(b, a) ? 1 : 0));
    }

    private isWorse(a: T, b: T): boolean {
        return this.isBetter(b, a);
    }

    private siftUp(startIndex: number): void {
        let index = startIndex;
        while (index > 0) {
            const parent = (index - 1) >> 1;
            if (!this.isWorse(this.heap[index], this.heap[parent])) break;
            const temp = this.heap[parent];
            this.heap[parent] = this.heap[index];
            this.heap[index] = temp;
            index = parent;
        }
    }

    private siftDown(startIndex: number): void {
        let index = startIndex;
        const length = this.heap.length;
        while (true) {
            const left = index * 2 + 1;
            const right = left + 1;
            let worst = index;
            if (left < length && this.isWorse(this.heap[left], this.heap[worst])) {
                worst = left;
            }
            if (right < length && this.isWorse(this.heap[right], this.heap[worst])) {
                worst = right;
            }
            if (worst === index) break;
            const temp = this.heap[index];
            this.heap[index] = this.heap[worst];
            this.heap[worst] = temp;
            index = worst;
        }
    }
}

function collectObservedPairs(
    eligiblePrescriptions: readonly NormalizedPrescription[],
    levelOne: readonly ObservedGroup[],
    postingLists: ReadonlyMap<string, readonly number[]>,
    thresholds: MiningThresholds,
): { groups: ObservedGroup[]; capped: boolean } {
    const frequentKeys = levelOne
        .map((group) => group.keys[0])
        .sort((a, b) => a.localeCompare(b));
    const numKeys = frequentKeys.length;
    if (numKeys < 2) {
        return { groups: [], capped: false };
    }

    const keyToId = new Map<string, number>();
    for (let i = 0; i < numKeys; i += 1) {
        keyToId.set(frequentKeys[i], i);
    }

    const topPairs = new BoundedTopK<{ idA: number; idB: number; count: number }>(
        thresholds.maxCandidateSetsPerLevel,
        (a, b) =>
            a.count !== b.count
                ? a.count > b.count
                : a.idA !== b.idA
                    ? a.idA < b.idA
                    : a.idB < b.idB,
    );

    for (const [idA, key] of frequentKeys.entries()) {
        const counts = new Map<number, number>();
        for (const index of postingLists.get(key) ?? []) {
            for (const other of eligiblePrescriptions[index].serviceKeys) {
                const idB = keyToId.get(other);
                if (idB !== undefined && idB > idA) counts.set(idB, (counts.get(idB) ?? 0) + 1);
            }
        }
        for (const [idB, count] of counts) {
            if (count >= thresholds.minObservationCount) topPairs.push({ idA, idB, count });
        }
    }

    const groups: ObservedGroup[] = [];
    for (const entry of topPairs.toSortedArray()) {
        const keyA = frequentKeys[entry.idA];
        const keyB = frequentKeys[entry.idB];
        const intersection = intersectSortedIndices(
            postingLists.get(keyA) ?? [],
            postingLists.get(keyB) ?? [],
        );
        if (intersection.length < thresholds.minObservationCount) continue;
        const keys = [keyA, keyB];
        groups.push({
            keys,
            signature: buildSignature(keys),
            prescriptionCount: intersection.length,
            patientCount: countDistinctPatients(intersection, eligiblePrescriptions),
            prescriptionIndices: intersection,
        });
    }

    return {
        groups,
        capped: topPairs.capped,
    };
}

function generateNextLevelCandidates(
    previousLevel: readonly ObservedGroup[],
    levelSize: number,
    maxCandidates: number,
): { candidates: readonly (readonly string[])[]; capped: boolean } {
    const previousSignatures = new Set(previousLevel.map((group) => group.signature));
    const sortedPrev = [...previousLevel].sort((a, b) => compareKeyArrays(a.keys, b.keys));
    const topCandidates = new BoundedTopK<{ keys: readonly string[]; score: number }>(
        maxCandidates,
        (a, b) => (a.score !== b.score ? a.score > b.score : compareKeyArrays(a.keys, b.keys) < 0),
    );

    for (let i = 0; i < sortedPrev.length; i += 1) {
        const left = sortedPrev[i];
        for (let j = i + 1; j < sortedPrev.length; j += 1) {
            const right = sortedPrev[j];
            let samePrefix = true;
            for (let p = 0; p < levelSize - 2; p += 1) {
                if (left.keys[p] !== right.keys[p]) {
                    samePrefix = false;
                    break;
                }
            }
            if (!samePrefix) break;

            const score = Math.min(left.prescriptionCount, right.prescriptionCount);
            const worst = topCandidates.peekWorst();
            if (topCandidates.isFull() && topCandidates.capped && worst && score < worst.score) {
                continue;
            }

            const merged = [...left.keys, right.keys[levelSize - 2]];

            let allSubsetsFrequent = true;
            for (let drop = 0; drop < levelSize - 2; drop += 1) {
                const subset = merged.filter((_, index) => index !== drop);
                if (!previousSignatures.has(buildSignature(subset))) {
                    allSubsetsFrequent = false;
                    break;
                }
            }
            if (!allSubsetsFrequent) continue;

            topCandidates.push({
                keys: merged,
                score,
            });
        }
    }

    return {
        candidates: topCandidates.toSortedArray().map((entry) => entry.keys),
        capped: topCandidates.capped,
    };
}

function intersectSortedIndices(a: readonly number[], b: readonly number[]): number[] {
    const result: number[] = [];
    let i = 0;
    let j = 0;
    while (i < a.length && j < b.length) {
        if (a[i] === b[j]) {
            result.push(a[i]);
            i += 1;
            j += 1;
        } else if (a[i] < b[j]) {
            i += 1;
        } else {
            j += 1;
        }
    }
    return result;
}

function countDistinctPatients(
    indices: readonly number[],
    prescriptions: readonly NormalizedPrescription[],
): number {
    const patientIds = new Set<string>();
    for (const index of indices) {
        patientIds.add(prescriptions[index].patientId);
    }
    return patientIds.size;
}

function computeAssociatedDiagnoses(
    indices: readonly number[],
    prescriptions: readonly NormalizedPrescription[],
    diagnosesByPatient: ReadonlyMap<string, readonly NormalizedDiagnosis[]>,
    maxDiagnoses: number,
): readonly AssociatedDiagnosisStat[] {
    const stats = new Map<string, { diagnosis: NormalizedDiagnosis; prescriptionCount: number; patientIds: Set<string> }>();
    for (const index of indices) {
        const patientId = prescriptions[index].patientId;
        const patientDiagnoses = diagnosesByPatient.get(patientId);
        if (!patientDiagnoses || patientDiagnoses.length === 0) continue;
        for (const diagnosis of patientDiagnoses) {
            const entry = stats.get(diagnosis.key) ?? {
                diagnosis,
                prescriptionCount: 0,
                patientIds: new Set<string>(),
            };
            entry.prescriptionCount += 1;
            entry.patientIds.add(patientId);
            stats.set(diagnosis.key, entry);
        }
    }

    return [...stats.values()]
        .map((entry): AssociatedDiagnosisStat => ({
            code: entry.diagnosis.code,
            system: entry.diagnosis.system,
            description: entry.diagnosis.description,
            prescriptionCount: entry.prescriptionCount,
            patientCount: entry.patientIds.size,
        }))
        .sort(
            (a, b) =>
                b.prescriptionCount - a.prescriptionCount
                || b.patientCount - a.patientCount
                || a.code.localeCompare(b.code),
        )
        .slice(0, maxDiagnoses);
}

function classifySufficiency(
    prescriptionCount: number,
    patientCount: number,
    thresholds: MiningThresholds,
): CandidateSufficiencyStatus {
    if (prescriptionCount < thresholds.minPrescriptionCount) return 'insufficient_prescriptions';
    if (patientCount < thresholds.minPatientCount) return 'insufficient_patients';
    return 'sufficient';
}

function sortCandidates(a: RecurringServiceGroupCandidate, b: RecurringServiceGroupCandidate): number {
    return (
        b.prescriptionCount - a.prescriptionCount
        || b.patientCount - a.patientCount
        || b.services.length - a.services.length
        || a.signature.localeCompare(b.signature)
    );
}

function collectPrescriptionServices(
    prescription: CandidateHistoryPrescriptionInput,
    childItems: readonly CandidateHistoryPrescriptionItemInput[],
): ReturnType<typeof normalizeServiceEntry>[] {
    if (childItems.length > 0) {
        return childItems
            .filter((item) => item.status !== 'cancelled')
            .map((item) => normalizeServiceEntry({
                codeSystem: item.codeSystem,
                serviceCode: item.serviceCode,
                serviceName: item.serviceName,
                catalogDisplayName: item.catalogDisplayName,
                category: item.category ?? prescription.category,
            }));
    }
    return [normalizeServiceEntry({
        codeSystem: prescription.codeSystem,
        serviceCode: prescription.serviceCode,
        serviceName: prescription.serviceName,
        category: prescription.category,
    })];
}

export function deriveRecurringServiceCandidates(
    input: DeriveRecurringCandidatesInput,
): RecurringServiceCandidateAnalysis {
    const thresholds = resolveThresholds(input.thresholds);

    const activePatientIds = new Set<string>();
    const diagnosesByPatient = new Map<string, readonly NormalizedDiagnosis[]>();
    for (const patient of input.patients) {
        if (patient.deletedAt) continue;
        activePatientIds.add(patient.id);
        diagnosesByPatient.set(patient.id, normalizePatientDiagnoses(patient.diagnoses));
    }

    const itemsByPrescription = new Map<string, CandidateHistoryPrescriptionItemInput[]>();
    for (const item of input.items) {
        const bucket = itemsByPrescription.get(item.prescriptionId) ?? [];
        bucket.push(item);
        itemsByPrescription.set(item.prescriptionId, bucket);
    }

    const serviceMetadata = new Map<string, ServiceMetadataAccumulator>();
    const eligiblePrescriptions: NormalizedPrescription[] = [];
    const distinctPatients = new Set<string>();
    let totalPrescriptionsScanned = 0;
    let cancelledPrescriptionsExcluded = 0;
    let truncatedPrescriptions = 0;

    for (const prescription of input.prescriptions) {
        if (!activePatientIds.has(prescription.patientId)) continue;
        if (prescription.status === 'cancelled') {
            cancelledPrescriptionsExcluded += 1;
            continue;
        }
        totalPrescriptionsScanned += 1;
        distinctPatients.add(prescription.patientId);

        const rawServices = collectPrescriptionServices(
            prescription,
            itemsByPrescription.get(prescription.id) ?? [],
        );
        const deduped = new Map<string, NonNullable<ReturnType<typeof normalizeServiceEntry>>>();
        for (const service of rawServices) {
            if (!service) continue;
            if (!deduped.has(service.key)) deduped.set(service.key, service);
        }

        const sortedKeys = [...deduped.keys()].sort((a, b) => a.localeCompare(b));
        let boundedKeys = sortedKeys;
        if (sortedKeys.length > thresholds.maxServicesPerPrescription) {
            boundedKeys = sortedKeys.slice(0, thresholds.maxServicesPerPrescription);
            truncatedPrescriptions += 1;
        }

        for (const key of boundedKeys) {
            const service = deduped.get(key)!;
            const meta = serviceMetadata.get(key) ?? {
                codeSystem: service.codeSystem,
                serviceCode: service.serviceCode,
                category: service.category,
                nameCounts: new Map<string, number>(),
            };
            if (!meta.codeSystem && service.codeSystem) meta.codeSystem = service.codeSystem;
            if (!meta.serviceCode && service.serviceCode) meta.serviceCode = service.serviceCode;
            if (!meta.category && service.category) meta.category = service.category;
            meta.nameCounts.set(service.serviceName, (meta.nameCounts.get(service.serviceName) ?? 0) + 1);
            serviceMetadata.set(key, meta);
        }

        if (boundedKeys.length >= thresholds.minGroupSize) {
            eligiblePrescriptions.push({
                patientId: prescription.patientId,
                serviceKeys: boundedKeys,
            });
        }
    }

    if (totalPrescriptionsScanned === 0) {
        return {
            kind: PERSONAL_SERVICE_CANDIDATE_KIND,
            status: 'empty_history',
            thresholds,
            summary: {
                totalPrescriptionsScanned: 0,
                eligiblePrescriptions: 0,
                distinctPatients: 0,
                cancelledPrescriptionsExcluded,
                truncatedPrescriptions: 0,
                candidatePoolCapped: false,
            },
            candidates: [],
            insufficientCandidates: [],
        };
    }

    const postingLists = new Map<string, number[]>();
    eligiblePrescriptions.forEach((prescription, index) => {
        for (const key of prescription.serviceKeys) {
            const list = postingLists.get(key) ?? [];
            list.push(index);
            postingLists.set(key, list);
        }
    });

    const levelOne: ObservedGroup[] = [];
    for (const [key, indices] of postingLists.entries()) {
        if (indices.length < thresholds.minObservationCount) continue;
        levelOne.push({
            keys: [key],
            signature: key,
            prescriptionCount: indices.length,
            patientCount: countDistinctPatients(indices, eligiblePrescriptions),
            prescriptionIndices: indices,
        });
    }

    let currentLevel: ObservedGroup[] = [];
    let candidatePoolCapped = false;
    const allObservedGroups: ObservedGroup[] = [];

    if (levelOne.length >= 2 && thresholds.maxGroupSize >= 2) {
        const levelTwo = collectObservedPairs(
            eligiblePrescriptions,
            levelOne,
            postingLists,
            thresholds,
        );
        if (levelTwo.capped) candidatePoolCapped = true;
        currentLevel = levelTwo.groups;
        if (2 >= thresholds.minGroupSize) {
            allObservedGroups.push(...levelTwo.groups);
        }
    }

    for (let size = 3; size <= thresholds.maxGroupSize; size += 1) {
        if (currentLevel.length < 2) break;
        const { candidates: nextKeySets, capped } = generateNextLevelCandidates(
            currentLevel,
            size,
            thresholds.maxCandidateSetsPerLevel,
        );
        if (capped) candidatePoolCapped = true;

        const nextLevel: ObservedGroup[] = [];
        for (const keys of nextKeySets) {
            let intersection = postingLists.get(keys[0]) ?? [];
            for (let k = 1; k < keys.length; k += 1) {
                intersection = intersectSortedIndices(intersection, postingLists.get(keys[k]) ?? []);
                if (intersection.length < thresholds.minObservationCount) break;
            }
            if (intersection.length < thresholds.minObservationCount) continue;

            const group: ObservedGroup = {
                keys,
                signature: buildSignature(keys),
                prescriptionCount: intersection.length,
                patientCount: countDistinctPatients(intersection, eligiblePrescriptions),
                prescriptionIndices: intersection,
            };
            nextLevel.push(group);
            if (size >= thresholds.minGroupSize) {
                allObservedGroups.push(group);
            }
        }
        currentLevel = nextLevel;
    }

    const closedGroups = allObservedGroups.filter((group) =>
        !allObservedGroups.some(
            (other) =>
                other.keys.length > group.keys.length
                && other.prescriptionCount === group.prescriptionCount
                && isSubset(group.keys, other.keys),
        ),
    );

    const sufficient: RecurringServiceGroupCandidate[] = [];
    const insufficient: RecurringServiceGroupCandidate[] = [];

    for (const group of closedGroups) {
        const services = group.keys.map((key) => buildCandidateServiceItem(key, serviceMetadata.get(key)!));
        const diagnoses = computeAssociatedDiagnoses(
            group.prescriptionIndices,
            eligiblePrescriptions,
            diagnosesByPatient,
            thresholds.maxDiagnosesPerCandidate,
        );
        const sufficiency = classifySufficiency(group.prescriptionCount, group.patientCount, thresholds);
        const candidate: RecurringServiceGroupCandidate = {
            kind: PERSONAL_SERVICE_CANDIDATE_KIND,
            id: group.signature,
            signature: group.signature,
            services,
            prescriptionCount: group.prescriptionCount,
            patientCount: group.patientCount,
            diagnoses,
            primaryDiagnosis: diagnoses[0] ?? null,
            sufficiency,
        };
        if (sufficiency === 'sufficient') {
            sufficient.push(candidate);
        } else {
            insufficient.push(candidate);
        }
    }

    sufficient.sort(sortCandidates);
    insufficient.sort(sortCandidates);

    const boundedSufficient = sufficient.slice(0, thresholds.maxReturnedCandidates);
    const boundedInsufficient = insufficient.slice(0, thresholds.maxReturnedCandidates);

    return {
        kind: PERSONAL_SERVICE_CANDIDATE_KIND,
        status: boundedSufficient.length > 0 ? 'ready' : 'insufficient_data',
        thresholds,
        summary: {
            totalPrescriptionsScanned,
            eligiblePrescriptions: eligiblePrescriptions.length,
            distinctPatients: distinctPatients.size,
            cancelledPrescriptionsExcluded,
            truncatedPrescriptions,
            candidatePoolCapped,
        },
        candidates: boundedSufficient,
        insufficientCandidates: boundedInsufficient,
    };
}
