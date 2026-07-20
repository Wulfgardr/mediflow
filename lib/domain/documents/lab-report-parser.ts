/* @Codex */
import { classifyObservationRange, toNumericValue, type ObservationRangeFlag } from '../../observation-range';

export interface ParsedLabResult {
    analyte: string;
    value: string;
    unit: string;
    referenceRange: {
        text: string;
        low?: string;
        high?: string;
    };
    flag?: ObservationRangeFlag;
    lineNumber: number;
    sourceLine: string;
}

const NUMBER_SOURCE = String.raw`-?\d+(?:[.,]\d+)?`;
const UNIT_SOURCE = String.raw`(?:mg\/dL|mg\/L|g\/dL|g\/L|mmol\/L|mEq\/L|U\/L|UI\/L|mUI\/L|uUI\/mL|[µμ]UI\/mL|ng\/mL|ng\/dL|pg\/mL|pg|fL|%|[µμu]g\/dL|[µμu]mol\/L|10(?:\^|\*)[36]\/[µμu]L)`;
const RANGE_SOURCE = String.raw`(?:${NUMBER_SOURCE}\s*[-–]\s*${NUMBER_SOURCE}|[<>]=?\s*${NUMBER_SOURCE})`;
const LAB_ROW = new RegExp(
    String.raw`^(?<analyte>[\p{L}][\p{L}\p{N}()./' +%-]{1,79}?)\s+(?<leadingMark>\*{1,2}\s*)?(?<value>${NUMBER_SOURCE})(?<valueMark>\s*\*{1,2})?\s+(?<unit>${UNIT_SOURCE})\s+\(?(?<range>${RANGE_SOURCE})\)?(?:\s+(?<flag>H|L|ALTO|BASSO|HIGH|LOW|↑|↓|\*{1,2}))?$`,
    'iu',
);

const HEADER_OR_NOISE = /^(?:esame|analita|parametro|risultato|valore|unita|unità|intervallo|range|valori? di riferimento|metodo|materiale|campione)\b/i;

interface ParsedReferenceRange {
    range: ParsedLabResult['referenceRange'];
    lowerExclusive: boolean;
    upperExclusive: boolean;
}

function normalizeDecimal(value: string): string {
    return value.replace(/\s+/g, '').replace(',', '.');
}

function normalizeUnit(value: string): string {
    const normalized = value.replace(/[µμ]/g, 'u');
    const cellCount = normalized.match(/^10(?:\^|\*)([36])\/uL$/i);
    if (cellCount) return `10*${cellCount[1]}/uL`;

    const canonicalUnits: Record<string, string> = {
        'mg/dl': 'mg/dL',
        'mg/l': 'mg/L',
        'g/dl': 'g/dL',
        'g/l': 'g/L',
        'mmol/l': 'mmol/L',
        'meq/l': 'mEq/L',
        'u/l': 'U/L',
        'ui/l': 'U/L',
        'mui/l': 'mUI/L',
        'uui/ml': 'uUI/mL',
        'ng/ml': 'ng/mL',
        'ng/dl': 'ng/dL',
        'pg/ml': 'pg/mL',
        pg: 'pg',
        fl: 'fL',
        '%': '%',
        'ug/dl': 'ug/dL',
        'umol/l': 'umol/L',
    };
    return canonicalUnits[normalized.toLowerCase()] ?? normalized;
}

function parseReferenceRange(value: string): ParsedReferenceRange | undefined {
    const text = value.replace(/\s+/g, ' ').trim();
    const bilateral = text.match(new RegExp(String.raw`^(${NUMBER_SOURCE})\s*[-–]\s*(${NUMBER_SOURCE})$`));
    if (bilateral) {
        const low = normalizeDecimal(bilateral[1]);
        const high = normalizeDecimal(bilateral[2]);
        const lowNumber = toNumericValue(low);
        const highNumber = toNumericValue(high);
        if (lowNumber === null || highNumber === null || lowNumber > highNumber) return undefined;
        return {
            range: { text, low, high },
            lowerExclusive: false,
            upperExclusive: false,
        };
    }

    const unilateral = text.match(new RegExp(String.raw`^([<>]=?)\s*(${NUMBER_SOURCE})$`));
    if (!unilateral) return undefined;
    const operator = unilateral[1];
    const bound = normalizeDecimal(unilateral[2]);
    if (toNumericValue(bound) === null) return undefined;
    return operator.startsWith('<')
        ? {
            range: { text, high: bound },
            lowerExclusive: false,
            upperExclusive: operator === '<',
        }
        : {
            range: { text, low: bound },
            lowerExclusive: operator === '>',
            upperExclusive: false,
        };
}

function explicitFlag(value: string | undefined): ObservationRangeFlag | undefined {
    if (!value || /^\*+$/.test(value)) return undefined;
    return /^(?:H|ALTO|HIGH|↑)$/i.test(value) ? 'alto' : 'basso';
}

function parseLabRow(sourceLine: string, lineNumber: number): ParsedLabResult | undefined {
    const normalizedLine = sourceLine
        .replace(/\u00a0/g, ' ')
        .replace(/[|;\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!normalizedLine || HEADER_OR_NOISE.test(normalizedLine)) return undefined;

    const match = normalizedLine.match(LAB_ROW);
    if (!match?.groups) return undefined;
    const analyte = match.groups.analyte.trim();
    if (analyte.length < 2 || /\d{4,}/.test(analyte)) return undefined;

    const parsedReferenceRange = parseReferenceRange(match.groups.range);
    if (!parsedReferenceRange) return undefined;
    const referenceRange = parsedReferenceRange.range;
    const value = normalizeDecimal(match.groups.value);
    if ((value.match(/\d/g) ?? []).length > 8) return undefined;
    const numericValue = toNumericValue(value);
    const low = referenceRange.low === undefined ? null : toNumericValue(referenceRange.low);
    const high = referenceRange.high === undefined ? null : toNumericValue(referenceRange.high);
    const calculatedFlag = classifyObservationRange(value, referenceRange.low, referenceRange.high)
        ?? (parsedReferenceRange.lowerExclusive && numericValue === low ? 'basso' : undefined)
        ?? (parsedReferenceRange.upperExclusive && numericValue === high ? 'alto' : undefined);
    const statedFlag = explicitFlag(match.groups.flag);
    if (statedFlag && statedFlag !== calculatedFlag) return undefined;

    return {
        analyte,
        value,
        unit: normalizeUnit(match.groups.unit),
        referenceRange,
        flag: statedFlag ?? calculatedFlag,
        lineNumber,
        sourceLine: sourceLine.trim(),
    };
}

/** Estrae solo righe complete e non ambigue. Nessun dato viene persistito. */
export function parseItalianLabReport(text: string): ParsedLabResult[] {
    const results: ParsedLabResult[] = [];
    for (const [index, line] of text.replace(/\r/g, '').split('\n').entries()) {
        const parsed = parseLabRow(line, index + 1);
        if (parsed) results.push(parsed);
    }
    return results;
}
