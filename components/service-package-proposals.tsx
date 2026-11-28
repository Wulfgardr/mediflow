'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Disclosure } from '@/components/disclosure';
import { formatCountLabel } from '@/lib/format-count';
import type { Diagnosis, Observation, ServicePrescription, ServicePrescriptionItem } from '@/lib/db';
import { submitServicePrescriptionSet, type ServicePrescriptionSetOutcome } from '@/lib/service-prescription-set-client';
import type { TerritorialPackCapability } from '@/lib/territorial-pack-contract';
import {
    ALL_LOMBARDIA_SERVICE_PACKAGES,
    APPROVED_PACKAGE_REFERENCE_CATALOG,
    buildPackagePrescriptionDrafts,
    buildVisitServiceHistory,
    composeVisitPackageProposals,
    type GeneratedServiceRequest,
    type PackagePrescriptionDraft,
    type VisitPackageProposal,
} from '@/lib/territorial/lombardia/service-packages';
import styles from './service-package-proposals.module.css';

type Props = {
    patientId: string;
    territorialCapability: TerritorialPackCapability | null;
    diagnoses: readonly Diagnosis[];
    exemptionCodes: readonly string[];
    prescriptions: readonly ServicePrescription[] | undefined;
    items: readonly ServicePrescriptionItem[] | undefined;
    observations: readonly Observation[] | undefined;
    asOf: string;
};

type Choice = { selected: boolean; clinicalQuestion: string };

function exemptionText(request: GeneratedServiceRequest): string | null {
    if (request.exemptionStatus === 'active' && request.exemptionCode) return `Esenzione ${request.exemptionCode}`;
    if (request.exemptionStatus === 'not_held_by_patient') return `Senza esenzione: ${request.declaredExemptionCode} non registrata in scheda`;
    return null;
}

function periodicityText(months: number): string {
    return months === 1 ? 'ogni mese' : `ogni ${months} mesi`;
}

function PackageProposal({ patientId, proposal, prescribedOn }: { patientId: string; proposal: VisitPackageProposal; prescribedOn: string }) {
    const [choices, setChoices] = useState<Record<string, Choice>>({});
    const [saving, setSaving] = useState(false);
    const [unconfirmed, setUnconfirmed] = useState<readonly PackagePrescriptionDraft[] | null>(null);
    const [outcome, setOutcome] = useState<ServicePrescriptionSetOutcome | null>(null);
    if (!proposal.outcome.ok) {
        return <section className={styles.package} aria-label={proposal.title}>
            <h3>{proposal.title}</h3>
            <p role="alert">{proposal.outcome.message}</p>
        </section>;
    }
    const { requests, skipped } = proposal.outcome;
    const choiceFor = (request: GeneratedServiceRequest): Choice => choices[request.itemId]
        ?? { selected: true, clinicalQuestion: request.clinicalQuestion };
    const selected = requests.filter((request) => choiceFor(request).selected);
    const locked = saving || unconfirmed !== null;
    const update = (request: GeneratedServiceRequest, change: Partial<Choice>) => {
        setOutcome(null);
        setChoices((current) => ({ ...current, [request.itemId]: { ...choiceFor(request), ...change } }));
    };

    const prescribe = async () => {
        const drafts = unconfirmed ?? buildPackagePrescriptionDrafts({
            patientId,
            proposal,
            choices: selected.map((request) => ({ request, clinicalQuestion: choiceFor(request).clinicalQuestion })),
            prescribedAt: new Date(prescribedOn),
            newId: () => crypto.randomUUID(),
        });
        setSaving(true);
        setOutcome(null);
        const result = await submitServicePrescriptionSet(drafts).catch((): ServicePrescriptionSetOutcome => ({ kind: 'unconfirmed' }));
        setUnconfirmed(result.kind === 'unconfirmed' ? drafts : null);
        setOutcome(result);
        setSaving(false);
    };

    return <section className={styles.package} aria-labelledby={`pacchetto-${proposal.packageId}`} data-testid="service-package-proposal">
        <header className={styles.head}>
            <h3 id={`pacchetto-${proposal.packageId}`}>{proposal.title}</h3>
            <p>{proposal.approvalLabel}{proposal.modules.map((module) => ` · con ${module.title.toLowerCase()}`).join('')}</p>
        </header>
        {requests.length === 0
            ? <p className={styles.muted}>Nulla da prescrivere: le prestazioni del pacchetto sono in corso di validità o già prescritte.</p>
            : <ul className={styles.list} data-testid="service-package-requests">
                {requests.map((request) => {
                    const choice = choiceFor(request);
                    const exemption = exemptionText(request);
                    const questionId = `quesito-${proposal.packageId}-${request.itemId}`;
                    return <li key={request.itemId} className={styles.request} data-service-code={request.serviceCode}>
                        <label className={styles.pick}>
                            <input type="checkbox" checked={choice.selected} disabled={locked}
                                onChange={(event) => update(request, { selected: event.target.checked })} />
                            <span><strong>{request.serviceName}</strong> <span className={styles.code}>{request.serviceCode}</span></span>
                        </label>
                        <p className={styles.reason}>
                            {request.reason.kind === 'overdue' ? `${request.reason.label} (ultima il ${request.reason.lastPerformedAt})` : request.reason.label}
                            {` · ${periodicityText(request.periodicityMonths)}`}
                            {exemption ? ` · ${exemption}` : ''}
                        </p>
                        <label className={styles.question} htmlFor={questionId}>Quesito</label>
                        <input id={questionId} className={styles.questionInput} value={choice.clinicalQuestion} disabled={locked || !choice.selected}
                            onChange={(event) => update(request, { clinicalQuestion: event.target.value })} />
                        {request.appropriatenessConditions.length > 0 && <ul className={styles.conditions}>
                            {request.appropriatenessConditions.map((condition) => <li key={condition}>{condition}</li>)}
                        </ul>}
                    </li>;
                })}
            </ul>}
        {skipped.length > 0 && <Disclosure title={formatCountLabel(skipped.length, 'prestazione esclusa', 'prestazioni escluse')} headingLevel={4}>
            <ul className={styles.skipped} data-testid="service-package-skipped">
                {skipped.map((item) => <li key={item.itemId} data-service-code={item.serviceCode}>
                    {item.serviceName} <span className={styles.code}>{item.serviceCode}</span>: {item.reason.label}
                </li>)}
            </ul>
        </Disclosure>}
        {(requests.length > 0 || unconfirmed) && <div className={styles.actions}>
            <Button variant="secondary" disabled={saving || (!unconfirmed && selected.length === 0)} onClick={() => void prescribe()}>
                {saving ? 'Registrazione…' : unconfirmed ? 'Riprova' : `Prescrivi ${formatCountLabel(selected.length, 'prestazione', 'prestazioni')}`}
            </Button>
        </div>}
        {outcome?.kind === 'saved' && <p role="status">{`Registrate fra le prestazioni prescritte: ${outcome.count}.`}</p>}
        {outcome?.kind === 'refused' && <p role="alert">{`Nessuna prestazione registrata: ${outcome.message}.`}</p>}
        {outcome?.kind === 'unconfirmed' && <p role="alert">Esito della registrazione non confermato.</p>}
    </section>;
}

export default function ServicePackageProposals(props: Props) {
    const { patientId, territorialCapability, diagnoses, exemptionCodes, prescriptions, items, observations, asOf } = props;
    const ready = prescriptions !== undefined && items !== undefined && observations !== undefined;
    const view = useMemo(() => {
        if (!ready) return null;
        const history = buildVisitServiceHistory({ patientId, prescriptions, items, observations });
        return {
            history,
            proposals: composeVisitPackageProposals({
                packages: ALL_LOMBARDIA_SERVICE_PACKAGES,
                catalog: APPROVED_PACKAGE_REFERENCE_CATALOG,
                territorialCapability,
                diagnoses,
                exemptionCodes,
                history: history.entries,
                asOf,
            }),
        };
    }, [ready, patientId, prescriptions, items, observations, territorialCapability, diagnoses, exemptionCodes, asOf]);

    if (!view || view.proposals.status !== 'ready' || view.proposals.proposals.length === 0) return null;
    const uncompared = view.history.uncomparedObservationNames;
    return <div className={styles.proposals} data-testid="service-package-proposals">
        <h2 className={styles.title}>Proposte dai pacchetti approvati</h2>
        {view.proposals.proposals.map((proposal) => <PackageProposal key={`${patientId}:${proposal.packageId}`}
            patientId={patientId} proposal={proposal} prescribedOn={asOf} />)}
        {uncompared.length > 0 && <p className={styles.muted} data-testid="service-package-uncompared">
            {`Manca una prestazione regionale collegata per ${uncompared.join(', ')}.`}
        </p>}
    </div>;
}
