import access from '@/components/auth-health-screen.module.css';
import Link from 'next/link';
import { connection } from 'next/server';
import { isPluginLocalUiRuntime } from '@/lib/security/plugin-local-ui-runtime';
import { PluginLocalUiNavigation, PluginLocalUiRuntimeProvider } from '@/components/plugin-local-ui-navigation';

export default async function PluginLocalUiPage() {
  await connection();
  return (
    <PluginLocalUiRuntimeProvider enabled={isPluginLocalUiRuntime()}>
      <div className={access.continuation}>
        <article className={access.sheet} data-record-page data-record-island>
          <span className={access.brand} data-record-brand>
            <span className={access.brandGlyph} data-brand-glyph aria-hidden="true"><i /><i /><i /></span>
            MediFlow
          </span>
          <h1 className={access.title}>Continua in MediFlow</h1>
          <p>La cartella resta in questa interfaccia locale. Il plugin non riceve codice fiscale, storia clinica o esiti delle prescrizioni.</p>
          <PluginLocalUiNavigation />
          <Link className="mf-button-primary" href="/?area=incarico">Cerca e scegli il paziente</Link>
          <p>Apri la cartella e scegli Anagrafica per gli identificativi, Timeline clinica per la storia e le fonti, oppure Guida alla prescrizione per farmaci, prestazioni e protesica.</p>
          <p>Dopo una nuova richiesta dal plugin, conferma il percorso sulla cartella aperta. Lock, cambio di selezione e disconnessione richiedono una nuova richiesta.</p>
        </article>
      </div>
    </PluginLocalUiRuntimeProvider>
  );
}
