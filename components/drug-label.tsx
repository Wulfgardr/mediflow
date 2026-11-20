import PrivacyBlur from './privacy-blur';
import styles from './twin-synoptic-sheet.module.css';

const strength = /^(.*\S)\s+(\d[\d.,/]*\s*(?:mg|mcg|µg|g|ml|mL|UI|U|%|mmol|mEq)\b.*)$/u;

export function DrugLabel({ name }: { name: string }) {
    const parts = strength.exec(name);
    if (!parts) return <PrivacyBlur>{name}</PrivacyBlur>;
    return <PrivacyBlur><span>{parts[1]}</span> <span className={styles.drugStrength}>{parts[2]}</span></PrivacyBlur>;
}
