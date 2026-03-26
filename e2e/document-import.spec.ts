/* @Codex */
import { expect, test } from '@playwright/test';
import { bootstrapUnlockedSession } from './utils';

const TEST_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9X8gAAAABJRU5ErkJggg==';

test('document import precompiles ICD diagnoses for operator review before patient creation', async ({ page }) => {
  const pin = process.env.E2E_PIN || '1234';
  const suffix = `${Date.now()}`.slice(-3);
  const firstName = `Smoke${suffix}`;
  const lastName = `Import${suffix}`;
  const taxCode = `TSTDOC80A01H${suffix}X`;

  await page.route('**/api/ocr/extract', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        confidence: 0.96,
        data: {
          confidence: 0.96,
          firstName,
          lastName,
          taxCode,
          birthDate: '1980-01-01T00:00:00.000Z',
          address: 'Via Test 1, Roma',
          rawMarkdown: `Referto clinico\nPaziente: ${firstName} ${lastName}\nICD-11 EF00 - Disturbo depressivo maggiore, episodio singolo lieve`
        }
      })
    });
  });

  await page.route('**/api/proxy/ai/chat', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                summary_markdown: '**Riassunto clinico:** episodio depressivo lieve con codice esplicito nel referto.',
                quality: {
                  level: 'green',
                  reason: 'Documento leggibile con codice ICD esplicito'
                },
                diagnoses: [
                  {
                    code: 'EF00',
                    description: 'Disturbo depressivo maggiore, episodio singolo lieve',
                    system: 'ICD-11',
                    evidence: 'ICD-11 EF00',
                    confidence: 'high'
                  }
                ]
              })
            }
          }
        ],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 80
        }
      })
    });
  });

  await bootstrapUnlockedSession(page, pin);
  await page.goto('/patients/new');

  await expect(page.getByRole('heading', { name: /Nuova (Anagrafica|Paziente)/ })).toBeVisible();

  const uploadInput = page.getByLabel('Carica documento');
  await uploadInput.setInputFiles({
    name: 'referto-import.png',
    mimeType: 'image/png',
    buffer: Buffer.from(TEST_PNG_BASE64, 'base64')
  });

  await expect(page.getByRole('heading', { name: 'Importazione assistita completata' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sono stati estratti 1 quesiti diagnostici. Verificare la correttezza della codifica ICD prima della conferma finale.')).toBeVisible();
  await expect(page.getByPlaceholder('RSSMRA80A01H501U')).toHaveValue(taxCode);
  await expect(page.getByPlaceholder('Es. 8A80.0').first()).toHaveValue('EF00');
  await expect(page.getByPlaceholder('Cerca diagnosi (ICD-11 Official - English)').first()).toHaveValue(
    'EF00 - Disturbo depressivo maggiore, episodio singolo lieve'
  );

  await page.getByRole('button', { name: 'Crea Nuova Scheda' }).click();

  await expect(page).toHaveURL(/\/$/);
  const search = page.getByPlaceholder('Cerca paziente...');
  await search.fill(lastName);
  await expect(page.getByText(new RegExp(`${lastName} ${firstName}`))).toBeVisible();
});
