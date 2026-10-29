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
