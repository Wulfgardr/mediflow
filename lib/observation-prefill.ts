/* @Codex */

export type ServicePrescriptionItemLink = {
    id: string;
    serviceName: string;
    prescriptionDate: Date | string;
};

export type ObservationPrefill = {
    requestId: string;
    codeSystem?: 'LOINC';
    code?: string;
    display?: string;
    unitCode?: string;
    servicePrescriptionItemId?: string;
    servicePrescriptionItem?: ServicePrescriptionItemLink;
};

type LoincOption = {
    code: string;
    defaultUnit?: string;
};

export function applyObservationPrefill(
    prefill: ObservationPrefill,
    loincOptions: LoincOption[],
) {
    const option = prefill.codeSystem === 'LOINC' && prefill.code
        ? loincOptions.find((item) => item.code === prefill.code)
        : undefined;

    return {
        code: option?.code ?? '',
        unitCode: option ? prefill.unitCode ?? option.defaultUnit ?? '' : '',
        servicePrescriptionItemId: prefill.servicePrescriptionItemId,
        servicePrescriptionItem: prefill.servicePrescriptionItem,
    };
}

export function removeServicePrescriptionItemLink(prefill: ObservationPrefill) {
    return {
        ...prefill,
        servicePrescriptionItemId: undefined,
        servicePrescriptionItem: undefined,
    };
}
