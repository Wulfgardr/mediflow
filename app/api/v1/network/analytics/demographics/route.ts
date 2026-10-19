import { requireNetworkCapabilityContext } from '@/lib/network-write-context';
import { POPULATION_DEMOGRAPHICS_CAPABILITY } from '@/lib/population-demographics';
import { readNetworkPopulationDemographics } from '@/lib/population-demographics-service';
import { apiInternalError } from '@/lib/api-error-response';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
    try {
        const admitted = await requireNetworkCapabilityContext(request, POPULATION_DEMOGRAPHICS_CAPABILITY);
        if (!admitted.ok) {
            admitted.response.headers.set('Cache-Control', 'no-store');
            return admitted.response;
        }
        return await readNetworkPopulationDemographics(admitted.context);
    } catch (error) {
        return apiInternalError('Read population demographics', error);
    }
}
