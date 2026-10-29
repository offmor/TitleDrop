# Fictional demonstration

`synthetic-paper.pdf` and `synthetic-recognizer.json` contain original synthetic material created for TitleDrop. Names are fictional; there are no real institutions, paper identifiers, research findings, or library records. These files share the project's MIT license.

The expected title is **A Simple Method for Organizing Research Papers**. The expected filename is `A Simple Method for Organizing Research Papers.pdf`.

Regenerate with `python3 scripts/make_example.py` after installing the optional developer tools `reportlab` and Poppler. These tools are not required to build or use the plugin. Parser tests separately use a deliberately invalid-month identifier (`0000.00000`) with mocked network access.
