/* @Codex: build-host selection from the fixed renderer manifest, not an OCR capability. */
import profiles from './anydoc-pdf-renderer-profiles.json' with { type: 'json' };

export function anyDocDesktopRendererTrace(platform, arch) {
    if (platform !== 'win32' && platform !== 'linux') return [];
    const profile = profiles.find((entry) => entry.platform === platform && entry.arch === arch);
    if (!profile) return [];
    const root = `./node_modules/${profile.package}`;
    return [`${root}/package.json`, `${root}/${profile.binary}`, `${root}/README.md`];
}
