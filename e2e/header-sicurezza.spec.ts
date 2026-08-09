/* WUL-343. Gli header di sicurezza e, soprattutto, la prova che la CSP non
   rompa la UI: una policy troppo stretta si manifesta come pagina muta, non
   come errore di build, quindi va falsificata a runtime raccogliendo gli eventi
   securitypolicyviolation invece che leggendo il config. */
import { expect, test, type Page } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const ATTESI: Array<{ header: string; atteso: RegExp }> = [
  { header: 'x-frame-options', atteso: /^DENY$/i },
  { header: 'x-content-type-options', atteso: /^nosniff$/i },
  { header: 'referrer-policy', atteso: /^no-referrer$/i },
  { header: 'permissions-policy', atteso: /camera=\(\)/ },
  { header: 'cross-origin-opener-policy', atteso: /^same-origin$/i },
];

const DIRETTIVE_CSP = [
  "default-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
];

const SUPERFICI = ['/', '/diary', '/analytics', '/scales', '/settings', '/settings/ai'] as const;

type Violazione = { direttiva: string; risorsa: string; url: string };

async function raccogliViolazioni(page: Page): Promise<Violazione[]> {
  const violazioni: Violazione[] = [];
  await page.exposeFunction('__registraViolazioneCsp', (v: Violazione) => {
    violazioni.push(v);
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      const e = event as SecurityPolicyViolationEvent;
      // @ts-expect-error binding esposto da Playwright
      window.__registraViolazioneCsp({
        direttiva: e.violatedDirective,
        risorsa: (e.blockedURI || '').slice(0, 120),
        url: location.pathname,
      });
    });
  });
  return violazioni;
}

test('gli header di sicurezza sono presenti sul documento', async ({ page }) => {
  const risposta = await page.goto('/');
  expect(risposta, 'la root deve rispondere').not.toBeNull();
  const headers = risposta!.headers();

  for (const { header, atteso } of ATTESI) {
    expect(headers[header], `header ${header} (ricevuto: ${headers[header] ?? 'assente'})`).toMatch(atteso);
  }

  const csp = headers['content-security-policy'];
  expect(csp, 'Content-Security-Policy deve essere emessa').toBeTruthy();
  for (const direttiva of DIRETTIVE_CSP) {
    expect(csp, `la CSP deve contenere «${direttiva}»`).toContain(direttiva);
  }

  /* Il percorso AI del browser passa dalla stessa origine, ma i runtime locali
     restano raggiungibili: se questo salta, l'inferenza host-only si spegne. */
  expect(csp, 'la CSP deve ammettere il loopback in connect-src').toContain('http://127.0.0.1:*');

  /* HSTS e' opt-in: su 127.0.0.1 in HTTP inchioderebbe l'origine a TLS. */
  if (process.env.MEDIFLOW_ENABLE_HSTS === '1') {
    expect(headers['strict-transport-security']).toContain('max-age=');
  } else {
    expect(headers['strict-transport-security'], 'HSTS non va emesso senza opt-in').toBeUndefined();
  }
});

test('la CSP non blocca nessuna risorsa delle superfici principali', async ({ page }) => {
  test.setTimeout(180_000);
  const violazioni = await raccogliViolazioni(page);
  await page.setViewportSize({ width: 1440, height: 960 });
  await bootstrapUnlockedSession(page, process.env.E2E_PIN || '1234');

  for (const superficie of SUPERFICI) {
    await page.goto(superficie, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1_200);
  }

  expect(
    violazioni,
    `la CSP ha bloccato risorse:\n${violazioni.map((v) => `  ${v.url}: ${v.direttiva} → ${v.risorsa}`).join('\n')}`,
  ).toEqual([]);
});
