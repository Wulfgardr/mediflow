import { changePatientMemberships } from '@/lib/patient-membership-route';

export async function POST(request: Request) {
    return changePatientMemberships(request, 'unassign');
}
