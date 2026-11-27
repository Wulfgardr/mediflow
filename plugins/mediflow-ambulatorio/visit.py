import calendar
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import textwrap

ODD = dict(zip('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', [1,0,5,7,9,13,15,17,19,21,1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23]))
CF_RE = re.compile(r'(?<![A-Z0-9])[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z](?![A-Z0-9])')


def checksum(s):
    return chr(65 + sum(ODD[c] if i % 2 == 0 else int(c) if c.isdigit() else ord(c)-65 for i,c in enumerate(s)) % 26)


def valid_cf(s):
    if not CF_RE.fullmatch(s) or checksum(s[:15]) != s[-1]:
        return False
    plain = ''.join(str('LMNPQRSTUV'.index(c)) if i in (6,7,9,10,12,13,14) and c in 'LMNPQRSTUV' else c for i,c in enumerate(s))
    day = int(plain[9:11])
    day = day - 40 if day > 40 else day
    month = 'ABCDEHLMPRST'.index(plain[8])+1
    return 1 <= day <= calendar.monthrange(2000 + int(plain[6:8]), month)[1]


def stamp():
    return dt.datetime.now().astimezone().isoformat()


def save(path, obj):
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.scrittura-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


CITIES = dict(zip(('Ancona Bari Como Domodossola Empoli Firenze Genova Hotel Imola Jolly Kappa Livorno Milano Napoli Otranto Palermo Quarto Roma Savona Torino Udine Venezia Washington Xilofono York Zara').upper().split(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'))
DIGITS = dict(zip('ZERO UNO DUE TRE QUATTRO CINQUE SEI SETTE OTTO NOVE'.split(), '0123456789'))


def normalize_cf(value):
    tokens = re.findall(r'[A-Z0-9]+', value.upper())
    return ''.join(CITIES.get(t, DIGITS.get(t, t)) for t in tokens)


def dictated_cf(text):
    tokens = re.findall(r'[A-Z0-9]+', text.upper())
    found = set()
    for start in range(len(tokens)):
        value = ''
        for token in tokens[start:start+16]:
            value += CITIES.get(token, DIGITS.get(token, token))
            if len(value) >= 16:
                if CF_RE.fullmatch(value):
                    found.add(value)
                break
    return found


def text_pdf(path, text, config):
    lines = [part for line in text.splitlines() for part in (textwrap.wrap(line, 88, replace_whitespace=False) or [''])]
    renderer = Path(__file__).resolve().parent / 'render-pdf.mjs'
    result = subprocess.run([config['node'], str(renderer)], input=json.dumps(lines).encode('utf-8'),
                            capture_output=True, timeout=30)
    if result.returncode or not result.stdout.startswith(b'%PDF-'):
        raise VisitError('PDF_NOTA_NON_GENERATO')
    path.write_bytes(result.stdout)


PDF_MAX = 8 * 1024 * 1024
DICTATION_MAX = 120000
NOTE_PDF = 'nota-visita.pdf'
DICTATION_PDF = 'trascrizione-visita.pdf'
PHYSICIAN = re.compile(r'CODICE\s+FISCALE\s+DEL\s+MEDICO\s*[:-]?\s*(' + CF_RE.pattern + ')')
PROPOSALS = {
    'document_entry': 'nota', 'therapy': 'terapia', 'service_prescription': 'prestazione',
    'exemption': 'esenzione', 'diagnosis': 'diagnosi',
}


class VisitError(Exception):
    pass


def regular(path, directory=False):
    entry = path.lstat()
    expected = stat.S_ISDIR if directory else stat.S_ISREG
    if not expected(entry.st_mode) or entry.st_uid != os.getuid() or stat.S_IMODE(entry.st_mode) != (0o700 if directory else 0o600):
        raise VisitError('VISIT_FILE_INVALID')
    if not directory and entry.st_nlink != 1:
        raise VisitError('VISIT_FILE_INVALID')
    return path


def read(path):
    return json.loads(regular(path).read_text())


def pdf_text(path):
    return subprocess.run(['pdftotext', '-layout', str(path), '-'], check=True,
                          capture_output=True, text=True, timeout=25).stdout


def roles(text, configured):
    normalized = text.upper()
    labels = {match.span(1) for match in PHYSICIAN.finditer(normalized)}
    occurrences = [match for match in CF_RE.finditer(normalized) if valid_cf(match[0])]
    patients = {match[0] for match in occurrences if match.span() not in labels and match[0] not in configured}
    return patients, {match[0] for match in occurrences} - patients


def collect(folder, manifest, scans, claimed, config):
    candidates = manifest['pdf']
    for source in sorted(scans.iterdir()):
        if source.suffix.lower() != '.pdf' or source.is_symlink():
            continue
        with os.fdopen(os.open(source, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or not manifest['from'] <= before.st_mtime <= manifest['until']:
                continue
            if before.st_size > PDF_MAX:
                manifest['avvisi'] = sorted(set(manifest['avvisi']) | {'PDF oltre il limite di dimensione: controllare l’originale.'})
                continue
            data = stream.read(PDF_MAX + 1)
            after = os.fstat(stream.fileno())
            if len(data) != before.st_size or (before.st_mtime_ns, before.st_ctime_ns) != (after.st_mtime_ns, after.st_ctime_ns):
                raise VisitError('PDF_IN_MODIFICA')
        digest = hashlib.sha256(data).hexdigest()
        if digest in candidates:
            continue
        path = folder / (digest + '.pdf')
        if path.exists() or path.is_symlink():
            regular(path).unlink()
        with path.open('xb') as output:
            output.write(data)
        try:
            text = pdf_text(path)
        except subprocess.SubprocessError:
            text = ''
        patients, doctors = roles(text, config['physicianCodes'])
        candidates[digest] = {'patients': sorted(patients), 'doctors': sorted(doctors)}

    doctors = set(config['physicianCodes']).union(*(set(item['doctors']) for item in candidates.values()))
    cf = manifest['cf']
    if cf in doctors:
        manifest.update(cf=None, cf_origine=None)
        cf = None
        manifest['avvisi'] = sorted(set(manifest['avvisi']) | {'Il CF indicato compare come CF del medico. Verifica il CF del paziente.'})
    possible = set().union(*(set(item['patients']) for item in candidates.values())) - doctors
    manifest['cf_proposto'] = next(iter(possible)) if cf is None and len(possible) == 1 else None
    manifest['pdf_accettati'] = [digest for digest, item in candidates.items() if cf and item['patients'] == [cf] and digest not in claimed]
    save(folder / 'manifest.json', manifest)


def view(folder, manifest):
    result = {key: manifest[key] for key in ('cf_origine', 'cf_proposto', 'avvisi')}
    cf = manifest['cf']
    accepted = manifest['pdf_accettati']
    documents = []
    for digest in accepted:
        file = digest + '.pdf'
        path = regular(folder / file)
        if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
            raise VisitError('PDF_IDENTITA_O_HASH')
        text = pdf_text(path)
        documents.append({'file': file, 'testo': text[:25000], 'testo_troncato': len(text) > 25000})
    result.update(visitId=folder.name, stato='CF da confermare' if cf is None else 'CF stabilito',
                  ultime_4=cf[-4:] if cf else None,
                  pdf_esclusi=len(manifest['pdf']) - len(accepted) if cf else 0,
                  pdf_accettati=documents)
    return result


def verify(folder, cf, extraction, config, transcript):
    files = []
    for source in extraction['sources']:
        path = regular(folder / source['fileName'])
        content = path.read_bytes()
        files.append(dict(sha256=hashlib.sha256(content).hexdigest(), text=pdf_text(path)))
    payload = dict(cf=cf, extraction=extraction, files=files, physicianCodes=config['physicianCodes'], transcript=transcript)
    args = [config['node'], str(Path(config['repository']) / 'scripts/run-strip-types.mjs'),
            str(Path(__file__).resolve().parent / 'verify.mjs'), config['repository']]
    result = subprocess.run(args, input=json.dumps(payload), capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise VisitError('DOSSIER_VERIFICA_FALLITA')
    return json.loads(result.stdout)


def source(path, cf, date, facts):
    return dict(sha256=hashlib.sha256(path.read_bytes()).hexdigest(), fileName=path.name,
                patient=dict(taxCode=cf), documentDate=date,
                documentType='visita_specialistica' if path.name == NOTE_PDF else 'altro',
                facts=facts, coverage=dict(pages=None, unreadablePages=[], complete=False, note='Originale da rivedere dal medico'))


def versioned_dictation(folder, manifest):
    original = regular(folder / 'trascrizione.txt').read_bytes()
    if hashlib.sha256(original).hexdigest() != manifest['dettatoSha256']:
        raise VisitError('TRASCRIZIONE_MODIFICATA')
    passages = [original.decode('utf-8')]
    passages.extend(f"Correzione dettata dal medico ({entry['ora']})\n{entry['testo']}" for entry in manifest.get('correzioni', []))
    return '\n\n'.join(passages)


def append_correction(folder, manifest, correction):
    previous = manifest.get('correzioni', [])
    if not previous or previous[-1]['testo'] != correction:
        version = {**manifest, 'correzioni': [*previous, {'ora': stamp(), 'testo': correction}], 'dossier': None}
        if len(versioned_dictation(folder, version)) > DICTATION_MAX:
            raise VisitError('TRASCRIZIONE_TROPPO_LUNGA')
        save(folder / 'manifest.json', version)
        previous = version['correzioni']
    return {'visitId': folder.name, 'stato': 'correzione_salvata', 'revisione': len(previous)}


def build(folder, manifest, config, args):
    cf = manifest['cf']
    if not cf:
        raise VisitError('CF_DA_CONFERMARE')
    sheet = args['scheda']
    match = re.search(r'^## Nota clinica\s*\n(.*?)(?=^## |\Z)', sheet, re.M | re.S)
    note = match.group(1).strip() if match else ''
    if not note or len(note) >= 12000 or not all(re.search(r'^' + label + ':', note, re.M) for label in 'SOAP') or re.search(r'^## Correzioni', sheet, re.M):
        raise VisitError('NOTA_SOAP_INCOMPLETA')
    transcript = versioned_dictation(folder, manifest)
    date = manifest['date']
    with tempfile.TemporaryDirectory(prefix='.dossier-', dir=folder) as temporary:
        stage = Path(temporary)
        documents = {}
        texts = {DICTATION_PDF: transcript}
        for digest in manifest['pdf_accettati']:
            filename = digest + '.pdf'
            original = regular(folder / filename)
            data = original.read_bytes()
            text = pdf_text(original)
            if hashlib.sha256(data).hexdigest() != digest or roles(text, config['physicianCodes'])[0] != {cf}:
                raise VisitError('PDF_IDENTITA_O_HASH')
            (stage / filename).write_bytes(data)
            documents[filename] = source(stage / filename, cf, None, [])
            texts[filename] = text
        facts = []
        for fact in args['fatti']:
            filename = DICTATION_PDF if fact['file'] == NOTE_PDF else fact['file']
            quote = fact['quote']
            if filename not in texts or quote not in texts[filename]:
                raise VisitError('CITAZIONE_NON_PRESENTE')
            if fact['kind'] == 'diagnosis' and fact['values'].get('code') and fact['values']['code'] not in transcript:
                raise VisitError('CODICE_DIAGNOSI_NON_DETTATO')
            facts.append({**fact, 'file': filename})
        header = f'Codice fiscale paziente: {cf}\nData visita: {date}\n\n'
        text_pdf(stage / NOTE_PDF, header + note, config)
        documents[NOTE_PDF] = source(stage / NOTE_PDF, cf, date, [
            dict(kind='document_entry', values=dict(text=note, date=date), quote=note[:600])])
        identity = args.get('identita', {})
        documents[NOTE_PDF]['patient'].update({field: identity[key] for key, field in [('nome', 'firstName'), ('cognome', 'lastName')] if key in identity})
        if any(fact['file'] == DICTATION_PDF for fact in facts):
            text_pdf(stage / DICTATION_PDF, header + transcript, config)
            documents[DICTATION_PDF] = source(stage / DICTATION_PDF, cf, date, [])
        for fact in facts:
            documents[fact['file']]['facts'].append({key: fact[key] for key in ('kind', 'values', 'quote')})
        extraction = dict(schema='mediflow.dossier_prepared_extraction.v1', preparedAt=stamp(), preparedBy='MediFlow Ambulatorio',
                          sources=list(documents.values()))
        checked = verify(stage, cf, extraction, config, transcript)
        (stage / 'trascrizione.txt').write_bytes(transcript.encode('utf-8'))
        save(stage / 'estrazione-preparata.json', extraction)
        save(stage / 'fatti-dossier.json', facts)
        (stage / 'scheda-inserimento.md').write_text(sheet)
        save(stage / 'verifica.json', checked)
        fingerprint = hashlib.sha256((stage / 'estrazione-preparata.json').read_bytes()).hexdigest()
        stage.rename(folder / ('dossier-' + fingerprint))
        manifest['dossier'] = fingerprint
        save(folder / 'manifest.json', manifest)
        return {**checked, 'visitId': folder.name, 'stato': 'verificato'}


def prepare_deposit(folder, manifest, config):
    if not manifest['cf'] or not manifest['dossier']:
        raise VisitError('DOSSIER_NON_VERIFICATO')
    stage = regular(folder / ('dossier-' + manifest['dossier']), directory=True)
    file = regular(stage / 'estrazione-preparata.json')
    if hashlib.sha256(file.read_bytes()).hexdigest() != manifest['dossier']:
        raise VisitError('DOSSIER_MODIFICATO')
    extraction = read(file)
    if any(source['fileName'] == NOTE_PDF and any(fact['kind'] != 'document_entry' for fact in source['facts'])
           for source in extraction['sources']):
        raise VisitError('DOSSIER_DA_RIGENERARE')
    transcript = versioned_dictation(folder, manifest)
    snapshot = stage / 'trascrizione.txt'
    if not snapshot.exists() and not snapshot.is_symlink() and not manifest.get('correzioni'):
        snapshot = folder / 'trascrizione.txt'
    if regular(snapshot).read_bytes() != transcript.encode('utf-8'):
        raise VisitError('TRASCRIZIONE_MODIFICATA')
    verify(stage, manifest['cf'], extraction, config, transcript)
    manifest['frozen'] = True
    save(folder / 'manifest.json', manifest)
    proposals = [{'tipo': PROPOSALS[fact['kind']], 'fonte': source['fileName']}
                 for source in extraction['sources'] for fact in source['facts'] if fact['kind'] in PROPOSALS]
    return dict(extraction=str(file), fiscalCode=manifest['cf'],
                transcription=str(snapshot), proposals=proposals)


def run(root, config, action, args):
    now = dt.datetime.now().astimezone()
    timestamp = now.timestamp()
    today = now.date().isoformat()
    if action == 'acquire':
        transcript = args['dettato']
        opened = args.get('inizio')
        start = dt.datetime.fromisoformat(opened).timestamp() if opened else None
        if start is not None and start > timestamp:
            raise VisitError('FINESTRA_PDF_NON_VALIDA')
        rows = []
        for path in root.glob('*/manifest.json'):
            regular(path.parent, directory=True)
            row = read(path)
            if row['date'] == today:
                rows.append(row)
        identity = hashlib.sha256(transcript.encode()).hexdigest()
        existing = next((row for row in rows if row['dettatoSha256'] == identity), None)
        if existing:
            folder = regular(root / existing['id'], directory=True)
            if existing.get('raccolta_completa') or existing['frozen']:
                return view(folder, existing)
            manifest = existing
        else:
            folder = root / args['visitId']
            folder.mkdir(mode=0o700)
            codes = dictated_cf(transcript)
            cf = next(iter(codes)) if len(codes) == 1 else None
            invalid = cf is not None and not valid_cf(cf)
            if invalid:
                cf = None
            warnings = []
            if invalid:
                warnings.append('CF dettato non valido. Verifica l’identità del paziente.')
            if len(codes) > 1:
                warnings.append('Più CF nel dettato. Conferma il CF del paziente.')
            default = max((row['closed'] for row in rows), default=now.replace(hour=7, minute=0, second=0, microsecond=0).timestamp())
            manifest = {'id': folder.name, 'date': today, 'from': default if start is None else start, 'closed': timestamp, 'until': timestamp,
                        'cf': cf, 'cf_origine': 'dettato valido' if cf else None, 'cf_proposto': None, 'pdf': {}, 'pdf_accettati': [],
                        'frozen': False, 'dossier': None, 'dettatoSha256': identity,
                        'avvisi': warnings}
            with (folder / 'trascrizione.txt').open('x') as output:
                output.write(transcript)
                output.flush()
                os.fsync(output.fileno())
            save(folder / 'manifest.json', manifest)
    else:
        folder = regular(root / args['visitId'], directory=True)
        manifest = read(folder / 'manifest.json')
        if action == 'deposit':
            return prepare_deposit(folder, manifest, config)
        if manifest['frozen']:
            raise VisitError('DEPOSITO_GIA_AVVIATO')
        if action == 'prepare':
            return build(folder, manifest, config, args)
        if action == 'correct':
            return append_correction(folder, manifest, args['correzione'])
        if args.get('conferma'):
            cf = normalize_cf(args['conferma'])
            if not valid_cf(cf) or manifest['cf'] not in (None, cf) or cf in config['physicianCodes'] or any(cf in item['doctors'] for item in manifest['pdf'].values()):
                raise VisitError('CF_CONFERMATO_NON_VALIDO_O_DISCORDANTE')
            manifest.update(cf=cf, cf_origine='confermato dal medico')
        manifest.update(until=timestamp, dossier=None)
    claimed = set()
    for path in root.glob('*/manifest.json'):
        regular(path.parent, directory=True)
        if path.parent != folder:
            row = read(path)
            if row['date'] == manifest['date']:
                claimed.update(row['pdf_accettati'])
    collect(folder, manifest, Path(config['downloads']), claimed, config)
    manifest['raccolta_completa'] = True
    save(folder / 'manifest.json', manifest)
    return view(folder, manifest)


os.umask(0o077)
try:
    request = json.load(sys.stdin)
    root = regular(Path(request['root']), directory=True)
    lock = os.open(root / '.lock', os.O_CREAT | os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    with os.fdopen(lock, 'rb') as handle:
        fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
        result = run(root, request['config'], request['action'], request['args'])
    print(json.dumps(result))
except VisitError as error:
    print(json.dumps({'error': str(error)}))
except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
    print(json.dumps({'error': 'VISITA_NON_DISPONIBILE'}))
