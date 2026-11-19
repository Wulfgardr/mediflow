import fs from 'node:fs';
import path from 'node:path';

const chunkDirectory = buildDirectory => path.join(buildDirectory, 'server', 'chunks');

function runtimeChunks(buildDirectory) {
  const directory = chunkDirectory(buildDirectory);
  const ssr = path.join(directory, 'ssr');
  const list = (root, recursive) => fs.existsSync(root)
    ? fs.readdirSync(root, { withFileTypes: true, recursive })
    : [];
  return [...list(directory, false), ...list(ssr, true)]
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => path.relative(directory, path.join(entry.parentPath, entry.name)));
}

export function copyStandaloneRuntimeChunks(buildDirectory, packagedBuildDirectory) {
  const source = chunkDirectory(buildDirectory);
  const target = chunkDirectory(packagedBuildDirectory);
  for (const relative of runtimeChunks(buildDirectory)) {
    const packaged = path.join(target, relative);
    fs.mkdirSync(path.dirname(packaged), { recursive: true });
    fs.copyFileSync(path.join(source, relative), packaged);
  }
}

export function assertStandaloneRuntimeChunks(buildDirectory, packagedBuildDirectory) {
  const source = chunkDirectory(buildDirectory);
  const target = chunkDirectory(packagedBuildDirectory);
  for (const relative of runtimeChunks(buildDirectory)) {
    const packaged = path.join(target, relative);
    if (!fs.lstatSync(packaged, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Standalone runtime chunk missing: ${relative}`);
    }
    if (!fs.readFileSync(path.join(source, relative)).equals(fs.readFileSync(packaged))) {
      throw new Error(`Standalone runtime chunk differs from build: ${relative}`);
    }
  }
}
