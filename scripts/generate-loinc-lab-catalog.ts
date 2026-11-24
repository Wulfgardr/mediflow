import { readFileSync, writeFileSync } from 'node:fs';
import { LOINC_LAB_MODULE_PATH, LOINC_LAB_TABLE_PATH, readLoincLabTable, renderLoincLabModule } from './loinc-lab-table';

const rendered = renderLoincLabModule(readLoincLabTable());
if (process.argv.includes('--check')) {
    if (readFileSync(LOINC_LAB_MODULE_PATH, 'utf8') !== rendered) {
        console.error(`${LOINC_LAB_MODULE_PATH} non coincide con ${LOINC_LAB_TABLE_PATH}: esegui npm run generate:loinc-lab-catalog`);
        process.exitCode = 1;
    }
} else {
    writeFileSync(LOINC_LAB_MODULE_PATH, rendered);
    console.log(`${LOINC_LAB_MODULE_PATH} generato da ${LOINC_LAB_TABLE_PATH}`);
}
