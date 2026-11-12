import importlib.util
import sys
from pathlib import Path

module_path = Path(sys.argv[1])
spec = importlib.util.spec_from_file_location('classificatore', module_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
item = {'label': 'Ipercolesterolemia pura', 'icdQuery': 'Pure hypercholesterolaemia',
        'sourceId': 'source.local.00000000001.04', 'evidence': 'colesterolo LDL 162 mg/dL.'}
source = next(s for s in module.CASES['P1']['projection']['sources'] if s['id'] == item['sourceId'])
assert module.norm(item['evidence']) in module.norm(source['content'])
actual = module.classify(module.CASES['P1'], {'diagnoses': [item]})[0]['state']
assert actual == 'letterale', f'Excerpt letterale nella fonte: atteso letterale, osservato {actual}'
print('PASS: la provenienza letterale non diventa errata per il solo nome della diagnosi')
