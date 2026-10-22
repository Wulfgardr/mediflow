'use client';

import {type RefObject} from 'react';
import PrivacyBlur from '@/components/privacy-blur';
import styles from './patient-header.module.css';

export type PatientHeaderDetails = {
    sexLabel?: string;
    ageLabel?: string;
    birthDateLabel?: string;
    taxCode?: string;
    allergies?: readonly string[];
};

export function PatientHeaderIdentity({name,details,titleRef}: {
    name: string; details: PatientHeaderDetails; titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
    const hasDetails = details.sexLabel || details.ageLabel || details.birthDateLabel || details.taxCode;
    return <div className={styles.identity}>
        <h1 ref={titleRef} tabIndex={-1} className="type-person"><PrivacyBlur>{name}</PrivacyBlur></h1>
        {hasDetails ? <p className={styles.details}>
            {details.sexLabel ? <PrivacyBlur>{details.sexLabel}</PrivacyBlur> : null}
            {details.ageLabel ? <PrivacyBlur>{details.ageLabel}</PrivacyBlur> : null}
            {details.birthDateLabel ? <PrivacyBlur>Nascita {details.birthDateLabel}</PrivacyBlur> : null}
            {details.taxCode ? <PrivacyBlur className="type-code">{details.taxCode}</PrivacyBlur> : null}
        </p> : null}
        {details.allergies?.length ? <ul className={styles.allergies} aria-label="Allergie">
            {details.allergies.map(allergy => <li key={allergy} className={styles.allergy}>
                <span aria-hidden="true">▲ </span><PrivacyBlur>{allergy}</PrivacyBlur>
            </li>)}
        </ul> : null}
    </div>;
}
