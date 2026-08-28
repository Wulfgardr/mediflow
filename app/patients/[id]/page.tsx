import { redirect } from 'next/navigation';

/* @Codex WUL-562: la route storica non apre una seconda superficie clinica. */
export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  redirect(`/patients/${encodeURIComponent(id)}/modules`);
}
