import { createCipheriv, randomBytes } from 'node:crypto';
import {
    DIARY_REVISION_PREFIX, diaryRevisionAad, parseLegacyRevisionProtection,
    type DiaryRevisionBinding, type DiaryRevisionField, type LegacyRevisionProtection,
} from './diary-revision-envelope';
import { isSealedValue } from './network-patient-lifecycle';
import { hasAttestedLoopbackIngress } from './security/loopback-ingress.mjs';

export function localLegacyRevisionProtection(request: Request, value: unknown): LegacyRevisionProtection | undefined {
    return hasAttestedLoopbackIngress(request) ? parseLegacyRevisionProtection(value) : undefined;
}

type PreviousText = { title: string; content: string };

export function sealPreviousDiaryText(
    binding: DiaryRevisionBinding, previous: PreviousText, protection: LegacyRevisionProtection | undefined,
): PreviousText | null {
    if (isSealedValue(previous.title) && isSealedValue(previous.content)) return previous;
    if (!protection || protection.patientId !== binding.patientId || protection.entryId !== binding.entryId
        || protection.version !== binding.version) return null;
    const key = Buffer.from(protection.key, 'base64');
    try {
        const seal = (value: string, field: DiaryRevisionField) => {
            if (isSealedValue(value)) return value;
            const iv = randomBytes(12);
            const cipher = createCipheriv('aes-256-gcm', key, iv);
            cipher.setAAD(diaryRevisionAad(binding, field));
            const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final(), cipher.getAuthTag()]);
            return `${DIARY_REVISION_PREFIX}${protection.wrapIv}:${protection.wrappedKey}:${iv.toString('base64')}:${data.toString('base64')}`;
        };
        return { title: seal(previous.title, 'title'), content: seal(previous.content, 'content') };
    } finally { key.fill(0); }
}
