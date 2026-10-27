export const workspaceDestinationHrefs = [
  '/?area=incarico', '/?area=turno', '/?area=diario', '/?area=repertori',
  '/analytics', '/scales', '/settings',
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
