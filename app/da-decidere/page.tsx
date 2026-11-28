import { DaDecidere } from './da-decidere';

export default async function DaDeciderePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const patientId = typeof params.patientId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(params.patientId) ? params.patientId : null;
    const view = params.vista === 'documenti' || params.vista === 'seduta' ? params.vista : 'visite';
    return <DaDecidere view={view} patientId={patientId} />;
}
