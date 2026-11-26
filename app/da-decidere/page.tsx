import { DaDecidere } from './da-decidere';

export default async function DaDeciderePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
    const params = await searchParams;
    const patientId = typeof params.patientId === 'string' && /^[A-Za-z0-9_-]{1,128}$/u.test(params.patientId) ? params.patientId : null;
    return <DaDecidere view={params.vista === 'documenti' ? 'documenti' : 'visite'} patientId={patientId} />;
}
