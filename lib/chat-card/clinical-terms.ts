import { searchStaticTerminology } from '../terminology';

const terms = new Set([
    'diabete', 'diabete mellito', 'diabete mellito tipo 1', 'diabete mellito tipo 2',
    'ipertensione', 'ipertensione arteriosa', 'asma', 'asma bronchiale', 'broncopneumopatia cronica ostruttiva',
    'dislipidemia', 'obesità', 'ipotiroidismo', 'anemia', 'fibrillazione atriale', 'insufficienza renale cronica',
    'scompenso cardiaco', 'osteoporosi', 'artrosi', 'metformina', 'hba1c', 'fev1', 'cd4', 't4', 'b12', 'vitamina d3',
]);
const fold = (text: string) => text.normalize('NFKC').toLowerCase().trim().replace(/\s+/gu, ' ');
export function isClosedClinicalTerm(text: string): boolean {
    const key = fold(text);
    return terms.has(key) || (['LOINC', 'UCUM'] as const).some(system =>
        searchStaticTerminology(system, text, 100).some(item => [item.display, item.displayIt, item.code].some(value => value && fold(value) === key)));
}
