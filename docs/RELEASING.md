# Preparing a GitHub release

Repository: [offmor/TitleDrop](https://github.com/offmor/TitleDrop). Building does not create a repository or publish anything.

1. Review the source, license and screenshots. Keep `backups/`, `tmp/`, private PDFs, reports, Zotero profile files and credentials out of the repository. The original synthetic example in `examples/` is intended for public distribution.
2. Commit and push the reviewed source to `offmor/TitleDrop`.
3. Run `npm test` and build for the real repository:

   ```sh
   python3 scripts/build.py --repo offmor/TitleDrop
   ```

4. For the first publication, mark the release as a **pre-release / public beta**. Create a release tagged `v1.0`. Upload both `dist/titledrop-1.0.xpi` and `dist/updates.json`. The tag must match the version in the manifest.
5. Install that public XPI in a separate Zotero test profile and verify its update URL and basic import flow before recommending it to other users.

The `--repo` option sets GitHub download/update URLs in the built artifact, enables the normal Zotero automatic-update policy, and includes a SHA-256 digest in the update manifest. It does not modify source files or publish a release. Running `npm run build` without this option produces a private build with automatic updates disabled and a reserved `.invalid` URL.

The included GitHub Actions workflow tests and builds only. It never publishes a release. Screenshots in `docs/images/` should show the installed plugin, with paper-title privacy enabled whenever a list of user papers is visible.

Compatibility is currently limited to Zotero 10.0.x. Windows and Linux have not been visually verified. Broaden the manifest range only after testing those versions.

Pre-release update checks: GitHub’s `/releases/latest` endpoint does not select pre-releases ([GitHub release documentation](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)). During the beta, users should install updates manually; the normal update URL starts serving them after a stable release is published.
