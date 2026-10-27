import type { Checkup } from './db';
import { parseCheckupStatus } from './status-normalization';

type WorklistControl = Pick<Checkup, 'id' | 'patientId' | 'title'> & {
  status?: string;
  date: Date | string;
  deletedAt?: Date | string | null;
};

export type WorklistTodos =
  | { status: 'loading' | 'error' | 'unavailable' }
  | { status: 'ready'; byPatient: ReadonlyMap<string, { count: number; next: WorklistControl }> };

export function projectWorklistTodos(read: {
  data: readonly WorklistControl[] | undefined;
  loading: boolean;
  error: unknown;
}): WorklistTodos {
  if (read.loading) return { status: 'loading' };
  if (read.error) return { status: 'error' };
  if (!read.data) return { status: 'unavailable' };
  const byPatient = new Map<string, { count: number; next: WorklistControl }>();
  for (const control of read.data) {
    if (control.deletedAt) continue;
    const status = parseCheckupStatus(control.status);
    if (!status) return { status: 'unavailable' };
    if (status !== 'pending') continue;
    if (!Number.isFinite(new Date(control.date).getTime())) return { status: 'unavailable' };
    const current = byPatient.get(control.patientId);
    byPatient.set(control.patientId, {
      count: (current?.count ?? 0) + 1,
      next: !current || new Date(control.date) < new Date(current.next.date) ? control : current.next,
    });
  }
  return { status: 'ready', byPatient };
}
