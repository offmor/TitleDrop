const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function reviewFixture(privateView){
  const context={Zotero:{Items:{get:()=>({attachmentFilename:'PRIVATE_FILENAME.pdf'})}}};
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('addon/ui.js','utf8'),context);
  const ui=context.TitleDropUI;
  ui.p={setting:()=>privateView,reviewKind:()=> 'title',state:{review:{1:{id:1,title:'PRIVATE_CANDIDATE',reason:'PRIVATE_DETAILS'}}}};
  const document={createElementNS:(_ns,tag)=>({tag,children:[],dataset:{},append(...children){this.children.push(...children)},setAttribute(){},addEventListener(){}})};
  const root=document.createElementNS(null,'main');
  ui.reviewList(document,root,'title',new Map([['1','PRIVATE_DRAFT']]));
  return JSON.stringify(root);
}

test('screenshot privacy hides review filenames, candidate titles, drafts and diagnostic details',()=>{
  const result=reviewFixture(true);
  assert.doesNotMatch(result,/PRIVATE_/);
  assert.match(result,/PDF 001/);
  assert.match(result,/Turn off screenshot privacy/);
});

test('review title editing is available when screenshot privacy is off',()=>{
  const result=reviewFixture(false);
  assert.match(result,/PRIVATE_FILENAME/);
  assert.match(result,/PRIVATE_DETAILS/);
  assert.match(result,/PRIVATE_DRAFT/);
  assert.match(result,/Use title/);
});
