# Contributing

Use Node.js 24 and Python 3.11 or newer. Run `npm test` and `npm run build`; no package installation is required.

Use a separate Zotero profile for manual testing. A useful change includes a regression test for parsing, queue state or file handling when those behaviors are affected. UI changes should include screenshots of the real plugin in light and dark appearance.

For a title-recognition issue, provide an openly available PDF link or a small synthetic fixture. Do not include private papers, API keys, Zotero database files or exported reports containing personal library information.

The plugin must preserve attachment identity and PDF contents, wait for Zotero's own recognizer, avoid overwriting existing files, and route uncertain titles to review. A missing file must not be reported as a successful rename.
