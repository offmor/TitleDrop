# Changelog

## v1.0 - Initial public release

- Manual title confirmation now validates filenames before changes, commits parent and attachment titles together, and restores the filename if metadata saving fails. Incomplete recovery is reported for review.
- Automatic PDF title naming with verified identifier lookup, local title extraction, manual review and undo.
- Explicit personal-library scans and optional retrieval of unavailable stored files.
- Native settings panel, processing dashboard, compact progress widget, and light/dark appearance.
- Separate title review and unavailable-file lists, pause/resume, activity and local report export.
- Screenshot privacy hides filenames, proposed titles and review details.
- Atomic local state storage and migration from development preference storage.
- Native-recognition race protection and a guard against undo during active processing.
- Original fictional demonstration material, English documentation, MIT license and GitHub build checks.

The release and its Git tag remain **v1.0**. Users of the earlier v1.0 package must reinstall the updated XPI manually to receive the manual-title fix.
