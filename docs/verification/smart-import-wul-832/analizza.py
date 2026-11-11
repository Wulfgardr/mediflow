import json
import re
import sys
import unicodedata
from pathlib import Path
from collections import Counter

HERE = Path(__file__).parent
CORPUS = json.loads((HERE / 'corpus.json').read_text())
CASES = {c['id']: c for c in CORPUS['cases']}


def norm(value):
    value = unicodedata.normalize('NFKD', str(value or '')).casefold()
    return ' '.join(re.findall(r'[a-z0-9]+', value))


def match(pattern, value):
    return bool(re.search(pattern, str(value or ''), re.I))


def items(data):
    for key in ('diagnoses', 'therapies', 'servicePrescriptions'):
        for i, item in enumerate(data.get(key, []) or []):
            if not isinstance(item, dict):
                continue
            yield f'{key}.{i}', item
            if key == 'servicePrescriptions':
                for j, child in enumerate(item.get('items', []) or []):
                    if isinstance(child, dict):
                        yield f'{key}.{i}.items.{j}', child


def classify(case, data):
    sources = {s['id']: s['content'] for s in case['projection']['sources']}
    out = []
    for location, item in items(data):
        sid = item.get('sourceId')
        evidence = norm(item.get('evidence'))
        content = sources.get(sid, '')
        found = bool(evidence and evidence in norm(content))
        reasons = []
        if sid not in sources:
            reasons.append('id_inesistente')
        elif not found and evidence and any(evidence in norm(c) for k, c in sources.items() if k != sid):
            reasons.append('excerpt_di_altra_fonte')
        if location.startswith('diagnoses.'):
            label = str(item.get('label', '')) + ' ' + str(item.get('icdQuery', ''))
            for expected in case['expected']:
                if match(expected['pattern'], label) and sid not in expected['sourceIds']:
                    reasons.append('diagnosi_nuova_fonte_errata')
            for pattern in case['recordPatterns']:
                if match(pattern, label) and not match(pattern, content):
                    reasons.append('diagnosi_della_scheda_senza_riscontro')
        state = 'sbagliata' if reasons else 'letterale' if found else 'non_risolta'
        out.append({'location': location, 'state': state, 'reasons': reasons, 'item': item})
    return out


def novel(case, data):
    labels = [' '.join(str(d.get(k, '')) for k in ('label', 'icdQuery')) for d in data.get('diagnoses', []) or []]
    return [e['id'] for e in case['expected'] if any(match(e['pattern'], label) for label in labels)]


def selfcheck():
    case = CASES['P5']
    valid = {'label': 'Fibrillazione atriale', 'icdQuery': 'atrial fibrillation', 'sourceId': 'source.synthetic.p5.01', 'evidence': 'Diagnosi attuale: fibrillazione atriale persistente'}
    assert classify(case, {'diagnoses': [valid]})[0]['state'] == 'letterale'
    assert novel(case, {'diagnoses': [valid, valid]}) == ['fibrillazione_atriale']
    assert classify(case, {'diagnoses': [dict(valid, sourceId='inventata')]})[0]['state'] == 'sbagliata'
    assert classify(case, {'diagnoses': [dict(valid, sourceId='source.synthetic.p5.02')]})[0]['state'] == 'sbagliata'
    assert classify(case, {'diagnoses': [{'label': 'Ipertensione essenziale', 'sourceId': 'source.synthetic.p5.01', 'evidence': 'Ipertensione essenziale (I10)'}]})[0]['state'] == 'sbagliata'
    assert classify(case, {'therapies': [{'sourceId': 'source.synthetic.p5.02', 'evidence': 'Prosegue losartan 50 mg al mattino'}]})[0]['state'] == 'letterale'
    assert classify(case, {'therapies': [{'sourceId': 'source.synthetic.p5.01', 'evidence': 'Prosegue losartan 50 mg al mattino'}]})[0]['state'] == 'sbagliata'
    assert classify(case, {'therapies': [{'sourceId': 'source.synthetic.p5.02', 'evidence': 'Assume abitualmente losartan'}]})[0]['state'] == 'non_risolta'
    assert novel(case, {}) == []
    assert norm('Hb 10,2 g/dL') == norm('HB 10,2 g/dl.')


def readlines(path):
    return [json.loads(s) for s in path.read_text().splitlines() if s.strip()]


def analyze(directory):
    metadata = json.loads((directory / 'metadata.json').read_text())
    results = readlines(directory / 'results.jsonl')
    captures = readlines(directory / 'cattura.jsonl')
    details = []
    stats = {}
    for pid, case in CASES.items():
        rows = [r for r in results if r['patient'] == pid]
        raw = [r for r in captures if r['patient'] == pid]
        count = Counter(requests=len(rows), opportunities=len(rows)*len(case['expected']), attempts=len(raw))
        rounds = []
        for row in rows:
            result = row['result']
            success = result['status'] == 'available' and result['proposal'] is not None and result['writesPerformed'] == 0 and result['apply'] == 'denied'
            count['successful'] += success
            count['provider_failed'] += result['code'] == 'provider_failed'
            if not success:
                count['failure_' + str(result['code'])] += 1
            proposal = result['proposal'] if success else {}
            new = novel(case, proposal)
            count['new'] += len(new)
            classified = classify(case, proposal)
            for c in classified:
                count['visible_' + c['state']] += 1
                if c['state'] != 'letterale':
                    details.append({'stage': 'visible', 'patient': pid, 'round': row['round'], **c})
            rounds.append({'round': row['round'], 'new': new, 'success': bool(success)})
        for row in raw:
            try:
                response = json.loads(row['response'])
                payload = json.loads(response.get('message', {}).get('content', ''))
            except (ValueError, TypeError):
                count['unparseable_attempts'] += 1
                continue
            data = payload.get('data', {})
            count['raw_new'] += len(novel(case, data))
            for c in classify(case, data):
                count['raw_' + c['state']] += 1
                if c['state'] != 'letterale':
                    details.append({'stage': 'raw', 'patient': pid, 'round': row['round'], 'attempt': row['attempt'], **c})
        stats[pid] = dict(count, rounds=rounds)
    total = Counter()
    for data in stats.values():
        total.update({k: v for k, v in data.items() if isinstance(v, int)})
    (directory / 'classification.jsonl').write_text(''.join(json.dumps(x, ensure_ascii=False) + '\n' for x in details))
    return {'metadata': metadata, 'patients': stats, 'total': dict(total)}


selfcheck()
if __name__ == '__main__':
    dirs = [Path(s) for s in sys.argv[1:]]
    if not dirs:
        print('Controlli del classificatore: verdi')
        sys.exit(0)
    analyzed = [analyze(d) for d in dirs]
    for directory, result in zip(dirs, analyzed):
        (directory / 'summary.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'arm': result['metadata']['arm'], 'total': result['total']}, ensure_ascii=False))
    if len(analyzed) > 1:
        baseline = analyzed[0]['total']
        for result in analyzed[1:]:
            current = result['total']
            complete = baseline['requests'] == current['requests'] == 100
            faults = baseline.get('provider_failed', 0) + current.get('provider_failed', 0)
            sources = current.get('raw_sbagliata', 0) < baseline.get('raw_sbagliata', 0)
            bvis, cvis = baseline.get('visible_sbagliata', 0), current.get('visible_sbagliata', 0)
            visible = cvis < bvis if bvis > 0 else cvis == 0
            recall = baseline.get('new', 0) > 0 and 3 * current.get('new', 0) >= 2 * baseline['new']
            print(json.dumps({'arm': result['metadata']['arm'], 'decisionPass': complete and faults == 0 and sources and visible and recall, 'complete': complete, 'providerFaults': faults, 'rawSourcesImprove': sources, 'visibleSourcesImproveOrStayZero': visible, 'recallRetained': recall, 'newRatio': current.get('new', 0)/baseline['new'] if baseline.get('new') else None}, ensure_ascii=False))
