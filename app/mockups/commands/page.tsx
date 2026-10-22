'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

const roles = ['primary', 'secondary', 'text', 'destructive', 'icon'] as const;
const labels = { primary: 'Principale', secondary: 'Secondario', text: 'Testuale', destructive: 'Distruttivo', icon: 'Icona' };

function ExampleButton({ role, disabled = false, onClick }: { role: typeof roles[number]; disabled?: boolean; onClick?: () => void }) {
  return role === 'icon'
    ? <Button variant="icon" aria-label={disabled ? 'Apri altre azioni (non disponibile)' : 'Apri altre azioni'} disabled={disabled} onClick={onClick}><span aria-hidden="true">⋯</span></Button>
    : <Button variant={role} disabled={disabled} onClick={onClick}>Esegui</Button>;
}

const roleClasses = { primary: 'mf-button-primary', secondary: 'mf-button-secondary', text: 'mf-button-text', destructive: 'mf-button-destructive', icon: 'mf-button-icon' };

export default function CommandRolesFixture() {
  const [count, setCount] = useState(0);
  const activate = () => setCount(value => value + 1);
  return <main className="mx-auto max-w-4xl space-y-6 p-7" data-testid="command-roles">
    <h1 className="type-page-title">Ruoli dei comandi</h1>
    <p>Esempi sintetici. Nessuna operazione sulla cartella.</p>
    <p>Componente · Classe · Non disponibile</p>
    {roles.map(role => <section key={role} data-command-role={role} className="space-y-2">
      <h2 className="section-kicker">{labels[role]}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <ExampleButton role={role} onClick={activate} />
        <button type="button" className={roleClasses[role]} aria-label={role === 'icon' ? 'Apri altre azioni (classe)' : undefined} onClick={activate}>{role === 'icon' ? <span aria-hidden="true">⋯</span> : 'Esegui'}</button>
        <ExampleButton role={role} disabled />
      </div>
      <p className="text-sm">{role === 'primary' ? 'Conferma il paziente per continuare.' : role === 'destructive' ? 'Il tono pieno è riservato alla conferma.' : 'Esempio non disponibile: completa il prerequisito.'}</p>
    </section>)}
    <section className="space-y-2">
      <h2 className="section-kicker">Conferma distruttiva (esempio)</h2>
      <Button variant="destructive" confirmation data-testid="command-confirmation" onClick={activate}>Conferma eliminazione di prova</Button>
    </section>
    <section className="space-y-2" data-testid="command-aliases">
      <h2 className="section-kicker">Alias compatibili</h2>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="ui-btn-primary" onClick={activate}>Esegui</button>
        <button type="button" className="mf-btn-secondary" onClick={activate}>Esegui</button>
        <button type="button" className="ui-btn-secondary" onClick={activate}>Esegui</button>
        <Button variant="ghost" onClick={activate}>Esegui</Button>
        <button type="button" className="ui-btn-primary mf-tone-critical" data-testid="command-legacy-critical" onClick={activate}>Esegui</button>
        <a className="mf-button-primary inline-block" href="#command-result">Esegui</a>
      </div>
    </section>
    <p role="status" id="command-result">Attivazioni di prova: {count}</p>
  </main>;
}
