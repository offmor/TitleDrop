const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function setup(io,prefs=new Map()){
 const ctx={Zotero:{DataDirectory:{dir:'/data'},Prefs:{get:k=>prefs.get(k),clear:k=>prefs.delete(k)}},IOUtils:io,PathUtils:{join:(...x)=>x.join('/')}};
 vm.createContext(ctx);vm.runInContext(fs.readFileSync(require.resolve('../addon/storage.js'),'utf8'),ctx);return ctx.TitleDropStorage;
}
test('legacy preferences are removed only after atomic file persistence succeeds',async()=>{
 const prefs=new Map([['old',JSON.stringify({pending:{42:{manual:true}}})]]),writes=[];
 const s=setup({exists:async()=>false,writeJSON:async(p,data,options)=>writes.push({p,data,options})},prefs);
 const state=await s.load('old');assert.ok(prefs.has('old'));
 await s.save(state);await s.flush();assert.equal(prefs.has('old'),false);
 assert.equal(writes[0].options.tmpPath,'/data/titledrop-state.json.tmp');assert.equal(writes[0].data.pending[42].manual,true);
});
test('overlapping state saves are serialized and end with the newest state',async()=>{
 let release;const gate=new Promise(r=>release=r),writes=[];
 const s=setup({exists:async()=>false,writeJSON:async(p,data)=>{writes.push(data.n);if(data.n===1)await gate;}});
 await s.load('old');s.save({n:1});s.save({n:2});s.save({n:3});release();await s.flush();
 assert.deepEqual(writes,[1,3]);
});
test('failed migration retains legacy data and corrupt existing state is not overwritten',async()=>{
 const prefs=new Map([['old','{"n":1}']]);const s=setup({exists:async()=>false,writeJSON:async()=>{throw new Error('Disk full');}},prefs);
 const state=await s.load('old');await assert.rejects(()=>s.save(state),/Disk full/);assert.ok(prefs.has('old'));
 let writes=0;const broken=setup({exists:async()=>true,readJSON:async()=>{throw new Error('Invalid JSON');},writeJSON:async()=>writes++});
 await assert.rejects(()=>broken.load('old'),/Invalid JSON/);assert.equal(writes,0);
});
