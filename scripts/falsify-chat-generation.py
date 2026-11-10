#!/usr/bin/env python3
"""Falsifica i varchi generativi sul codice prodotto e ripristina sempre i sorgenti."""
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / 'experiments/gpui-patient-pilot/app/src/shell/generation.rs'
ORIGINAL = SOURCE.read_text()


def replace_once(source, before, after):
    if source.count(before) != 1:
        raise RuntimeError(f'Mutazione non applicabile: {before}')
    return source.replace(before, after, 1)


def gate(source, method):
    start = source.index(f'fn {method}(')
    end = source.index('\n    }', start)
    return source[:start] + replace_once(source[start:end], 'if self.chat_withdrawn()', 'if false') + source[end:]


mutations = [
    ('M1', lambda s: gate(s, 'start'), ['chat_withdrawn_before_consent_sends_nothing', 'revocation_before_consent_and_after_a_second_choice_sends_nothing', 'import_revocation_before_consent_sends_nothing']),
    ('M2', lambda s: gate(s, 'take_running'), ['late_answer_after_chat_revocation_is_not_shown', 'import_late_answer_after_chat_revocation_is_not_shown']),
    ('M3a', lambda s: replace_once(s, 'GenerationPhase::Idle\n                | GenerationPhase::Checking', 'GenerationPhase::Checking'), ['idle_document_choice_and_empty_list_remain_owned_until_revocation', 'idle_import_and_empty_chart_remain_owned_until_revocation']),
    ('M3b', lambda s: replace_once(s, '        if !matches!(\n            self.phase,', '        if false && !matches!(\n            self.phase,'), ['chat_waits_for_native_document_choice_and_consent', 'chat_import_waits_for_native_preparation_and_consent']),
    ('M4', lambda s: replace_once(s, '        self.replace(phase);', '        #[cfg(unix)]\n        { self.chat.0 = None; }\n        self.replace(phase);'), ['choices_keep_the_same_chat_hold', 'import_revocation_before_consent_sends_nothing']),
]

env = dict(os.environ, CARGO_BUILD_JOBS='2', RUST_TEST_THREADS='1')
if not env.get('CARGO_TARGET_DIR') or not env.get('MEDIFLOW_DATA_DIR'):
    raise SystemExit('Servono CARGO_TARGET_DIR proprio e MEDIFLOW_DATA_DIR sintetica esplicita.')
env['MEDIFLOW_E2E_DISABLE_LEGACY_COPY'] = '1'
command = ['nice', '-n', '10', 'cargo', 'test', '--manifest-path', 'experiments/gpui-patient-pilot/Cargo.toml', '--locked', '-p', 'mediflow-gpui-patient-pilot', '--']

try:
    for name, mutate, tests in mutations:
        SOURCE.write_text(mutate(ORIGINAL))
        run = subprocess.run(command + tests + ['--test-threads=1'], cwd=ROOT, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        failures = [line.strip() for line in run.stdout.splitlines() if line.startswith('test ') and line.endswith(' ... FAILED')]
        if run.returncode != 101 or not failures or 'error[E' in run.stdout:
            print(run.stdout, flush=True)
            raise SystemExit(f'{name}: non dimostrata una failure di asserzione nei test selezionati')
        # Ogni test elencato deve cadere: un filtro che resta verde non prova nulla.
        silent = [test for test in tests if not any(test in failure for failure in failures)]
        if silent:
            print(run.stdout, flush=True)
            raise SystemExit(f'{name}: restano verdi {silent}')
        print(f'{name}: ROSSO ({"; ".join(failures)})', flush=True)
finally:
    SOURCE.write_text(ORIGINAL)
