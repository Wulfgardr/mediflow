const SOURCE_LABELS = new Map([
    ['profile', 'Profilo clinico'], ['diagnosis', 'Diagnosi'], ['therapy', 'Terapia'],
    ['observation', 'Parametro'], ['entry', 'Diario'], ['insight', 'Sintesi documento'], ['attachment', 'Allegato'],
]);

export function indexTreatmentReasoningSources(groups: readonly (readonly string[])[]) {
    return [...new Set(groups.flat())].map((reference, index) => ({
        reference,
        label: `${SOURCE_LABELS.get(reference.split(':', 1)[0]) ?? 'Riferimento'} · Fonte ${index + 1}`,
    }));
}
