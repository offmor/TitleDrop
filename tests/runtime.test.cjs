// Fictional fixture. The 0000.00000 identifier is parser-only; no real lookup is made.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const vm=require('node:vm');
const C=require('../addon/core.js');

function harness() {
 const map=new Map(), prefs=new Map(), timers=[], calls=[];let next=200;
 class Item {
  constructor(type='attachment') {this.id=next++;this.key='KEY'+this.id;this.itemTypeID=type;this.libraryID=1;this.fields={title:'0000.00000v1'};this.collections=[7,9];this.parentID=null;this.attachmentFilename='0000.00000v1.pdf';map.set(this.id,this);}
  isPDFAttachment(){return this.itemTypeID==='attachment';} isStoredFileAttachment(){return true;}
  isRegularItem(){return !this.isPDFAttachment();} getAttachments(){return [...map.values()].filter(x=>x.parentID===this.id).map(x=>x.id);}
  getField(k){return this.fields[k]||'';}setField(k,v){this.fields[k]=v;}
  getCollections(){return [...this.collections];}setCollections(v){this.collections=[...v];}setCreators(v){this.creators=v;}
  async getFilePathAsync(){return '/storage/'+this.attachmentFilename;}
  async save(){calls.push(['save',this.id]);if(this.parentID)this.collections=[];return this.id;}async saveTx(){return this.save();}
  async reload(){calls.push(['reload',this.id]);}
  async renameAttachmentFile(name,options){calls.push(['rename',this.id,name,options]);this.attachmentFilename=name;return true;}
 }
 const Zotero={initializationPromise:Promise.resolve(),Item,debug(){},logError(){},
 Prefs:{get:(k)=>prefs.get(k),set:(k,v)=>prefs.set(k,v)},
 Notifier:{registerObserver:()=>1,unregisterObserver(){}},getMainWindows:()=>[],
 Items:{get:id=>map.get(Number(id)),getAsync:async id=>map.get(Number(id))},
 Libraries:{get:()=>({editable:true,filesEditable:true})},ItemFields:{getID:x=>x,isValidForType:()=>true},
 DB:{executeTransaction:async fn=>fn()}, ProgressQueues:{get:()=>({getRows:()=>[]})},ProgressQueue:{ROW_PROCESSING:2},
 PDFWorker:{getRecognizerData:async()=>{
   const title='A Simple Method for Organizing Research Papers';
   const word=[45,50,500,68,18,1,68,0,0,1,0,0,0,title];
   return {metadata:{Title:title},pages:[[600,800,[[word]]]]};
 }},
 HTTP:{request:async()=>{throw new Error('offline');}}};
 const ctx={Zotero,TitleDropCore:C,console,setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../addon/main.js'),'utf8'),ctx);
 const plugin=ctx.TitleDrop;return {plugin,Zotero,Item,map,prefs,timers,calls};
}

test('offline fallback creates one parent, preserves collections and original PDF identity',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();const key=a.key;
 h.plugin.state.pending[a.id]={added:Date.now(),manual:true};await h.plugin.process(a.id);
 assert.ok(a.parentID);const p=h.map.get(a.parentID);
 assert.deepEqual(p.collections,[7,9]);assert.equal(a.key,key);
 assert.equal(p.fields.title,'A Simple Method for Organizing Research Papers');
 assert.match(a.attachmentFilename,/A Simple Method/);
 assert.equal(h.calls.find(c=>c[0]==='rename')[3].overwrite,false);
 assert.equal(h.calls.find(c=>c[0]==='rename')[3].unique,true);
 const size=h.map.size, n=h.calls.filter(c=>c[0]==='rename').length;
 await h.plugin.process(a.id);assert.equal(h.map.size,size);assert.equal(h.calls.filter(c=>c[0]==='rename').length,n);
});
test('native recognition in progress does not create a competing parent',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();
 h.Zotero.ProgressQueues.get=()=>({getRows:()=>[{id:a.id,status:2}]});
 h.plugin.state.pending[a.id]={added:Date.now()};await h.plugin.process(a.id);
 assert.equal(a.parentID,null);assert.equal(h.map.size,1);assert.ok(h.timers.length);
});
test('parent arriving while extraction runs is rechecked before writing',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();const fn=h.Zotero.PDFWorker.getRecognizerData;
 h.Zotero.PDFWorker.getRecognizerData=async()=>{const p=new h.Item('document');p.setField('title','The Correct Native Title');a.parentID=p.id;return fn();};
 await h.plugin.process(a.id);assert.equal(h.map.size,2);assert.equal(h.calls.filter(c=>c[0]==='rename').length,0);
});
test('read-only libraries and missing files never reach rename',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();h.Zotero.Libraries.get=()=>({editable:false});
 await assert.rejects(()=>h.plugin.process(a.id),/read-only/);assert.equal(h.calls.length,0);
});
test('failed file rename becomes a review task when queued, never success',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();a.renameAttachmentFile=async()=>-2;
 h.plugin.queue.push(a.id);await h.plugin.drain();
 assert.ok(h.plugin.state.review[a.id]);assert.equal(h.plugin.state.history.length,0);
});
test('undo restores filename, keeps metadata and suppresses immediate re-renaming',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();await h.plugin.process(a.id);
 const parent=a.parentID;await h.plugin.undo();
 assert.equal(a.attachmentFilename,'0000.00000v1.pdf');assert.equal(a.parentID,parent);
 assert.equal(h.plugin.state.managed[a.id].ignored,true);
 const n=h.calls.length;h.plugin.notify('modify','item',[a.id]);assert.equal(h.calls.length,n);
});
test('disabling during extraction cannot create a parent or rename later',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();const fn=h.Zotero.PDFWorker.getRecognizerData;
 h.Zotero.PDFWorker.getRecognizerData=async()=>{h.plugin.stop();return fn();};
 await h.plugin.process(a.id);assert.equal(a.parentID,null);assert.equal(h.calls.length,0);
});
test('pending imports survive restart without scanning or renaming the old library',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();h.plugin.notify('add','item',[a.id]);
 h.plugin.stop();await h.plugin.start();assert.ok(h.plugin.state.pending[a.id]);assert.equal(h.calls.length,0);
});
test('a reviewed PDF is retried when its parent metadata becomes available',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();h.plugin.review(a.id,'','No title');
 const p=new h.Item('document');p.setField('title','The Newly Found Paper Title');a.parentID=p.id;
 h.plugin.notify('modify','item',[p.id]);assert.ok(h.plugin.timers.has(a.id));
});
test('existing-library batch includes nested PDFs, excludes trash and other libraries, and deduplicates work',async()=>{
 const h=harness();await h.plugin.start();
 h.Zotero.Libraries.userLibraryID=1;
 const standalone=new h.Item(),parent=new h.Item('document'),child=new h.Item();child.parentID=parent.id;
 const trashed=new h.Item();trashed.deleted=true;
 const deletedParent=new h.Item('document');deletedParent.deleted=true;
 const hiddenChild=new h.Item();hiddenChild.parentID=deletedParent.id;
 const groupPDF=new h.Item();groupPDF.libraryID=2;
 h.Zotero.Items.getAll=async(libraryID,topLevel,includeDeleted)=>{
   assert.equal(libraryID,1);assert.equal(topLevel,false);assert.equal(includeDeleted,false);
   return [...h.map.values()].filter(x=>x.libraryID===libraryID&&!x.deleted);
 };
 h.plugin.drain=async()=>{};
 h.plugin.queue.push(child.id);
 h.plugin.state.managed[standalone.id]={ignored:true};
 assert.equal(await h.plugin.existingMyLibrary(),2);
 assert.deepEqual([...h.plugin.queue],[child.id,standalone.id]);
 assert.deepEqual(Object.keys(h.plugin.state.pending).sort(),[String(child.id),String(standalone.id)].sort());
 assert.equal(h.plugin.state.pending[child.id].manual,true);
 assert.equal(h.plugin.state.pending[child.id].quiet,true);
 assert.equal(h.plugin.state.managed[standalone.id].ignored,false);
 assert.equal(h.calls.length,0);
 await h.plugin.existingMyLibrary();assert.equal(h.plugin.queue.length,2);
 h.plugin.stop();await h.plugin.start();
 assert.equal(h.plugin.state.pending[child.id].quiet,true);
});
test('read-only personal library is rejected before enumerating or queueing PDFs',async()=>{
 const h=harness();await h.plugin.start();h.Zotero.Libraries.userLibraryID=1;
 h.Zotero.Libraries.get=()=>({editable:false});
 await assert.rejects(()=>h.plugin.existingMyLibrary(),/read-only/);
 assert.equal(h.plugin.queue.length,0);assert.equal(h.calls.length,0);
});
test('explicit library batch downloads missing stored PDFs before processing',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();let downloaded=false;
 a.getFilePathAsync=async()=>downloaded?'/storage/paper.pdf':false;
 h.Zotero.Sync={Runner:{downloadFile:async item=>{assert.equal(item.id,a.id);downloaded=true;}}};
 h.plugin.state.pending[a.id]={manual:true,download:true,quiet:true};
 await h.plugin.process(a.id);assert.ok(a.parentID);assert.ok(downloaded);
 assert.match(a.attachmentFilename,/A Simple Method/);
});
test('unavailable remote PDFs remain in review without creating parent metadata',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();a.getFilePathAsync=async()=>false;
 h.Zotero.Sync={Runner:{downloadFile:async()=>false}};
 h.plugin.state.pending[a.id]={manual:true,download:true};h.plugin.queue.push(a.id);
 await h.plugin.drain();assert.equal(a.parentID,null);
 assert.match(h.plugin.state.review[a.id].reason,/unavailable locally/);assert.equal(h.calls.length,0);
});
test('paused queues do not mutate files, and resume finishes persisted work',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();h.plugin.state.pending[a.id]={manual:true};h.plugin.queue.push(a.id);
 h.plugin.pauseQueue();await h.plugin.drain();assert.equal(h.calls.length,0);assert.equal(h.plugin.queue.length,1);
 h.plugin.resumeQueue();while(h.plugin.draining)await new Promise(resolve=>setImmediate(resolve));
 assert.ok(a.parentID);assert.equal(h.plugin.summary().pending,0);
});
test('offline-only setting prevents identifier requests while keeping local title extraction',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();let requests=0;
 h.Zotero.HTTP.request=async()=>{requests++;throw new Error('Should not contact a server');};
 h.plugin.setSetting('online',false);await h.plugin.process(a.id);
 assert.equal(requests,0);assert.ok(a.parentID);
});
test('missing files from older versions are separated from ambiguous titles',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item(),b=new h.Item();
 h.plugin.state.review[a.id]={id:a.id,reason:'Could not finish: PDF is unavailable locally. Restore or sync the file, then retry.'};
 h.plugin.state.review[b.id]={id:b.id,reason:'Ambiguous title layout'};
 assert.equal(h.plugin.summary().missing,1);assert.equal(h.plugin.summary().review,1);
});
test('batch completion counts unavailable files separately without reporting them as processed',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item(),b=new h.Item();b.getFilePathAsync=async()=>false;
 h.plugin.state.batch={ids:[a.id,b.id],results:{}};h.plugin.state.pending[a.id]={};h.plugin.state.pending[b.id]={};h.plugin.queue.push(a.id,b.id);
 await h.plugin.drain();assert.equal(h.plugin.state.batch.results[a.id],'processed');assert.equal(h.plugin.state.batch.results[b.id],'missing');
 assert.equal(h.plugin.summary().completed,2);assert.equal(h.plugin.summary().processed,1);assert.equal(h.plugin.summary().missing,1);
});
test('a new import starts fresh progress after an earlier batch completed',async()=>{
 const h=harness();await h.plugin.start();h.plugin.state.batch={label:'My Library',ids:[99],results:{99:'processed'},finishedAt:'earlier'};
 const a=new h.Item();h.plugin.notify('add','item',[a.id]);
 assert.equal(h.plugin.state.batch.label,'New imports');assert.equal(h.plugin.summary().total,1);assert.equal(h.plugin.summary().completed,0);
});

test('a native parent arriving at the transaction boundary prevents stale fallback renaming',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();
 h.Zotero.DB.executeTransaction=async fn=>{
   const parent=new h.Item('document');parent.setField('title','The Native Recognizer Title');a.parentID=parent.id;
   return fn();
 };
 await h.plugin.process(a.id);
 assert.equal(h.map.size,2);
 assert.equal(h.map.get(a.parentID).getField('title'),'The Native Recognizer Title');
 assert.equal(h.calls.filter(c=>c[0]==='rename').length,0);
 assert.ok(h.timers.length);
});

test('undo refuses to race an active operation on the same attachment',async()=>{
 const h=harness();await h.plugin.start();const a=new h.Item();await h.plugin.process(a.id);
 h.plugin.busy.add(a.id);const n=h.calls.length;
 await assert.rejects(()=>h.plugin.undo(),/being processed/);
 assert.equal(h.calls.length,n);assert.equal(h.plugin.busy.has(a.id),true);
 assert.equal(h.plugin.state.history.length,1);
});

test('Review Titles menu opens the review tab',async()=>{
 const h=harness();await h.plugin.start();let tab;
 h.plugin.UI={openDashboard:value=>{tab=value;}};h.plugin.showReview();
 assert.equal(tab,'review');
});

// Model SQL rollback independently of filesystem renames. Zotero's save()
// participates in the outer transaction; renameAttachmentFile() must not.
function transactionalHarness() {
 const h=harness();let active=false;
 h.Zotero.DB.executeTransaction=async fn=>{
  assert.equal(active,false,'nested transactions would wait on themselves');
  const before=new Map([...h.map].map(([id,item])=>[id,{
   fields:{...item.fields},parentID:item.parentID,collections:[...item.collections]
  }]));
  active=true;
  try{return await fn();}
  catch(error){
   for(const [id,item] of h.map){
    const state=before.get(id);
    if(state)Object.assign(item,state);
    else h.map.delete(id);
   }
   throw error;
  }finally{active=false;}
 };
 const original=h.Item.prototype.renameAttachmentFile;
 h.Item.prototype.renameAttachmentFile=async function(...args){
  assert.equal(active,false,'file renames must run outside the metadata transaction');
  return original.apply(this,args);
 };
 return h;
}

test('invalid manual titles cannot modify an existing parent or create a new one',async()=>{
 for(const hasParent of [false,true]){
  const h=transactionalHarness();await h.plugin.start();const a=new h.Item();
  const p=hasParent?new h.Item('document'):null;
  if(p){p.setField('title','The Original Bibliographic Title');a.parentID=p.id;}
  const count=h.map.size,name=a.attachmentFilename,label=a.getField('title');
  for(const input of ['///','***','...'])await assert.rejects(()=>h.plugin.confirmTitle(a.id,input),/non-empty title/);
  assert.equal(h.map.size,count);assert.equal(a.attachmentFilename,name);assert.equal(a.getField('title'),label);
  if(p)assert.equal(p.getField('title'),'The Original Bibliographic Title');
  assert.equal(h.calls.length,0);assert.equal(h.plugin.state.history.length,0);assert.equal(h.plugin.busy.size,0);
 }
});

test('missing, locked and rejected files leave all manual-review metadata unchanged',async()=>{
 for(const result of [false,-1,-2,'throw'])for(const hasParent of [false,true]){
  const h=transactionalHarness();await h.plugin.start();const a=new h.Item();
  const p=hasParent?new h.Item('document'):null;
  if(p){p.setField('title','The Original Bibliographic Title');a.parentID=p.id;}
  const count=h.map.size,label=a.getField('title');
  h.plugin.review(a.id,'Candidate','Confirm this title');
  a.renameAttachmentFile=async()=>{if(result==='throw')throw new Error('File is locked');return result;};
  await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/renamed|locked/);
  assert.equal(h.map.size,count);assert.equal(a.getField('title'),label);
  if(p)assert.equal(p.getField('title'),'The Original Bibliographic Title');
  assert.equal(h.calls.length,0);assert.equal(h.plugin.state.history.length,0);
  assert.ok(h.plugin.state.review[a.id]);assert.equal(h.plugin.busy.size,0);
 }
});

test('metadata-save failures roll back both parent and attachment and restore the filename',async()=>{
 for(const failAt of ['parent','attachment']){
  const h=transactionalHarness();await h.plugin.start();const a=new h.Item(),p=new h.Item('document');
  p.setField('title','The Original Bibliographic Title');a.parentID=p.id;
  const name=a.attachmentFilename,label=a.getField('title');
  (failAt==='parent'?p:a).save=async()=>{throw new Error('Database write failed');};
  await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/Database write failed/);
  assert.equal(p.getField('title'),'The Original Bibliographic Title');
  assert.equal(a.getField('title'),label);assert.equal(a.attachmentFilename,name);assert.equal(a.parentID,p.id);
  assert.equal(h.plugin.state.history.length,0);assert.equal(h.plugin.state.managed[a.id],undefined);
  assert.equal(h.plugin.busy.size,0);
  const renames=h.calls.filter(c=>c[0]==='rename');assert.equal(renames.length,2);
  assert.equal(renames[1][3].overwrite,false);assert.equal(renames[1][3].unique,false);
  assert.deepEqual(h.calls.filter(c=>c[0]==='reload').map(c=>c[1]),[p.id,a.id]);
 }
});

test('failed standalone confirmation removes the temporary parent and preserves collections',async()=>{
 const h=transactionalHarness();await h.plugin.start();const a=new h.Item();
 const name=a.attachmentFilename,label=a.getField('title');
 a.save=async()=>{throw new Error('Attachment save failed');};
 await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/Attachment save failed/);
 assert.equal(h.map.size,1);assert.equal(a.parentID,null);assert.deepEqual(a.collections,[7,9]);
 assert.equal(a.attachmentFilename,name);assert.equal(a.getField('title'),label);
 assert.equal(h.plugin.state.history.length,0);assert.equal(h.plugin.busy.size,0);
});

test('failed filename recovery stays in review and cannot overwrite a conflicting file',async()=>{
 const h=transactionalHarness();await h.plugin.start();const a=new h.Item(),p=new h.Item('document');a.parentID=p.id;
 const oldTitle=p.getField('title'),rename=a.renameAttachmentFile;let attempts=0;
 a.renameAttachmentFile=async function(name,options){
  if(++attempts===2){assert.equal(options.overwrite,false);assert.equal(options.unique,false);return -1;}
  return rename.call(this,name,options);
 };
 a.save=async()=>{throw new Error('Attachment save failed');};
 await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/recovery was incomplete/);
 assert.equal(p.getField('title'),oldTitle);assert.equal(h.plugin.state.history.length,0);
 assert.match(h.plugin.state.review[a.id].reason,/recovery was incomplete/);
 assert.equal(h.plugin.state.managed[a.id],undefined);assert.equal(h.plugin.busy.size,0);
});

test('native recognition winning during the file rename is not overwritten by manual confirmation',async()=>{
 const h=transactionalHarness();await h.plugin.start();const a=new h.Item(),p=new h.Item('document');
 p.setField('title','The Native Recognizer Title');const name=a.attachmentFilename,rename=a.renameAttachmentFile;
 a.renameAttachmentFile=async function(...args){const result=await rename.apply(this,args);a.parentID=p.id;return result;};
 await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/changed during recognition/);
 assert.equal(p.getField('title'),'The Native Recognizer Title');assert.equal(a.parentID,p.id);
 assert.equal(a.attachmentFilename,name);assert.equal(h.map.size,2);assert.equal(h.plugin.state.history.length,0);
});

test('recovery will not rename a file again if metadata cannot reload or its name changed externally',async()=>{
 for(const failure of ['reload','external rename']){
  const h=transactionalHarness();await h.plugin.start();const a=new h.Item(),p=new h.Item('document');a.parentID=p.id;
  a.save=async()=>{throw new Error('Attachment save failed');};
  a.reload=async()=>{
   if(failure==='reload')throw new Error('Metadata is unavailable');
   a.attachmentFilename='An External Filename.pdf';
  };
  await assert.rejects(()=>h.plugin.confirmTitle(a.id,'The Confirmed Paper Title'),/recovery was incomplete/);
  assert.equal(h.calls.filter(c=>c[0]==='rename').length,1);
  assert.ok(h.plugin.state.review[a.id]);assert.equal(h.plugin.state.history.length,0);
  if(failure==='external rename')assert.equal(a.attachmentFilename,'An External Filename.pdf');
 }
});

test('successful manual confirmation updates both titles and creates an undoable rename',async()=>{
 for(const hasParent of [false,true]){
  const h=transactionalHarness();await h.plugin.start();const a=new h.Item();
  const p=hasParent?new h.Item('document'):null;if(p)a.parentID=p.id;
  const name=a.attachmentFilename,label=a.getField('title'),key=a.key;
  h.plugin.review(a.id,'Candidate','Confirm this title');
  await h.plugin.confirmTitle(a.id,'The Confirmed Paper Title');
  const parent=h.map.get(a.parentID);assert.equal(parent.getField('title'),'The Confirmed Paper Title');
  assert.equal(a.getField('title'),'The Confirmed Paper Title');assert.equal(a.key,key);
  assert.equal(a.attachmentFilename,'The Confirmed Paper Title.pdf');
  assert.equal(h.map.size,2);if(!hasParent)assert.deepEqual(parent.collections,[7,9]);
  assert.equal(h.plugin.state.review[a.id],undefined);assert.equal(h.plugin.state.history.length,1);
  assert.equal(h.plugin.busy.size,0);assert.equal(h.calls[0][0],'rename');
  await h.plugin.undo();assert.equal(a.attachmentFilename,name);assert.equal(a.getField('title'),label);
  assert.equal(parent.getField('title'),'The Confirmed Paper Title');assert.equal(a.parentID,parent.id);
 }
});
