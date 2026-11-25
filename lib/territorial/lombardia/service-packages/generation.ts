import {
    territorialPackActive,
    type TerritorialPackCapability,
} from '../../../territorial-pack-contract';
import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    isValidIsoCalendarDate,
    servicePackageSourceKey,
    type ApprovedServicePackage,
    type ComplicationModule,
    type ExemptionApplicationStatus,
    type GeneratedServiceRequest,
    type LombardiaReferenceCatalog,
    type PatientServiceHistoryEntry,
    type ServicePackage,
    type ServicePackageItem,
    type SkippedServiceItem,
} from './contract';
import {
    validateServicePackage,
    type ServicePackageValidationIssue,
} from './validation';

export type ServicePackageGenerationErrorCode =
    | 'TERRITORIAL_PACK_DISABLED'
    | 'PACKAGE_NOT_APPROVED'
    | 'PACKAGE_INVALID'
    | 'UNKNOWN_COMPLICATION_MODULE'
    | 'INVALID_REFERENCE_DATE';

export type ServicePackageGenerationOutcome =
    | Readonly<{
        ok: true;
        packageId: string;
        activeModuleIds: readonly string[];
        asOf: string;
        requests: readonly GeneratedServiceRequest[];
        skipped: readonly SkippedServiceItem[];
    }>
    | Readonly<{
        ok: false;
        errorCode: ServicePackageGenerationErrorCode;
        message: string;
        issues?: readonly ServicePackageValidationIssue[];
    }>;

export type GeneratePackageServiceRequestsInput = Readonly<{
    package: ApprovedServicePackage;
    territorialCapability: TerritorialPackCapability | null | undefined;
    catalog: LombardiaReferenceCatalog;
    activeModuleIds: readonly string[];
    history: readonly PatientServiceHistoryEntry[];
    asOf: string | Date;
    patientExemptionCodes?: readonly string[];
}>;

type CalendarDate = Readonly<{ year: number; month: number; day: number }>;

const ISO_CALENDAR_DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

type EffectiveItem = Readonly<{
    sourceModuleId: 'base' | string;
    item: ServicePackageItem;
}>;

function parseCalendarDate(value: string | Date | null | undefined): CalendarDate | null {
    if (!value) return null;
    if (value instanceof Date) {
        if (Number.isNaN(value.getTime())) return null;
        return {
            year: value.getUTCFullYear(),
            month: value.getUTCMonth() + 1,
            day: value.getUTCDate(),
        };
    }
    const trimmed = value.trim();
    if (ISO_CALENDAR_DATE_SHAPE.test(trimmed)) {
        if (!isValidIsoCalendarDate(trimmed)) return null;
        const [year, month, day] = trimmed.split('-').map(Number);
        return { year, month, day };
    }
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    return {
        year: parsed.getUTCFullYear(),
        month: parsed.getUTCMonth() + 1,
        day: parsed.getUTCDate(),
    };
}

function formatCalendarDate(date: CalendarDate): string {
    const year = String(date.year).padStart(4, '0');
    const month = String(date.month).padStart(2, '0');
    const day = String(date.day).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function compareCalendarDates(left: CalendarDate, right: CalendarDate): number {
    if (left.year !== right.year) return left.year - right.year;
    if (left.month !== right.month) return left.month - right.month;
    return left.day - right.day;
}

function daysInUtcMonth(year: number, month: number): number {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
    const zeroBasedMonth = date.month - 1 + months;
    const year = date.year + Math.floor(zeroBasedMonth / 12);
    const month = ((zeroBasedMonth % 12) + 12) % 12 + 1;
    const day = Math.min(date.day, daysInUtcMonth(year, month));
    return { year, month, day };
}

function wholeMonthsBetween(earlier: CalendarDate, later: CalendarDate): number {
    if (compareCalendarDates(earlier, later) >= 0) return 0;
    const raw = (later.year - earlier.year) * 12 + (later.month - earlier.month);
    return later.day < earlier.day ? Math.max(0, raw - 1) : raw;
}

function orderedNotPerformedReason(orderedAt: string) {
    return {
        kind: 'ordered_not_performed' as const,
        orderedAt,
        label: `Prescritta o prenotata il ${orderedAt}, non risulta eseguita`,
    };
}

function formatOverdueLabel(overdueMonths: number): string {
    if (overdueMonths <= 0) return 'Scaduta questo mese';
    if (overdueMonths === 1) return 'Scaduta da 1 mese';
    return `Scaduta da ${overdueMonths} mesi`;
}

function formatRemainingLabel(remainingMonths: number, validUntil: string): string {
    if (remainingMonths <= 0) return `Valida fino al ${validUntil}`;
    if (remainingMonths === 1) return `Valida ancora per 1 mese (fino al ${validUntil})`;
    return `Valida ancora per ${remainingMonths} mesi (fino al ${validUntil})`;
}

function normalizeCode(value: string): string {
    return value.trim().toUpperCase();
}

function icd11CodeMatches(patientCode: string, triggerCode: string): boolean {
    const normalizedTrigger = normalizeCode(triggerCode);
    const parts = normalizeCode(patientCode).split(/[\/&]/u).map((part) => part.trim()).filter(Boolean);
    return parts.some((part) => (
        part === normalizedTrigger
        || part.startsWith(`${normalizedTrigger}.`)
    ));
}

export function resolveMatchingComplicationModules(
    pkg: ServicePackage,
    patientIcd11Codes: readonly string[],
): readonly string[] {
    return pkg.complicationModules
        .filter((module) => (
            module.triggerIcd11Codes.some((trigger) => (
                patientIcd11Codes.some((patientCode) => icd11CodeMatches(patientCode, trigger))
            ))
        ))
        .map((module) => module.id);
}

function mergeModuleItem(existing: EffectiveItem, incoming: ServicePackageItem, moduleId: string): EffectiveItem {
    const periodicityMonths = Math.min(existing.item.periodicityMonths, incoming.periodicityMonths);
    const conditions = Array.from(new Set([
        ...existing.item.appropriatenessConditions,
        ...incoming.appropriatenessConditions,
    ]));
    const sources = [
        ...existing.item.sources,
        ...incoming.sources.filter((candidate) => (
            !existing.item.sources.some((saved) => servicePackageSourceKey(saved) === servicePackageSourceKey(candidate))
        )),
    ];
    return {
        sourceModuleId: moduleId,
        item: {
            ...incoming,
            periodicityMonths,
            appropriatenessConditions: conditions,
            sources,
        },
    };
}

function composePackageItems(
    pkg: ApprovedServicePackage,
    activeModules: readonly ComplicationModule[],
): EffectiveItem[] {
    const byCode = new Map<string, EffectiveItem>();
    for (const item of pkg.baseItems) {
        byCode.set(normalizeCode(item.serviceCode), { sourceModuleId: 'base', item });
    }
    for (const complicationModule of activeModules) {
        for (const item of complicationModule.items) {
            const code = normalizeCode(item.serviceCode);
            const existing = byCode.get(code);
            byCode.set(code, existing
                ? mergeModuleItem(existing, item, complicationModule.id)
                : { sourceModuleId: complicationModule.id, item });
        }
    }
    return [...byCode.values()];
}

function resolveExemption(
    itemExemptionCode: string | null,
    patientExemptionSet: ReadonlySet<string> | null,
): { exemptionCode: string | null; exemptionStatus: ExemptionApplicationStatus } {
    if (!itemExemptionCode) {
        return { exemptionCode: null, exemptionStatus: 'declared_by_package' };
    }
    const normalized = normalizeCode(itemExemptionCode);
    if (!patientExemptionSet) {
        return { exemptionCode: normalized, exemptionStatus: 'declared_by_package' };
    }
    if (patientExemptionSet.has(normalized)) {
        return { exemptionCode: normalized, exemptionStatus: 'active' };
    }
    return { exemptionCode: null, exemptionStatus: 'not_held_by_patient' };
}

function findLatestRelevantDates(
    history: readonly PatientServiceHistoryEntry[],
    serviceCode: string,
    asOf: CalendarDate,
): { latestCompleted: CalendarDate | null; latestOpenOrder: CalendarDate | null } {
    const targetCode = normalizeCode(serviceCode);
    let latestCompleted: CalendarDate | null = null;
    let latestOpenOrder: CalendarDate | null = null;

    for (const entry of history) {
        if (entry.status === 'cancelled') continue;
        if (entry.codeSystem && normalizeCode(entry.codeSystem) !== LOMBARDIA_SERVICE_CODE_SYSTEM) continue;
        if (normalizeCode(entry.serviceCode) !== targetCode) continue;

        if (entry.status === 'performed' || entry.status === 'report_received') {
            const completed = parseCalendarDate(entry.performedAt ?? entry.reportReceivedAt);
            if (!completed || compareCalendarDates(completed, asOf) > 0) continue;
            if (!latestCompleted || compareCalendarDates(completed, latestCompleted) > 0) {
                latestCompleted = completed;
            }
            continue;
        }

        if (entry.status === 'prescribed' || entry.status === 'booked') {
            const ordered = parseCalendarDate(entry.scheduledAt ?? entry.prescribedAt);
            if (!ordered) continue;
            if (!latestOpenOrder || compareCalendarDates(ordered, latestOpenOrder) > 0) {
                latestOpenOrder = ordered;
            }
        }
    }

    return { latestCompleted, latestOpenOrder };
}

export function generatePackageServiceRequests(
    input: GeneratePackageServiceRequestsInput,
): ServicePackageGenerationOutcome {
    if (!territorialPackActive(input.territorialCapability, 'lom')) {
        return {
            ok: false,
            errorCode: 'TERRITORIAL_PACK_DISABLED',
            message: 'Il modulo territoriale Lombardia non è attivo.',
        };
    }

    const runtimeApproval = (input.package as ServicePackage).approval;
    if (!runtimeApproval || runtimeApproval.status !== 'approved') {
        return {
            ok: false,
            errorCode: 'PACKAGE_NOT_APPROVED',
            message: 'Il pacchetto è in bozza e richiede approvazione prima di generare prestazioni.',
        };
    }

    const validation = validateServicePackage(input.package, input.catalog);
    if (!validation.ok) {
        return {
            ok: false,
            errorCode: 'PACKAGE_INVALID',
            message: 'Pacchetto non valido rispetto allo schema o al catalogo regionale.',
            issues: validation.issues,
        };
    }

    const asOfDate = parseCalendarDate(input.asOf);
    if (!asOfDate) {
        return {
            ok: false,
            errorCode: 'INVALID_REFERENCE_DATE',
            message: 'Data di riferimento non valida.',
        };
    }

    const moduleById = new Map(input.package.complicationModules.map((module) => [module.id, module]));
    const activeModules: ComplicationModule[] = [];
    const normalizedActiveModuleIds: string[] = [];
    const seenModules = new Set<string>();

    for (const moduleId of input.activeModuleIds) {
        if (seenModules.has(moduleId)) continue;
        const found = moduleById.get(moduleId);
        if (!found) {
            return {
                ok: false,
                errorCode: 'UNKNOWN_COMPLICATION_MODULE',
                message: `Modulo di complicanza sconosciuto: ${moduleId}`,
            };
        }
        seenModules.add(moduleId);
        activeModules.push(found);
        normalizedActiveModuleIds.push(moduleId);
    }

    const patientExemptionSet = input.patientExemptionCodes
        ? new Set(input.patientExemptionCodes.map(normalizeCode).filter(Boolean))
        : null;

    const effective = composePackageItems(input.package, activeModules);
    const requests: GeneratedServiceRequest[] = [];
    const skipped: SkippedServiceItem[] = [];

    for (const { sourceModuleId, item } of effective) {
        const { latestCompleted, latestOpenOrder } = findLatestRelevantDates(
            input.history,
            item.serviceCode,
            asOfDate,
        );

        if (latestCompleted) {
            const validUntil = addCalendarMonths(latestCompleted, item.periodicityMonths);
            if (compareCalendarDates(asOfDate, validUntil) < 0) {
                const validUntilText = formatCalendarDate(validUntil);
                const remainingMonths = wholeMonthsBetween(asOfDate, validUntil);
                skipped.push({
                    itemId: item.id,
                    sourceModuleId,
                    codeSystem: LOMBARDIA_SERVICE_CODE_SYSTEM,
                    serviceCode: item.serviceCode,
                    serviceName: item.serviceName,
                    periodicityMonths: item.periodicityMonths,
                    reason: {
                        kind: 'within_periodicity',
                        lastPerformedAt: formatCalendarDate(latestCompleted),
                        validUntil: validUntilText,
                        remainingMonths,
                        label: formatRemainingLabel(remainingMonths, validUntilText),
                    },
                });
                continue;
            }
        }

        if (latestOpenOrder) {
            const orderValidUntil = addCalendarMonths(latestOpenOrder, item.periodicityMonths);
            if (compareCalendarDates(asOfDate, orderValidUntil) < 0) {
                const orderedAtText = formatCalendarDate(latestOpenOrder);
                const validUntilText = formatCalendarDate(orderValidUntil);
                skipped.push({
                    itemId: item.id,
                    sourceModuleId,
                    codeSystem: LOMBARDIA_SERVICE_CODE_SYSTEM,
                    serviceCode: item.serviceCode,
                    serviceName: item.serviceName,
                    periodicityMonths: item.periodicityMonths,
                    reason: {
                        kind: 'pending_order',
                        orderedAt: orderedAtText,
                        validUntil: validUntilText,
                        label: `Già prescritta o prenotata (${orderedAtText})`,
                    },
                });
                continue;
            }
        }

        const exemption = resolveExemption(item.exemptionCode, patientExemptionSet);
        const reason = latestCompleted
            ? (() => {
                const validUntil = addCalendarMonths(latestCompleted, item.periodicityMonths);
                const overdueMonths = wholeMonthsBetween(validUntil, asOfDate);
                return {
                    kind: 'overdue' as const,
                    lastPerformedAt: formatCalendarDate(latestCompleted),
                    overdueMonths,
                    label: formatOverdueLabel(overdueMonths),
                };
            })()
            : latestOpenOrder
                ? orderedNotPerformedReason(formatCalendarDate(latestOpenOrder))
                : { kind: 'never_performed' as const, label: 'Mai eseguita' as const };

        requests.push({
            itemId: item.id,
            sourceModuleId,
            codeSystem: LOMBARDIA_SERVICE_CODE_SYSTEM,
            serviceCode: item.serviceCode,
            serviceName: item.serviceName,
            category: item.category,
            priority: item.priority,
            exemptionCode: exemption.exemptionCode,
            exemptionStatus: exemption.exemptionStatus,
            clinicalQuestion: item.clinicalQuestion,
            appropriatenessConditions: item.appropriatenessConditions,
            periodicityMonths: item.periodicityMonths,
            reason,
            sources: item.sources,
        });
    }

    return {
        ok: true,
        packageId: input.package.id,
        activeModuleIds: normalizedActiveModuleIds,
        asOf: formatCalendarDate(asOfDate),
        requests,
        skipped,
    };
}
