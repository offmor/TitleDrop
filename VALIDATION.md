# Validation

Environment: Zotero 10.0.6, macOS. These are engineering checks, not a recognition-accuracy benchmark.

## Automated coverage

Tests cover restricted bootstrap globals, title extraction, identifier checks, filename safety, parent/recognizer races, unavailable files, rename failures, undo, shutdown, queue recovery, library scope, pause/resume, offline-only operation, progress accounting, and atomic state migration.

The updated 1.0 validation run passed 44 tests. Tests use Node's built-in runner, including mocked Zotero integration. They do not replace real-app tests.

The manual-title fix adds coverage for invalid titles, unavailable or locked files, metadata-save rollback, standalone parent cleanup, safe filename recovery, concurrent recognition and successful manual confirmation with undo. Failure scenarios are simulated without editing a real library. Database transaction and attachment-rename behavior were checked against the installed Zotero source; the new failure paths have not been exercised in a live Zotero profile.

## Live checks

- Final v1.0 package: the original fictional example was imported into Zotero and automatically received the expected parent title, attachment title and filename. A SHA-256 check confirmed unchanged PDF contents. Undo restored `synthetic-paper.pdf`; the disposable imported copy and its parent were moved to Trash.
- A standalone arXiv PDF was correctly identified, parented and renamed. Attachment identity and original collection were preserved.
- PDF SHA-256 remained unchanged.
- A disposable import was processed automatically. Undo restored its filename. Test-only items were moved to Trash.
- A personal-library scan checked 196 PDFs: 99 locally available files were processed; 97 remained unavailable after file-sync attempts and were listed as unfinished.
- Native settings and the independent dashboard were opened in Zotero. Buttons and visual layout were inspected in the installed plugin.
- Installed version 1.0: light/system and dark appearance, vertically centered button labels, unavailable-file privacy labels, and the dashboard close shortcut were checked live.
- A real single-PDF queue remained at 0/1 while paused and reached 1/1 after the dashboard's Resume button was clicked. The compact progress widget was also rendered and captured.
- A JSON report was exported through the native save dialog and parsed successfully. The local atomic state file retained 99 managed entries and 97 unavailable-file entries.
- A public-release build for `offmor/TitleDrop` was checked for its repository URLs, matching update SHA-256, and enabled normal update policy. The installed local package uses the same plugin code with private-build update settings.

Screenshots in `docs/images/` were captured from the installed plugin using Gecko's native `drawSnapshot` renderer through Zotero's developer console, then visually inspected. They show real library/queue counts, not mock data. Item identifiers, original filenames and audit backups stay in ignored directories.

## Publication review

- Source examples and test fixtures use original fictional material. Development reference documents and library audit backups were moved outside this project.
- Public branding, Zotero version and release tag are v1.0. The npm development manifest uses the equivalent semver form 1.0.0.
- The repository has no earlier commits containing reference material. Current source, images, PDF metadata, and release archive contents were inspected before publication.
- Regression tests reproduce and cover a native-recognition race at the database transaction boundary, undo during an active operation, and the title-review menu destination.
- A clean source export passed all 36 tests and built an 11-file XPI from an isolated directory. The public update manifest's v1.0 URL and SHA-256 matched that artifact.
- The first public [GitHub Actions run](https://github.com/offmor/TitleDrop/actions/runs/40873226275) passed tests and built the XPI on an Ubuntu runner. This does not constitute Linux Zotero UI testing.

## Remaining scope

Recognition quality has not been benchmarked over a labeled multi-publisher corpus. Windows/Linux UI and future Zotero versions require additional testing.
