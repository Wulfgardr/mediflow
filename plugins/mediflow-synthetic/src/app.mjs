import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import { createReviewController } from './review-controller.mjs';
import { examples } from './fixture.mjs';

export async function mountReview(document, app, extensions) {
  const controller = createReviewController(() => extensions.modelContext);
  const list = document.querySelector('#examples');
  const confirmation = document.querySelector('#confirmation');
  const status = document.querySelector('#status');
  const attach = document.querySelector('#attach');
  let available = false;
  function syncSelection() {
    const { selectedId, inFlight } = controller.state();
    for (const input of list.querySelectorAll('input')) {
      input.checked = input.value === selectedId;
      input.disabled = inFlight;
    }
    const example = examples.find((candidate) => candidate.id === selectedId);
    document.querySelector('#excerpt').textContent = example?.excerpt ?? 'Seleziona un esempio per leggerlo.';
    attach.disabled = !available || !example || inFlight || extensions.modelContext == null;
  }
  function render(result) {
    const data = result?.structuredContent;
    available = data?.schemaVersion === 'mediflow.synthetic.review.v1' && data.synthetic === true;
    if (!available) {
      list.replaceChildren();
      syncSelection();
      status.textContent = 'Esempi non disponibili.';
      return;
    }
    document.querySelector('#heading').textContent = data.view === 'review'
      ? 'Da revisionare — esempi inventati' : 'MediFlow — esempi inventati';
    list.replaceChildren();
    // Render only the package's fixed allowlist, never arbitrary tool HTML/text.
    for (const example of examples) {
      const label = document.createElement('label');
      label.className = 'example';
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'example'; radio.value = example.id;
      radio.addEventListener('change', () => {
        const selected = controller.select(example.id);
        syncSelection();
        if (!selected) return;
        confirmation.hidden = true;
        status.textContent = 'Esempio selezionato. Nessun testo aggiunto alla conversazione.';
      });
      const title = document.createElement('span'); title.textContent = example.title;
      label.append(radio, title); list.append(label);
    }
    syncSelection();
  }
  function updateHost(context) {
    if (context?.theme) applyDocumentTheme(context.theme);
    if (context?.styles?.variables) applyHostStyleVariables(context.styles.variables);
  }
  // Initial tool result must be observed before connecting; no extra tool call.
  app.ontoolresult = render;
  app.addEventListener('hostcontextchanged', updateHost);
  attach.addEventListener('click', () => {
    if (controller.requestAttachment()) confirmation.hidden = false;
  });
  document.querySelector('#cancel').addEventListener('click', () => {
    controller.cancel(); confirmation.hidden = true;
    status.textContent = 'Annullato. Nessun testo aggiunto alla conversazione.';
  });
  document.querySelector('#confirm').addEventListener('click', async () => {
    confirmation.hidden = true;
    const pending = controller.confirm();
    syncSelection();
    const outcome = await pending;
    const messages = {
      attached: 'Esempio aggiunto al contesto della conversazione.',
      already_attached: 'Questo esempio è già stato aggiunto durante questa apertura del pannello.',
      unsupported: 'Questo host non supporta l’aggiunta al contesto. Copia il testo dell’esempio se vuoi usarlo.',
      unconfirmed: 'L’host non ha confermato l’aggiunta. Verifica il contesto prima di riprovare.',
      failed: 'Aggiunta non confermata. Verifica il contesto prima di riprovare.',
      cancelled: 'Annullato. Nessun testo aggiunto alla conversazione.',
      busy: 'Aggiunta in corso.',
    };
    status.textContent = messages[outcome];
    syncSelection();
  });
  await app.connect();
  updateHost(app.getHostContext());
  if (extensions.modelContext == null) {
    status.textContent = 'Questo host mostra gli esempi ma non supporta l’aggiunta al contesto. Puoi copiarne il testo.';
  }
  return controller;
}

if (typeof document !== 'undefined' && document.querySelector('#examples')) {
  const app = new App({ name: 'mediflow-synthetic', version: '0.1.0' });
  const extensions = new OpenAIExtensions(app);
  mountReview(document, app, extensions).catch(() => {
    document.querySelector('#status').textContent = 'Collegamento all’host non disponibile.';
  });
}
