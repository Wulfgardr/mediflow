"""Bounded CLI comparison. All products and logs stay in the trial directory."""
from pathlib import Path
import datetime
import hashlib
import json
import os
import platform
import resource
import shutil
import signal
import statistics
import sys
import time
import traceback

TRIAL = Path(__file__).resolve().parent
SOURCE = TRIAL / 'source'
NODE = str(Path(shutil.which('node')).resolve())
COMMON = ['-p', 'tsconfig.typecheck.json', '--noEmit', '--incremental', 'false', '--pretty', 'false']
ENGINES = {
    'typescript-5.9.3': [NODE, str(SOURCE / 'node_modules/typescript/lib/tsc.js')],
    'tsc-ts-0.0.2': [str(TRIAL / 'tsc-ts-install/node_modules/@tsc-ts/linux-x64-gnu/lib/tsc-ts')],
    'typescript-7.0.2': [str(TRIAL / 'ts7-install/node_modules/@typescript/typescript-linux-x64/lib/tsc')],
}
NATIVE_LIBS = {name: Path(command[0]).parent for name, command in ENGINES.items() if name != 'typescript-5.9.3'}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def file_record(path):
    path = Path(path)
    data = path.read_bytes()
    return {'path': str(path), 'bytes': len(data), 'sha256': digest(data)}

def save(name, value):
    (TRIAL / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def run_process(name, command, timeout=60):
    stdout = TRIAL / (name + '.stdout.log')
    stderr = TRIAL / (name + '.stderr.log')
    started = time.monotonic()
    pid = os.fork()
    if pid == 0:
        try:
            os.setsid()
            resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
            os.chdir(SOURCE)
            with open('/dev/null', 'rb') as incoming, stdout.open('wb') as outgoing, stderr.open('wb') as errors:
                os.dup2(incoming.fileno(), 0)
                os.dup2(outgoing.fileno(), 1)
                os.dup2(errors.fileno(), 2)
            os.execv(command[0], command)
        except BaseException:
            traceback.print_exc()
            os._exit(127)
    timed_out = False
    while True:
        ended, status, usage = os.wait4(pid, os.WNOHANG)
        if ended:
            break
        if time.monotonic() - started > timeout:
            timed_out = True
            os.killpg(pid, signal.SIGKILL)
            ended, status, usage = os.wait4(pid, 0)
            break
        time.sleep(0.02)
    return {
        'name': name, 'command': command, 'exitCode': os.waitstatus_to_exitcode(status),
        'timedOut': timed_out, 'elapsedSeconds': round(time.monotonic() - started, 6),
        'userSeconds': usage.ru_utime, 'systemSeconds': usage.ru_stime,
        'maxRssKiB': usage.ru_maxrss, 'stdout': file_record(stdout), 'stderr': file_record(stderr),
    }

def require_success(run):
    if run['exitCode'] != 0 or run['timedOut']:
        raise RuntimeError('Command failed: ' + run['name'])

def normalize_graph(lines, lib):
    normalized = []
    for line in lines:
        path = Path(line)
        if path.parent == lib and path.name.startswith('lib') and path.name.endswith('.d.ts'):
            normalized.append('<compiler-standard-lib>/' + path.name)
        else:
            normalized.append(line)
    return normalized

def prepare():
    preflight = {}
    roots = {}
    graphs = {}
    for engine, command in ENGINES.items():
        version = run_process(engine + '-version', command + ['--version'])
        require_success(version)
        shown = run_process(engine + '-show-config', command + COMMON + ['--showConfig'])
        require_success(shown)
        listed = run_process(engine + '-list-files', command + COMMON + ['--listFilesOnly'])
        require_success(listed)
        configuration = json.loads(Path(shown['stdout']['path']).read_text())
        roots[engine] = configuration['files']
        graph = Path(listed['stdout']['path']).read_text().splitlines()
        if not all(Path(name).is_absolute() and Path(name).is_file() for name in graph):
            raise RuntimeError('Unexpected graph output: ' + engine)
        graphs[engine] = graph
        preflight[engine] = {
            'version': Path(version['stdout']['path']).read_text().strip(),
            'versionRun': version, 'showConfigRun': shown, 'listFilesRun': listed,
            'rootFileCount': len(roots[engine]), 'rootFilesSha256': digest(('\n'.join(roots[engine])+'\n').encode()),
            'resolvedFileCount': len(graph), 'commandPrefix': command,
            'engine': file_record(command[-1]),
        }
    preflight['typescript-5.9.3']['nodeExecutable'] = file_record(NODE)
    preflight['typescript-5.9.3']['implementationBehindCacheShim'] = file_record(SOURCE / 'node_modules/typescript/lib/_tsc.js')
    standard = {}
    native_graphs = {}
    for engine, lib in NATIVE_LIBS.items():
        standard[engine] = [{'name': p.name, 'bytes': p.stat().st_size, 'sha256': digest(p.read_bytes())} for p in sorted(lib.glob('lib*.d.ts'))]
        native_graphs[engine] = normalize_graph(graphs[engine], lib)
        (TRIAL / (engine + '-normalized-graph.txt')).write_text('\n'.join(native_graphs[engine]) + '\n')
    native_names = list(NATIVE_LIBS)
    same_roots = all(roots[name] == roots[native_names[0]] for name in roots)
    graph_equal = native_graphs[native_names[0]] == native_graphs[native_names[1]]
    standard_maps = {name: {entry['name']: entry for entry in entries} for name, entries in standard.items()}
    shared_library_names = set(standard_maps[native_names[0]]) & set(standard_maps[native_names[1]])
    shared_libraries_equal = all(standard_maps[native_names[0]][name] == standard_maps[native_names[1]][name] for name in shared_library_names)
    included_library_names = {Path(name).name for name in native_graphs[native_names[0]] if name.startswith('<compiler-standard-lib>/')}
    included_libraries_equal = all(name in shared_library_names and standard_maps[native_names[0]][name] == standard_maps[native_names[1]][name] for name in included_library_names)
    if not same_roots or not graph_equal or not included_libraries_equal:
        raise RuntimeError('Input or standard-library comparison differs; inspect before any timing claim')
    input_paths = sorted(set(graphs['typescript-5.9.3']) | {str(SOURCE / name) for name in ['tsconfig.json','tsconfig.typecheck.json','package.json','package-lock.json']})
    manifest = [file_record(path) for path in input_paths]
    save('input-manifest-before.json', manifest)
    save('standard-library-manifests.json', standard)
    save('root-files.json', roots)
    save('preflight.json', preflight)
    graph_summary = {
        'allThreeRootListsEqual': same_roots,
        'rootCount': len(roots[native_names[0]]),
        'ts7OrderedGraphsEqual': graph_equal,
        'ts7GraphSetsEqual': set(native_graphs[native_names[0]]) == set(native_graphs[native_names[1]]),
        'normalization': 'Only the respective native compiler lib directory prefix on lib*.d.ts paths is replaced with <compiler-standard-lib>/. Other file paths are unchanged.',
        'ts7ResolvedFileCount': len(native_graphs[native_names[0]]),
        'ts7IncludedStandardLibraries': sum(name.startswith('<compiler-standard-lib>/') for name in native_graphs[native_names[0]]),
        'ts7StandardLibrariesAvailable': {name: len(entries) for name, entries in standard.items()},
        'ts7StandardLibraryManifestsByteEqual': standard[native_names[0]] == standard[native_names[1]],
        'ts7SharedStandardLibraries': len(shared_library_names),
        'ts7SharedStandardLibrariesByteEqual': shared_libraries_equal,
        'ts7IncludedStandardLibrariesByteEqual': included_libraries_equal,
        'additionalStandardLibrariesOutsideSharedSet': {name: sorted(set(entries) - shared_library_names) for name, entries in standard_maps.items()},
        'availableLibraryDifferenceScope': 'The official package has an extra lib.d.ts which is absent from both resolved graphs for this tsconfig. The measured graphs and their 89 included standard libraries agree.',
        'normalizedGraph': file_record(TRIAL / (native_names[0] + '-normalized-graph.txt')),
        'normalizedReferenceGraph': file_record(TRIAL / (native_names[1] + '-normalized-graph.txt')),
        'ts5ResolvedFileCount': len(graphs['typescript-5.9.3']),
        'fullInputManifestCount': len(manifest),
        'inputManifestBefore': file_record(TRIAL / 'input-manifest-before.json'),
        'rootFilesManifest': file_record(TRIAL / 'root-files.json'),
        'standardLibraryManifests': file_record(TRIAL / 'standard-library-manifests.json'),
    }
    save('graph-comparison.json', graph_summary)
    print(json.dumps({'preflight': 'PASS', 'versions': {name: result['version'] for name, result in preflight.items()}, 'graphs': graph_summary}), flush=True)

def validate_inputs(manifest):
    for record in manifest:
        actual = file_record(record['path'])
        if actual != record:
            raise RuntimeError('Input changed: ' + record['path'])

def measure():
    manifest = json.loads((TRIAL / 'input-manifest-before.json').read_text())
    validate_inputs(manifest)
    preflight = json.loads((TRIAL / 'preflight.json').read_text())
    for engine in preflight.values():
        validate_inputs([engine['engine']])
    orders = [
        ['typescript-5.9.3','tsc-ts-0.0.2','typescript-7.0.2'],
        ['typescript-7.0.2','typescript-5.9.3','tsc-ts-0.0.2'],
        ['tsc-ts-0.0.2','typescript-7.0.2','typescript-5.9.3'],
    ]
    environment = {
        'timestampUtc': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'osRelease': platform.platform(), 'kernel': platform.release(), 'architecture': platform.machine(),
        'glibc': platform.libc_ver(), 'nodeExecutable': NODE,
        'logicalCpuCount': os.cpu_count(), 'cpuAffinity': sorted(os.sched_getaffinity(0)),
        'cpuMax': Path('/sys/fs/cgroup/cpu.max').read_text().strip(),
        'memoryMax': Path('/sys/fs/cgroup/memory.max').read_text().strip(),
        'cpuModel': next((line.split(':',1)[1].strip() for line in Path('/proc/cpuinfo').read_text().splitlines() if line.startswith('model name')), None),
        'nodeCompileCacheOverride': os.environ.get('NODE_COMPILE_CACHE'),
        'nodeDisableCompileCacheOverride': os.environ.get('NODE_DISABLE_COMPILE_CACHE'),
        'goMaxProcsOverride': os.environ.get('GOMAXPROCS'),
        'tscTsLibDirOverride': os.environ.get('TSC_TS_LIB_DIR'),
        'tscTsCheckersOverride': os.environ.get('TSC_TS_CHECKERS'),
    }
    save('measurement-environment.json', environment)
    samples = []
    started = time.monotonic()
    for round_index, order in enumerate(orders, start=1):
        for engine in order:
            remaining = 180 - (time.monotonic() - started)
            if remaining < 2:
                raise RuntimeError('Global 180 second budget exhausted')
            result = run_process(f'round-{round_index}-{engine}', ENGINES[engine] + COMMON, timeout=min(60,remaining))
            result['engine'] = engine
            result['round'] = round_index
            result['positionInRound'] = order.index(engine) + 1
            result['diagnosticCount'] = sum('error TS' in line for stream in ['stdout','stderr'] for line in Path(result[stream]['path']).read_text().splitlines())
            samples.append(result)
            save('measurement-samples.json', samples)
            print(json.dumps(result), flush=True)
            require_success(result)
            if result['diagnosticCount'] or result['stdout']['bytes'] or result['stderr']['bytes']:
                raise RuntimeError('Unexpected compiler output: ' + result['name'])
    elapsed = time.monotonic() - started
    validate_inputs(manifest)
    save('input-manifest-after.json', [file_record(entry['path']) for entry in manifest])
    standard = json.loads((TRIAL / 'standard-library-manifests.json').read_text())
    for engine, entries in standard.items():
        for entry in entries:
            path = NATIVE_LIBS[engine] / entry['name']
            if digest(path.read_bytes()) != entry['sha256']:
                raise RuntimeError('Standard library changed: ' + str(path))
    summary = {}
    for engine in ENGINES:
        rows = [row for row in samples if row['engine'] == engine]
        summary[engine] = {'samples': len(rows), 'allExitZero': all(row['exitCode'] == 0 for row in rows), 'diagnostics': sum(row['diagnosticCount'] for row in rows)}
        for key in ['elapsedSeconds','maxRssKiB']:
            values = [row[key] for row in rows]
            summary[engine][key] = {'median': statistics.median(values), 'min': min(values), 'max': max(values)}
    receipt = {
        'status': 'PASS', 'commonArguments': COMMON, 'sourceDirectory': str(SOURCE),
        'sampleCount': len(samples), 'batchElapsedSeconds': round(elapsed,6),
        'orders': orders, 'summary': summary,
        'inputManifestBeforeAfterByteEqual': (TRIAL/'input-manifest-before.json').read_bytes() == (TRIAL/'input-manifest-after.json').read_bytes(),
        'measurementMethod': 'Direct native engines, or Node plus the pinned TS5 CLI. Wall monotonic clock around fork/exec through wait4 for that exact PID. Linux ru_maxrss in KiB from that PID, not cumulative child rusage.',
        'cacheAndLoadScope': 'All compilers have version/config/file-graph preflight before timing; OS and Node compile caches are not flushed. No CPU pinning or cold-start claim. Compilation/QA activity is coordinated to pause during this local sample. Default worker/concurrency choices are retained, so this does not compare equal thread counts.',
        'limits': ['Local three-sample CLI typecheck experiment, not a product speedup or a cross-platform result.','TS5 versus TS7 changes compiler semantics as well as implementation.','CLI success does not authorize replacing the runtime TypeScript library APIs used by Mediflow.'],
    }
    save('measurement-summary.json', receipt)
    print(json.dumps(receipt), flush=True)

if __name__ == '__main__':
    if sys.argv[1:] == ['prepare']:
        prepare()
    elif sys.argv[1:] == ['measure']:
        measure()
    else:
        raise SystemExit('Use prepare or measure')
