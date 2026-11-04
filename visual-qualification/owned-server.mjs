// La promessa di chiusura nasce insieme al processo: se il server esce prima di essere
// pronto, l'evento `close` è già passato quando parte la pulizia, e attenderlo dopo
// bloccherebbe per sempre la rimozione di archivio, build e tsconfig.
export function trackClose(child) {
  return new Promise(resolve => child.once('close', resolve));
}

export async function stopServer(child, closed, graceMs = 5000) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  const force = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, graceMs);
  try { await closed; } finally { clearTimeout(force); }
}
