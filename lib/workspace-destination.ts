export const workspaceDestinationHrefs = [
  '/?area=incarico', '/?area=turno', '/?area=diario', '/?area=repertori',
  '/da-decidere', '/analytics', '/scales', '/settings',
] as const;

export function currentWorkspaceDestination(pathname: string, area: string | null): string | null {
  const path = pathname.split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
  const within = (root: string) => path === root || path.startsWith(`${root}/`);
  if (path === '/' || path === '/diary') {
    const currentArea = path === '/diary' ? 'diario' : area;
    if (currentArea === 'governance') return '/settings';
    return workspaceDestinationHrefs.find(href => href === `/?area=${currentArea}`) ?? null;
  }
  if (within('/patients')) return '/?area=incarico';
  return workspaceDestinationHrefs.find(href => !href.includes('?') && within(href)) ?? null;
}

const patientCollectionRoutes = new Set(['import', 'new']);

export function openPatientRecordId(pathname: string): string | null {
  const id = pathname.match(/^\/patients\/([^/?#]+)\//)?.[1] ?? null;
  return id && !patientCollectionRoutes.has(id) ? id : null;
}
