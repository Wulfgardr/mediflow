/* Synthetic Apple CLI subset backed by real Python stdlib plist parsing.
 * Unknown commands fail; no host Apple utilities or build tools are invoked. */
import fs from 'node:fs';
import path from 'node:path';

export function installPlistTestTools(bin) {
  fs.mkdirSync(bin, { recursive: true });
  const source = String.raw`import json, plistlib, sys
args = sys.argv[2:]
try:
    with open(args[-1], "rb") as source:
        data = plistlib.load(source)
    if sys.argv[1] == "PlistBuddy":
        assert len(args) == 3 and args[0] == "-c" and args[1].startswith("Print :")
        keys = args[1][7:].split(":")
        value = data
        for key in keys:
            value = value[int(key)] if isinstance(value, list) else value[key]
        print(value if isinstance(value, str) else json.dumps(value))
    else:
        operation, key = args[:2]
        keys = key.split(".")
        parent = data
        for part in keys[:-1]:
            parent = parent[part]
        key = keys[-1]
        if operation == "-extract":
            assert args[2:-1] in (["raw"], ["raw", "-o", "-"])
            value = parent[key]
            print(value if isinstance(value, str) else json.dumps(value))
        else:
            if operation == "-remove":
                assert len(args) == 3
                del parent[key]
            else:
                assert operation in ("-replace", "-insert")
                assert (key in parent) == (operation == "-replace")
                if args[2] == "-string":
                    assert len(args) == 5
                    parent[key] = args[3]
                else:
                    assert args[2] == "-dictionary" and len(args) == 4
                    parent[key] = {}
            with open(args[-1], "wb") as destination:
                plistlib.dump(data, destination, sort_keys=False)
except (AssertionError, KeyError, IndexError, ValueError, OSError) as error:
    print(str(error), file=sys.stderr)
    sys.exit(1)
`;
  const parser = path.join(bin, 'plist-parser.py');
  fs.writeFileSync(parser, source);
  // The synthetic DEVELOPER_DIR belongs to the fake Apple tools, not Python.
  for (const tool of ['plutil', 'PlistBuddy']) fs.writeFileSync(path.join(bin, tool),
    `#!/bin/bash\nunset DEVELOPER_DIR\nexec python3 "${parser}" ${tool} "$@"\n`, { mode: 0o755 });
}
