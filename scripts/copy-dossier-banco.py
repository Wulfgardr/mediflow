"""Copia il solo banco sintetico indicato, senza modificarlo."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

source = Path(sys.argv[1])
target = Path('native/contracts/dossier-conformance')
documents = target / 'documents'
documents.mkdir(exist_ok=True)
rows = [json.loads(line) for line in (source / 'corpus/test.jsonl').read_text().splitlines()]
selected = [row for row in rows if row['id'].endswith(('-00', '-01'))]
assert len(selected) == 20
manifest = []
def copy(path, destination):
    shutil.copyfile(path, destination)
    manifest.append({'source': str(path.relative_to(source)), 'copy': str(destination.relative_to(target)), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()})
for row in selected:
    for suffix in ('.pdf', '.txt', '.gold.json'):
        copy(source / 'corpus/test' / (row['id'] + suffix), documents / (row['id'] + suffix))
copy(source / 'artifacts/mutations.json', target / 'mutations.json')
parser = [row for row in json.loads((source / 'raw/parser/results.json').read_text()) if row['repetition'] == 0 and row['id'] in {x['id'] for x in selected}]
(target / 'parser.json').write_text(json.dumps(parser, ensure_ascii=False, separators=(',', ':')))
# Una risposta completa per documento; solo output e provenienza, senza prompt duplicati o misure del modello.
candidates = []
responses = sorted((source / 'raw').glob('test-*/responses.jsonl'))
for index, row in enumerate(selected):
    options = []
    for response_path in responses:
        for line in response_path.read_text().splitlines():
            response = json.loads(line)
            if response['id'] != row['id']:
                continue
            text = response.get('response', {}).get('choices', [{}])[0].get('message', {}).get('content', '')
            try:
                extraction = json.loads(text)
                if extraction.get('schema') != 'mediflow.dossier_prepared_extraction.v1':
                    continue
            except (ValueError, AttributeError):
                continue
            facts = [f for s in extraction.get('sources', []) for f in s.get('facts', [])]
            if facts:
                options.append({'id': row['id'], 'source': str(response_path.relative_to(source)), 'extraction': extraction})
    assert options, row['id']
    candidates.append(options[index % len(options)])
(target / 'banco.json').write_text(json.dumps({'documents': selected, 'candidates': candidates}, ensure_ascii=False, separators=(',', ':')))
(target / 'provenance.json').write_text(json.dumps({'synthetic': True, 'selection': 'Due documenti (-00 e -01) per ciascuna delle dieci famiglie; una risposta con fatti per documento, in ordine lessicale dei run e indice modulo numero risposte valide. Parser repetition=0.', 'copies': manifest}, ensure_ascii=False, indent=2)+'\n')
print(f'Copiati {len(selected)} documenti, {len(candidates)} candidati e 10 falsificazioni')
