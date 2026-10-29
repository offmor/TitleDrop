"""Create an original, fictional demonstration document; never reads a library.

Optional developer dependencies: reportlab and Poppler's pdftoppm.
"""
from pathlib import Path
import json
import shutil
import subprocess

from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer

root = Path(__file__).resolve().parents[1]
output = root / 'examples'
output.mkdir(exist_ok=True)
title = 'A Simple Method for Organizing Research Papers'
pdf = output / 'synthetic-paper.pdf'
green = colors.HexColor('#087f72')
styles = {
    'label': ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9, leading=13, textColor=green, spaceAfter=22),
    'title': ParagraphStyle('title', fontName='Times-Bold', fontSize=25, leading=29, spaceAfter=18),
    'author': ParagraphStyle('author', fontName='Helvetica', fontSize=10, leading=15, spaceAfter=24),
    'heading': ParagraphStyle('heading', fontName='Helvetica-Bold', fontSize=12, leading=16, spaceBefore=14, spaceAfter=8),
    'body': ParagraphStyle('body', fontName='Times-Roman', fontSize=11, leading=16, spaceAfter=10),
}
sections = [
    ('Abstract', 'This is a fictional document created to demonstrate PDF title extraction. It contains no unpublished research, real authors, institutions, identifiers, or experimental findings. The text and layout are original examples distributed with TitleDrop.'),
    ('1. Purpose', 'A useful attachment name should describe the document rather than the download process. This example lets a reader test that behavior with material that is safe to copy, modify, and publish.'),
    ('2. What this example tests', 'The title spans two lines above a smaller author line and several paragraphs. A title extractor should preserve both title lines while excluding author names, section headings, and body text. The author names on this page are fictional.'),
    ('3. Expected result', 'After a successful rename, both the attachment label and the PDF filename should use the title printed at the top of this page. The contents of the PDF should remain unchanged. If extraction is uncertain, a review step should appear instead of inventing a title.'),
    ('4. Scope', 'This page is a software demonstration, not a published paper or a scientific result. It provides no evidence of recognition accuracy across publishers. Scanned documents and ambiguous layouts need separate testing.'),
]
story = [Paragraph('TITLEDROP / SYNTHETIC EXAMPLE', styles['label']),
         Paragraph('A Simple Method for Organizing<br/>Research Papers', styles['title']),
         Paragraph('Avery Example and Morgan Sample<br/>Fictional authors - demonstration only', styles['author'])]
for heading, body in sections:
    story.extend([Paragraph(heading, styles['heading']), Paragraph(body, styles['body'])])

def footer(canvas, document):
    canvas.setStrokeColor(colors.HexColor('#dfe7e2'))
    canvas.line(52, 44, 548, 44)
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(colors.HexColor('#71817a'))
    canvas.drawString(52, 30, 'Original synthetic material for TitleDrop. No real research data.')
    canvas.drawRightString(548, 30, str(document.page))

SimpleDocTemplate(str(pdf), pagesize=(600, 800), rightMargin=52, leftMargin=52,
                  topMargin=44, bottomMargin=64, title='Synthetic example',
                  author='TitleDrop contributors', invariant=1).build(story, onFirstPage=footer, onLaterPages=footer)

# A minimal fictional recognizer fixture for parser debugging, with no real IDs.
lines = [(title, 80, 22), ('Avery Example and Morgan Sample', 142, 10),
         ('Abstract', 210, 12), (sections[0][1], 234, 11)]
words = [[[52, y, 548, y+size, size, 1, y+size, 0, 0, 1, 0, 0, 0, text]] for text, y, size in lines]
fixture = {'metadata': {}, 'pages': [[600, 800, words]]}
(output / 'synthetic-recognizer.json').write_text(json.dumps(fixture, indent=2)+'\n')

renderer = shutil.which('pdftoppm')
if not renderer:
    raise SystemExit('PDF created. Install Poppler to generate the example-first-page.png preview.')
preview = root / 'docs/images/example-first-page'
subprocess.run([renderer, '-f', '1', '-singlefile', '-scale-to', '1600', '-png', str(pdf), str(preview)], check=True)
print(pdf.relative_to(root))
print(preview.with_suffix('.png').relative_to(root))
