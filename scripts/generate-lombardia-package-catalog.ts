import { readFileSync, writeFileSync } from 'node:fs';
import { ALL_LOMBARDIA_SERVICE_PACKAGES, listApprovedServicePackages } from '../lib/territorial/lombardia/service-packages';
import {
    EXEMPTION_COVERAGE_TABLE_PATH, NOMENCLATORE_TABLE_PATH, PACKAGE_CATALOG_MODULE_PATH,
    readLombardiaReferenceCatalog, renderPackageCatalogModule, selectPackageReferenceCatalog,
} from './lombardia-reference-tables';

const rendered = renderPackageCatalogModule(selectPackageReferenceCatalog(
    readLombardiaReferenceCatalog(),
    listApprovedServicePackages(ALL_LOMBARDIA_SERVICE_PACKAGES),
));
if (process.argv.includes('--check')) {
    if (readFileSync(PACKAGE_CATALOG_MODULE_PATH, 'utf8') !== rendered) {
        console.error(`${PACKAGE_CATALOG_MODULE_PATH} non coincide con ${NOMENCLATORE_TABLE_PATH} e ${EXEMPTION_COVERAGE_TABLE_PATH}: esegui npm run generate:lombardia-package-catalog`);
        process.exitCode = 1;
    }
} else {
    writeFileSync(PACKAGE_CATALOG_MODULE_PATH, rendered);
    console.log(`${PACKAGE_CATALOG_MODULE_PATH} generato da ${NOMENCLATORE_TABLE_PATH} e ${EXEMPTION_COVERAGE_TABLE_PATH}`);
}
