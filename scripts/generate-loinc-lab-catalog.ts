import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    LOINC_LAB_MODULE_PATH, LOINC_LAB_TABLE_PATH, LOINC_LAB_UNITS_NATIVE_PATH, LOINC_LAB_UNITS_PATH, readLoincLabTable, readLoincLabUnits,
    renderLoincLabModule, renderLoincLabUnitsNative,
} from './loinc-lab-table';

const rows = readLoincLabTable();
const units = readLoincLabUnits(rows);
const outputs = [[LOINC_LAB_MODULE_PATH, renderLoincLabModule(rows, units)], [LOINC_LAB_UNITS_NATIVE_PATH, renderLoincLabUnitsNative(units)]] as const;
for (const [file, rendered] of outputs) {
    if (process.argv.includes('--check')) {
        if (readFileSync(file, 'utf8') !== rendered) {
            console.error(`${file} non coincide con ${LOINC_LAB_TABLE_PATH} e ${LOINC_LAB_UNITS_PATH}: esegui npm run generate:loinc-lab-catalog`);
            process.exitCode = 1;
        }
    } else {
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, rendered);
        console.log(`${file} generato da ${LOINC_LAB_TABLE_PATH} e ${LOINC_LAB_UNITS_PATH}`);
    }
}
