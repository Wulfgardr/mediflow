'use client';

import {type RefObject} from 'react';
import PrivacyBlur from '@/components/privacy-blur';
import styles from './patient-header.module.css';
import { IDENTIFIER_LABELS } from '@/lib/patient-identity';

export type PatientHeaderDetails = {
    sexLabel?: string;
    ageLabel?: string;
    birthDateLabel?: string;
    taxCode?: string;
    /** Nome breve dell'identificativo mostrato accanto al valore (es. «CF», «STP»). */
    identifierLabel?: string;
    identifierAbsent?: boolean;
    allergies?: readonly string[];
    allergiesUnavailable?: boolean;
    exemptions?: readonly string[];
    adi?: boolean;
};

export function PatientHeaderIdentity({name,details,titleRef}: {
    name: string; details: PatientHeaderDetails; titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
    const hasDetails = details.sexLabel || details.ageLabel || details.birthDateLabel || details.taxCode || details.identifierAbsent || details.exemptions?.length;
    return <div className={styles.identity}>
        <h1 ref={titleRef} tabIndex={-1} className="type-person"><PrivacyBlur>{name}</PrivacyBlur></h1>
        {hasDetails ? <p className={styles.details}>
            {details.ageLabel ? <PrivacyBlur>{details.ageLabel}</PrivacyBlur> : null}
            {details.sexLabel ? <PrivacyBlur>{details.sexLabel}</PrivacyBlur> : null}
            {details.birthDateLabel ? <PrivacyBlur>Nascita {details.birthDateLabel}</PrivacyBlur> : null}
            {details.taxCode ? <span><abbr title={details.identifierLabel === undefined || details.identifierLabel === 'CF' ? 'Codice fiscale' : undefined} className={styles.identifierLabel}>{details.identifierLabel ?? 'CF'}</abbr> <PrivacyBlur className="type-code">{details.taxCode}</PrivacyBlur></span> : details.identifierAbsent ? <span>{IDENTIFIER_LABELS.none}</span> : null}
            {details.exemptions?.length ? <span>Esenzioni <PrivacyBlur>{details.exemptions.join(', ')}</PrivacyBlur></span> : null}
        </p> : null}
        <div className={styles.alerts}><PatientHeaderAllergies details={details} />
            {details.adi ? <span className={styles.adi}>ADI attiva</span> : null}
        </div>
    </div>;
}

export function PatientHeaderAllergies({ details }: { details: PatientHeaderDetails }) {
    return <>
        {details.allergies?.length ? <ul className={styles.allergies} aria-label="Allergie">
            {details.allergies.map(allergy => <li key={allergy} className={styles.allergy}>
                <span aria-hidden="true">▲ </span>Allergia: <PrivacyBlur>{allergy}</PrivacyBlur>
            </li>)}
        </ul> : <p className={styles.details}>{details.allergiesUnavailable ? 'Allergie: dato non disponibile' : 'Allergie: nessuna registrata'}</p>}
    </>;
}
