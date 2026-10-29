// Fictional fixture. The 0000.00000 identifier is parser-only; no real lookup is made.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../addon/core.js');

function data(lines, metadata={}) {
  return {metadata,pages:[[600,800,[[[[0,0,0,0,lines.map(([text,y,size=10])=>[[[45,y,550,y+size,size,1,y+size,0,0,1,0,0,0,text]]])]]]]]]};
}
const sample = () => data([
  ['A Simple Method for Organizing',50,18],['Research Papers',73,18],
  ['Avery Example',110,11],['Abstract',210,11],
  ['Clear filenames make a local document collection easier to browse and maintain.',230,10],
  ['This fictional example exercises title extraction without using any unpublished research.',250,10],
  ['arXiv:0000.00000v1 (synthetic parser fixture only)',730,9]
]);

test('extracts the complete two-line title, not the author or abstract',()=>{
 const a=C.analyze(sample(),'0000.00000v1.pdf');
 assert.equal(a.candidate.title,'A Simple Method for Organizing Research Papers');
 assert.equal(a.candidate.confidence,'high'); assert.equal(a.ids.arxiv,'0000.00000v1');
});
test('recognizer metadata is accepted only when its title is on the first page',()=>{
 const d=sample();d.metadata.Title='A different paper about climate and forests';
 assert.notEqual(C.analyze(d,'x.pdf').candidate.title,d.metadata.Title);
 d.metadata.Title='A Simple Method for Organizing Research Papers';
 assert.match(C.analyze(d,'x.pdf').candidate.source,/metadata/);
});
test('conflicting arXiv filename and first-page identifiers require review',()=>{
 const a=C.analyze(sample(),'2501.12345.pdf');
 assert.equal(a.ids.conflict,true);assert.equal(a.candidate.confidence,'review');
});
test('does not treat random decimal numbers or filenames as arXiv IDs',()=>{
 assert.equal(C.identifiers('measurements_0000.00000.pdf','Accuracy: 0000.00000').arxiv,null);
 assert.equal(C.identifiers('0000.00000v1 (2).pdf','').arxiv,'0000.00000v1');
});
test('reference section is excluded even on a short first page',()=>{
 const d=data([['A Short Paper About Tiny Robots',30,18],['Abstract',90,10],['We study small robots in a swarm.',110,10],['References',160,11],['arXiv:1111.11111 doi:10.1234/unrelated',180,10]]);
 const a=C.analyze(d,'paper.pdf');assert.equal(a.ids.arxiv,null);assert.deepEqual(a.ids.dois,[]);
});
test('wrong reference DOI title cannot pass text verification',()=>{
 assert.equal(C.titleAppears('Simulink Real-Time Robot Control',C.analyze(sample(),'x.pdf').text),false);
 assert.equal(C.titleAppears('A Simple Method for Organizing Research Papers',C.analyze(sample(),'x.pdf').text),true);
});
test('DOI closing punctuation is removed while balanced DOI parentheses are kept',()=>{
 assert.deepEqual(C.identifiers('paper.pdf','(doi:10.1000/example).').dois,['10.1000/example']);
 assert.deepEqual(C.identifiers('paper.pdf','doi:10.1000/(abc)2026').dois,['10.1000/(abc)2026']);
});
test('generic metadata, scans, and ambiguous equal-size text require review',()=>{
 assert.equal(C.analyze({pages:[]},'scan.pdf').candidate.confidence,'review');
 const d=data([['An Interesting Study of Robots',40,10],['An Interesting Study of Sensors',180,10],['This is ordinary body text with lots of words.',240,10]],{Title:'Microsoft Word - document.docx'});
 assert.equal(C.analyze(d,'draft.pdf').candidate.confidence,'review');
});
test('safe Unicode filenames fit limits and cannot traverse paths',()=>{
 assert.equal(C.safeFilename('A title: with / paths?'),'A title with paths.pdf');
 assert.ok(!C.safeFilename('../../a \u0000 paper about robots').includes('/'));
 assert.ok(Buffer.byteLength(C.safeFilename('智能机器人'.repeat(90)))<=224);
 assert.equal(C.safeFilename('CON'),'_CON.pdf');
 assert.throws(()=>C.safeFilename(' ... '));
});
module.exports={sample,data};
