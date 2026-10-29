const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
test('bootstrap runs in the restricted Zotero sandbox without a console global',async()=>{
 const prefs=new Map(),addon={};
 const Zotero={initializationPromise:Promise.resolve(),logError(){},getMainWindows:()=>[],DataDirectory:{dir:'/test'},
   PreferencePanes:{register:async()=> 'titledrop-settings-pane',unregister(){}},
   Prefs:{get:k=>prefs.get(k),set:(k,v)=>prefs.set(k,v),clear:k=>prefs.delete(k)},Notifier:{registerObserver:()=>1,unregisterObserver(){}}};
 const Services={io:{newURI:x=>x},scriptloader:{loadSubScript(file,target){
   if(!vm.isContext(target)){vm.createContext(target);vm.runInContext('delete globalThis.console',target);}
   vm.runInContext(fs.readFileSync(file,'utf8'),target);
 }}};
 const ChromeUtils={importESModule(url){return url.includes('Timer')?{setTimeout,clearTimeout}:{AddonManager:{AUTOUPDATE_DISABLE:0,getAddonByID:async()=>addon}};}};
 const Cc={'@mozilla.org/addons/addon-manager-startup;1':{getService:()=>({registerChrome:()=>({destruct(){}})})}},Ci={amIAddonManagerStartup:{}};
 const IOUtils={exists:async()=>false,writeJSON:async()=>{}},PathUtils={join:(...x)=>x.join('/')};
 const ctx={Zotero,Services,ChromeUtils,Cc,Ci,IOUtils,PathUtils};vm.createContext(ctx);vm.runInContext('delete globalThis.console',ctx);
 vm.runInContext(fs.readFileSync(path.join(__dirname,'../addon/bootstrap.js'),'utf8'),ctx);
 await ctx.startup({rootURI:path.join(__dirname,'../addon/')});
 assert.equal(ctx.TitleDrop.running,true);assert.equal(addon.applyBackgroundUpdates,0);
 assert.equal(ctx.TitleDrop.C.safeFilename('A Real Paper Title'),'A Real Paper Title.pdf');
 await ctx.shutdown();
});
