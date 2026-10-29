from pathlib import Path
import argparse, json, zipfile, hashlib, re
parser = argparse.ArgumentParser(description='Build a private XPI, or a GitHub-ready release with --repo OWNER/REPO.')
parser.add_argument('--repo', help='GitHub repository for public release download/update URLs')
parser.add_argument('--output', type=Path, help='Output directory (defaults to dist)')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'addon/manifest.json').read_text())
if args.repo:
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', args.repo):
        parser.error('--repo must be OWNER/REPO')
    manifest['applications']['zotero']['update_url'] = f'https://github.com/{args.repo}/releases/latest/download/updates.json'
    manifest['homepage_url'] = f'https://github.com/{args.repo}'
# Validate the required Zotero manifest fields before producing an XPI.
settings = manifest['applications']['zotero']
assert all(settings.get(k) for k in ['id', 'update_url', 'strict_min_version', 'strict_max_version'])
assert settings['update_url'].startswith('https:')
out = (args.output or root / 'dist') / f"titledrop-{manifest['version']}.xpi"
out.parent.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as z:
    for path in sorted((root / 'addon').rglob('*')):
        if path.is_file():
            info = zipfile.ZipInfo(path.relative_to(root / 'addon').as_posix(), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            content = json.dumps(manifest, indent=2).encode() if path.name == 'manifest.json' else path.read_bytes()
            if args.repo and path.name == 'bootstrap.js':
                content = content.replace(b'const TITLEDROP_PRIVATE_BUILD = true;', b'const TITLEDROP_PRIVATE_BUILD = false;')
            z.writestr(info, content)
print(out)
digest = hashlib.sha256(out.read_bytes()).hexdigest()
print('SHA-256:', digest)
if args.repo:
    version = manifest['version']
    update = {'addons': {settings['id']: {'updates': [{
        'version': version,
        'update_link': f'https://github.com/{args.repo}/releases/download/v{version}/{out.name}',
        'update_hash': 'sha256:' + digest,
        'applications': {'zotero': {'strict_min_version': settings['strict_min_version'], 'strict_max_version': settings['strict_max_version']}}
    }]}}}
    (out.parent / 'updates.json').write_text(json.dumps(update, indent=2)+'\n')
    print(out.parent / 'updates.json')
