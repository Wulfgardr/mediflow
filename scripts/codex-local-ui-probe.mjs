import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function probeCodexLocalUi({ binary, script, command, args, environment = {}, evidenceDirectory, codexHome, prompt }) {
  const home = codexHome ?? fs.mkdtempSync(path.join(os.tmpdir(), 'mediflow-codex-probe-'));
  const requests = [];
  const server = http.createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    const input = JSON.parse(body);
    requests.push(input);
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (type, fields) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`);
    const id = `local_${requests.length}`;
    send('response.created', { response: { id, object: 'response', status: 'in_progress', output: [] } });
    const item = requests.length === 1
      ? { id: 'probe_call', type: 'custom_tool_call', call_id: 'probe', name: 'exec', namespace: 'functions', input: script }
      : { id: 'probe_done', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Local protocol fixture completed.', annotations: [] }] };
    send('response.output_item.done', { output_index: 0, item });
    send('response.completed', { response: { id, object: 'response', status: 'completed', output: [item],
      usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } });
    response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = {
    model_provider: 'local_probe',
    model_providers: { local_probe: { name: 'Deterministic local protocol fixture',
      base_url: `http://127.0.0.1:${server.address().port}`, wire_api: 'responses', requires_openai_auth: false,
      supports_websockets: false } },
    ...(command ? { mcp_servers: { 'mediflow-local-ui': { command, args, env: environment, startup_timeout_sec: 60, tool_timeout_sec: 30 } } } : {}),
    features: { code_mode: true, code_mode_host: true }, model_reasoning_effort: 'low',
  };
  const toml = value => value && typeof value === 'object'
    ? Array.isArray(value) ? `[${value.map(toml).join(',')}]`
      : `{${Object.entries(value).map(([key, val]) => `${JSON.stringify(key)}=${toml(val)}`).join(',')}}`
    : JSON.stringify(value);
  const cliArgs = ['--no-daemon', 'exec', ...(!codexHome ? ['--ignore-user-config'] : []), '--ephemeral', '--skip-git-repo-check',
    '-s', 'read-only', '--json', '-m', 'gpt-6-luna'];
  for (const [key, value] of Object.entries(config)) cliArgs.push('-c', `${key}=${toml(value)}`);
  cliArgs.push(prompt ?? 'Local protocol fixture. No external model or account.');
  let stdout = '', stderr = '';
  try {
    const child = spawn(binary, cliArgs, { cwd: root, env: { ...process.env, CODEX_HOME: home,
      RUST_LOG: 'codex_core::tools=debug,codex_core::mcp_connection_manager=debug' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    const timer = setTimeout(() => child.kill('SIGTERM'), 90_000);
    let code;
    try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); }); }
    finally { clearTimeout(timer); }
    if (evidenceDirectory) {
      fs.mkdirSync(evidenceDirectory, { recursive: true });
      fs.writeFileSync(path.join(evidenceDirectory, 'requests.json'), JSON.stringify(requests, null, 2));
      fs.writeFileSync(path.join(evidenceDirectory, 'codex.jsonl'), stdout);
      fs.writeFileSync(path.join(evidenceDirectory, 'codex.stderr'), stderr);
    }
    assert.equal(code, 0, stderr);
    const output = requests.flatMap(request => request.input)
      .filter(item => item.type === 'custom_tool_call_output');
    assert.ok(output.length > 0, 'Codex must execute the local code-mode call');
    return { output, requests, stdout, stderr };
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (!codexHome) fs.rmSync(home, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--mcp-fixture') {
  process.chdir(root);
  const { fixture } = await import('../lib/security/local-ui-mcp-test-fixture.ts');
  const f = fixture();
  process.stdin.pipe(f.child.stdin);
  f.child.stdout.pipe(process.stdout);
  f.child.stderr.pipe(process.stderr);
  const stop = () => { f.runtime.terminate(); };
  process.stdin.once('end', stop);
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
