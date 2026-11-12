import json,sys,copy
from pathlib import Path

RULE = '- currentDiagnoses e currentActiveTherapies sono gia nella scheda: non sono fonti, non citarli come sourceId e non riproporli\n'

def source_schemas(schema):
    out=[]
    if isinstance(schema,dict):
        if isinstance(schema.get('properties'),dict) and 'sourceId' in schema['properties']:
            out.append(schema['properties']['sourceId'])
        for value in schema.values():out.extend(source_schemas(value))
    elif isinstance(schema,list):
        for value in schema:out.extend(source_schemas(value))
    return out

def canonical(schema):
    result=copy.deepcopy(schema)
    for field in source_schemas(result):field.clear();field.update({'type':'source-id-placeholder'})
    return result

def load(path):return [json.loads(x) for x in path.read_text().splitlines() if x.strip()]

main_dir,pr_dir=[Path(x) for x in sys.argv[1:3]]
main=load(main_dir/'cattura.jsonl');pr=load(pr_dir/'cattura.jsonl')
base={(r['patient'],r['round']):json.loads(r['request']) for r in main if r['attempt']==0}
checks=[]
for row in pr:
    req=json.loads(row['request']);prompt=req['messages'][0]['content']
    context=json.loads(prompt.split('CONTESTO STRUTTURATO:\n',1)[1]);ids=[x['id'] for x in context['sources']]
    fields=source_schemas(req['format']);assert len(fields)==4
    assert all(x=={'type':'string','enum':ids} for x in fields)
    reference=base[(row['patient'],row['round'])]
    assert canonical(req['format'])==canonical(reference['format'])
    assert prompt.replace(RULE,'')==reference['messages'][0]['content']
    assert req['options']['seed']==reference['options']['seed']+row['attempt']
    assert req['model']==reference['model'] and req['think']==reference['think']==False
    assert req['options']['temperature']==reference['options']['temperature']==0.4
    checks.append({'patient':row['patient'],'round':row['round'],'attempt':row['attempt'],'sourceIdEnums':4,'sameDocuments':True,'sameSeedStream':True,'onlyExpectedPromptAndSchemaChanges':True})
result={'mainAttempts':len(main),'prAttempts':len(pr),'checks':checks}
(pr_dir/'payload-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('Payload verificati:',len(checks),'con quattro enum corretti, stessi documenti e semi; solo modifiche attese a prompt/schema')
