import {
    LOMBARDIA_SERVICE_CODE_SYSTEM,
    servicePackageSchema,
    type DraftServicePackageItem,
    type LombardiaReferenceCatalog,
    type ServicePackage,
    type ServicePackageItem,
} from './contract';

export type ServicePackageValidationIssueCode =
    | 'SCHEMA_INVALID'
    | 'DUPLICATE_ITEM_ID'
    | 'DUPLICATE_MODULE_ID'
    | 'CODE_NOT_IN_CATALOG'
    | 'CODE_INACTIVE_IN_CATALOG'
    | 'EXEMPTION_NOT_IN_CATALOG'
    | 'EXEMPTION_DOES_NOT_COVER_SERVICE';

export type ServicePackageValidationIssue = Readonly<{
    code: ServicePackageValidationIssueCode;
    path: string;
    message: string;
}>;

export type ServicePackageValidationResult =
    | Readonly<{ ok: true; value: ServicePackage }>
    | Readonly<{ ok: false; issues: readonly ServicePackageValidationIssue[] }>;

type CatalogIndex = Readonly<{
    services: ReadonlyMap<string, { active: boolean }>;
    exemptions: ReadonlyMap<string, ReadonlySet<string>>;
}>;

function normalizeCode(value: string): string {
    return value.trim().toUpperCase();
}

function indexReferenceCatalog(catalog: LombardiaReferenceCatalog): CatalogIndex {
    const services = new Map<string, { active: boolean }>();
    for (const entry of catalog.services) {
        if (entry.codeSystem !== LOMBARDIA_SERVICE_CODE_SYSTEM) continue;
        const code = normalizeCode(entry.serviceCode);
        if (code) services.set(code, { active: entry.active });
    }
    const exemptions = new Map<string, Set<string>>();
    for (const entry of catalog.exemptions) {
        const exemption = normalizeCode(entry.exemptionCode);
        const covered = exemptions.get(exemption) ?? new Set<string>();
        covered.add(normalizeCode(entry.serviceCode));
        exemptions.set(exemption, covered);
    }
    return { services, exemptions };
}

function checkServiceCode(index: CatalogIndex, serviceCode: string, path: string, issues: ServicePackageValidationIssue[]): void {
    const code = normalizeCode(serviceCode);
    const entry = index.services.get(code);
    if (!entry) {
        issues.push({ code: 'CODE_NOT_IN_CATALOG', path, message: `Codice ${code} assente dal catalogo regionale` });
    } else if (!entry.active) {
        issues.push({ code: 'CODE_INACTIVE_IN_CATALOG', path, message: `Codice ${code} non attivo nel catalogo regionale` });
    }
}

function checkItemExemption(
    index: CatalogIndex,
    item: ServicePackageItem | DraftServicePackageItem,
    path: string,
    issues: ServicePackageValidationIssue[],
): void {
    if (item.exemptionCode === null) return;
    const exemption = normalizeCode(item.exemptionCode);
    const covered = index.exemptions.get(exemption);
    if (!covered) {
        issues.push({ code: 'EXEMPTION_NOT_IN_CATALOG', path, message: `Esenzione ${exemption} assente dal catalogo delle esenzioni` });
        return;
    }
    const service = normalizeCode(item.serviceCode);
    if (!covered.has(service)) {
        issues.push({
            code: 'EXEMPTION_DOES_NOT_COVER_SERVICE',
            path,
            message: `L'esenzione ${exemption} non comprende la prestazione ${service}`,
        });
    }
}

function validateItems(
    items: readonly (ServicePackageItem | DraftServicePackageItem)[],
    basePath: string,
    index: CatalogIndex,
    seenIds: Set<string>,
    issues: ServicePackageValidationIssue[],
): void {
    items.forEach((item, position) => {
        const itemPath = `${basePath}[${position}]`;
        if (seenIds.has(item.id)) {
            issues.push({ code: 'DUPLICATE_ITEM_ID', path: `${itemPath}.id`, message: `Identificativo voce duplicato: ${item.id}` });
        } else {
            seenIds.add(item.id);
        }
        checkServiceCode(index, item.serviceCode, `${itemPath}.serviceCode`, issues);
        checkItemExemption(index, item, `${itemPath}.exemptionCode`, issues);
    });
}

export function validateServicePackage(
    rawPackage: unknown,
    catalog: LombardiaReferenceCatalog,
): ServicePackageValidationResult {
    const parsed = servicePackageSchema.safeParse(rawPackage);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map((issue) => ({
                code: 'SCHEMA_INVALID',
                path: issue.path.join('.'),
                message: issue.message,
            })),
        };
    }

    const pkg = parsed.data;
    const issues: ServicePackageValidationIssue[] = [];
    const index = indexReferenceCatalog(catalog);
    const seenItemIds = new Set<string>();
    const seenModuleIds = new Set<string>();

    if (pkg.exemption !== null && !index.exemptions.has(normalizeCode(pkg.exemption.code))) {
        issues.push({
            code: 'EXEMPTION_NOT_IN_CATALOG',
            path: 'exemption.code',
            message: `Esenzione ${pkg.exemption.code} assente dal catalogo delle esenzioni`,
        });
    }

    validateItems(pkg.baseItems, 'baseItems', index, seenItemIds, issues);

    pkg.complicationModules.forEach((complicationModule, moduleIndex) => {
        const modulePath = `complicationModules[${moduleIndex}]`;
        if (seenModuleIds.has(complicationModule.id)) {
            issues.push({
                code: 'DUPLICATE_MODULE_ID',
                path: `${modulePath}.id`,
                message: `Modulo di complicanza duplicato: ${complicationModule.id}`,
            });
        } else {
            seenModuleIds.add(complicationModule.id);
        }
        validateItems(complicationModule.items, `${modulePath}.items`, index, seenItemIds, issues);
    });

    return issues.length > 0 ? { ok: false, issues } : { ok: true, value: pkg };
}
