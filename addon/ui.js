/* Native Zotero settings, a separate dashboard, and a compact progress widget. */
var TitleDropUI = {
  views:new Set(), dashboard:null, tab:'overview', limit:20, renderTimer:null, widgetDismissed:false,
  async start(plugin) {
    this.p=plugin;
    this.paneID=await Zotero.PreferencePanes.register({pluginID:'titledrop@local',id:'titledrop-settings-pane',
      label:'TitleDrop',src:'settings.xhtml',stylesheets:['ui.css'],image:'icon.svg'});
  },
  stop() {
    clearTimeout(this.renderTimer);this.renderTimer=null;
    for(const view of this.views)if(view.type==='settings')view.root.replaceChildren();
    this.views.clear();this.dashboard?.close();this.dashboard=null;
    for(const win of this.p.windows){win.document.getElementById('titledrop-widget')?.remove();win.document.getElementById('titledrop-css')?.remove();}
    if(this.paneID)Zotero.PreferencePanes.unregister(this.paneID);
  },
  openSettings() { Zotero.Utilities.Internal.openPreferences(this.paneID); },
  openDashboard(tab) {
    if(tab){this.tab=tab;this.limit=20;}
    this.widgetDismissed=false;
    if(this.dashboard&&!this.dashboard.closed){this.dashboard.focus();this.refresh();return;}
    this.dashboard=Zotero.getMainWindow().openDialog('chrome://titledrop/content/dashboard.xhtml','titledrop-dashboard',
      'chrome,centerscreen,resizable,dialog=no,width=940,height=740',{plugin:this.p});
  },
  mountSettings(win,root) { this.mount(win,root,'settings'); },
  mountDashboard(win,root) { this.dashboard=win;this.mount(win,root,'dashboard'); },
  mount(win,root,type) {
    for(const v of this.views)if(v.root===root)return;
    const view={win,root,type};this.views.add(view);
    win.addEventListener('unload',()=>this.views.delete(view),{once:true});
    this.render(view);
  },
  refresh() {
    if(this.renderTimer)return;
    this.renderTimer=setTimeout(()=>{
      this.renderTimer=null;
      for(const view of [...this.views]) {
        if(view.win.closed||!view.root.isConnected){this.views.delete(view);continue;}
        this.render(view);
      }
      for(const win of this.p.windows)this.widget(win);
    },120);
  },
  element(d,tag,text,className) {
    const e=d.createElementNS('http://www.w3.org/1999/xhtml',tag);
    if(text!==undefined&&text!==null)e.textContent=String(text);
    if(className)e.className=className;return e;
  },
  button(d,text,fn,style='') {
    const e=this.element(d,'button',text,'td-btn '+style);e.type='button';
    e.addEventListener('click',async()=>{try{await fn();}catch(error){this.status(d,error.message);Zotero.logError(error);}});return e;
  },
  status(d,text) { const e=d.querySelector('.td-status');if(e)e.textContent=text;else this.p.toast('TitleDrop',text); },
  brand(d,subtitle,small=false) {
    const b=this.element(d,'div',null,'td-brand'),img=this.element(d,'img',null,'td-logo');
    img.src='chrome://titledrop/content/icon.svg';img.alt='';b.append(img);
    const copy=this.element(d,'div');copy.append(this.element(d,small?'h2':'h1','TitleDrop'));
    if(subtitle)copy.append(this.element(d,'p',subtitle,'td-subtitle'));b.append(copy);return b;
  },
  stats(d,s) {
    const box=this.element(d,'div',null,'td-stats');
    for(const [value,label,style] of [[s.processed,'PDFs managed','good'],[s.pending,'In the queue',''],[s.review,'Titles to review',''],[s.missing,'Files unavailable','warn']]) {
      const c=this.element(d,'div',null,'td-stat '+style);c.append(this.element(d,'strong',value),this.element(d,'span',label));box.append(c);
    }return box;
  },
  switchRow(d,title,description,name,value) {
    const row=this.element(d,'label',null,'td-setting-row'),copy=this.element(d,'div',null,'td-setting-copy');
    copy.append(this.element(d,'strong',title),this.element(d,'p',description));
    const input=this.element(d,'input',null,'td-switch');input.type='checkbox';input.checked=value;input.setAttribute('aria-label',title);
    input.addEventListener('change',()=>this.p.setSetting(name,input.checked));row.append(copy,input);return row;
  },
  select(d,label,name,options) {
    const el=this.element(d,'select',null,'td-select');el.setAttribute('aria-label',label);
    for(const [value,text]of options){const o=this.element(d,'option',text);o.value=value;el.append(o);}
    el.value=this.p.setting(name);el.addEventListener('change',()=>this.p.setSetting(name,el.value));return el;
  },
  render(view) {
    const {root,win}=view,d=win.document,scroll=root.scrollTop;
    const drafts=new Map([...root.querySelectorAll('input[data-item]')].map(i=>[i.dataset.item,i.value]));
    const focused=d.activeElement?.dataset?.item;
    root.dataset.theme=this.p.setting('theme');root.replaceChildren();
    if(view.type==='settings')this.settings(d,root);else this.dashboardView(d,root,drafts);
    root.scrollTop=scroll;
    if(focused){const input=[...root.querySelectorAll('input[data-item]')].find(i=>i.dataset.item===focused);input?.focus();}
  },
  settings(d,root) {
    const s=this.p.summary(),head=this.element(d,'header',null,'td-header');
    head.append(this.brand(d,'Drop a paper. Keep its title.'),this.element(d,'span',this.p.auto()?'AUTOMATIC':'PAUSED','td-pill'+(this.p.auto()?'':' amber')));root.append(head);
    root.append(this.stats(d,s));
    const card=this.element(d,'section',null,'td-card'),title=this.element(d,'div',null,'td-card-head');
    title.append(this.element(d,'h2','Your naming workflow'),this.element(d,'small','Changes save automatically'));card.append(title);
    card.append(this.switchRow(d,'Automatically process new PDFs','New imports are queued after Zotero has time to recognize them.','auto',this.p.auto()));
    card.append(this.switchRow(d,'Verify titles online','Look up DOI / arXiv IDs. PDF text stays on this computer.','online',this.p.setting('online')));
    card.append(this.switchRow(d,'Retrieve missing files during a library scan','Use your existing Zotero file sync before trying to rename.','download',this.p.setting('download')));
    const timing=this.element(d,'div',null,'td-setting-row'),copy=this.element(d,'div',null,'td-setting-copy');
    copy.append(this.element(d,'strong','Import wait time'),this.element(d,'p','Zotero recognition always takes priority, even after this wait.'));
    timing.append(copy,this.select(d,'Import wait time','delay',[[3,'3 seconds'],[6,'6 seconds'],[10,'10 seconds']]));
    const preview=this.element(d,'div',null,'td-filename');preview.append(this.element(d,'small','FILENAME PREVIEW'),this.element(d,'span','A Better Way to Name Your Papers.pdf'));card.append(preview);root.append(card);
    const library=this.element(d,'section',null,'td-card td-library'),lc=this.element(d,'div');
    lc.append(this.element(d,'h2','Bring older papers along'),this.element(d,'p','Scan existing PDFs in My Library. Group libraries are excluded.'));
    library.append(lc,this.button(d,'Scan My Library',()=>this.p.existingMyLibrary(),'primary'));root.append(library);
    const bottom=this.element(d,'div',null,'td-bottom'),actions=this.element(d,'div',null,'td-actions');
    actions.append(this.button(d,'Open dashboard',()=>this.openDashboard()),this.button(d,'Undo last rename',()=>this.p.undo(),'ghost'));
    bottom.append(actions,this.select(d,'Appearance','theme',[['system','System'],['light','Light'],['dark','Dark']]));root.append(bottom);
    const advanced=this.element(d,'details',null,'td-advanced');advanced.append(this.element(d,'summary','Advanced options'),timing,this.switchRow(d,'Show rename notifications','The dashboard always keeps a local activity record.','notifications',this.p.setting('notifications')));root.append(advanced);
    const foot=this.element(d,'footer',null,'td-footer');foot.append(this.element(d,'p','LOCAL FIRST · No API key. No full-PDF upload.','td-footnote'),this.element(d,'span','v'+this.p.version));root.append(foot);
    const status=this.element(d,'p',null,'td-status');status.setAttribute('role','status');root.append(status);
  },
  dashboardView(d,root,drafts) {
    const s=this.p.summary(),head=this.element(d,'header',null,'td-header');
    head.append(this.brand(d,'A clear view of every PDF.'),this.button(d,'Settings',()=>this.openSettings()));root.append(head);
    const nav=this.element(d,'nav',null,'td-tabs');nav.setAttribute('aria-label','Dashboard sections');
    for(const [key,label,count]of [['overview','Overview',null],['review','Title review',s.review],['files','Unavailable files',s.missing],['activity','Activity',null]]) {
      const b=this.element(d,'button',label,'td-tab');b.type='button';b.setAttribute('aria-selected',this.tab===key);
      if(count)b.append(this.element(d,'span',count,'td-count'));
      b.addEventListener('click',()=>{this.tab=key;this.limit=20;this.refresh();});nav.append(b);
    }root.append(nav);
    if(this.tab==='overview')this.overview(d,root,s);
    else if(this.tab==='activity')this.activity(d,root);
    else this.reviewList(d,root,this.tab==='files'?'missing':'title',drafts);
    const bottom=this.element(d,'div',null,'td-bottom'),privacy=this.element(d,'label',null,'td-privacy'),check=this.element(d,'input');
    check.type='checkbox';check.checked=this.p.setting('privateView');check.addEventListener('change',()=>this.p.setSetting('privateView',check.checked));
    privacy.append(check,this.element(d,'span','Hide paper titles for screenshots'));bottom.append(privacy,this.button(d,'Export report',()=>this.exportReport(d.defaultView),'ghost'));root.append(bottom);
    const status=this.element(d,'p',null,'td-status');status.setAttribute('role','status');root.append(status);
  },
  overview(d,root,s) {
    const active=s.pending>0,hero=this.element(d,'section',null,'td-hero'),top=this.element(d,'div',null,'td-hero-top'),copy=this.element(d,'div');
    copy.append(this.element(d,'div',active?'WORK IN PROGRESS':'LIBRARY OVERVIEW','td-eyebrow'));
    copy.append(this.element(d,'h2',active?(s.paused?'Processing paused':'Processing your PDFs'):'Queued work complete','td-hero-title'));
    copy.append(this.element(d,'p',active?(s.paused?'Queued files are saved. Resume whenever you are ready.':'TitleDrop checks each PDF, keeps reliable titles, and sets uncertain cases aside.'):'Queued work is complete. New PDFs will follow your automatic import settings.'));
    top.append(copy,this.element(d,'span',active?(s.paused?'PAUSED':'PROCESSING'):(s.missing||s.review?'CHECK FINISHED':'ALL SET'),'td-pill'+(s.paused?' amber':'')));hero.append(top);
    const meta=this.element(d,'div',null,'td-progress-meta');meta.append(this.element(d,'strong',this.p.state.batch?.label||'Tracked PDFs'),this.element(d,'span',`${s.completed} / ${s.total} checked`));hero.append(meta);
    const track=this.element(d,'div',null,'td-track'),fill=this.element(d,'div',null,'td-fill'+(!active?' finished':''));
    fill.style.width=(s.total?Math.round(s.completed/s.total*100):0)+'%';track.append(fill);track.setAttribute('role','progressbar');track.setAttribute('aria-label','PDF processing');track.setAttribute('aria-valuemin','0');track.setAttribute('aria-valuemax',String(s.total||1));track.setAttribute('aria-valuenow',String(s.completed));hero.append(track);
    const footer=this.element(d,'div',null,'td-hero-footer');footer.append(this.element(d,'span',active?`${s.pending} remaining · Your original PDF contents are preserved`:'Original PDF contents preserved. Filenames follow paper titles.','td-footnote'));
    footer.append(active?this.button(d,s.paused?'Resume processing':'Pause processing',()=>s.paused?this.p.resumeQueue():this.p.pauseQueue()):this.button(d,'Scan My Library',()=>this.p.existingMyLibrary(),'primary'));hero.append(footer);
    if(s.missing)hero.append(this.element(d,'div',`${s.missing} PDF files are unavailable on this computer. They have been kept separate from titles that need your review.`,'td-notice warn'));
    root.append(hero,this.stats(d,s));
    root.append(this.element(d,'p','Titles come from existing metadata, verified identifiers, or local PDF text. Uncertain results wait for your review.','td-footnote'));
  },
  itemLabel(record,index) {
    if(this.p.setting('privateView'))return 'PDF '+String(index+1).padStart(3,'0');
    const item=Zotero.Items.get(record.id);return item?.attachmentFilename||item?.getField('title')||'Unavailable item';
  },
  reviewList(d,root,kind,drafts) {
    const privateView=this.p.setting('privateView');
    const records=Object.values(this.p.state.review).filter(r=>this.p.reviewKind(r)===kind);
    if(!records.length){const empty=this.element(d,'section',null,'td-empty');empty.append(this.element(d,'strong',kind==='title'?'Nothing to review.':'No missing files.'),this.element(d,'p',kind==='title'?'You are all caught up. Titles that need confirmation will appear here.':'All tracked PDF files are available.'));root.append(empty);return;}
    const toolbar=this.element(d,'div',null,'td-list-toolbar');toolbar.append(this.element(d,'p',kind==='missing'?'File sync did not provide these PDFs. Their existing names were kept.':'Read the title, confirm it once, and let TitleDrop finish.'));
    toolbar.append(this.button(d,kind==='missing'?'Retry downloads':'Retry all',()=>this.p.retryReviews(kind)));root.append(toolbar);
    const list=this.element(d,'section',null,'td-card');
    records.slice(0,this.limit).forEach((r,index)=>{
      const row=this.element(d,'article',null,'td-review-row');row.append(this.element(d,'div',this.itemLabel(r,index),'td-review-title'));
      row.append(this.element(d,'p',kind==='missing'?'PDF unavailable locally. Restore it from your other device or Zotero file sync.':privateView?'Title and details hidden. Turn off screenshot privacy to review this PDF.':r.reason,'td-review-reason'));
      const actions=this.element(d,'div',null,'td-actions');
      if(kind==='title'&&!privateView) {
        const input=this.element(d,'input',null,'td-input');input.type='text';input.dataset.item=r.id;input.value=drafts.get(String(r.id))??r.title??'';input.placeholder='Enter the exact paper title';input.setAttribute('aria-label','Paper title');row.append(input);
        actions.append(this.button(d,'Use title',()=>this.p.confirmTitle(r.id,input.value),'primary'));
      }
      actions.append(this.button(d,'Show in library',async()=>{const w=Zotero.getMainWindow();w.focus();await w.ZoteroPane.selectItem(r.id);}),
        this.button(d,'Keep original',()=>{this.p.state.managed[r.id]={ignored:true};delete this.p.state.review[r.id];delete this.p.state.pending[r.id];this.p.persist();this.p.refreshWindows();},'ghost'));
      if(kind==='title')actions.append(this.button(d,'Open PDF',()=>Zotero.getMainWindow().ZoteroPane.viewAttachment(r.id),'ghost'));
      row.append(actions);list.append(row);
    });root.append(list);
    if(records.length>this.limit)root.append(this.button(d,`Show more (${records.length-this.limit} remaining)`,()=>{this.limit+=20;this.refresh();}));
  },
  activity(d,root) {
    const events=this.p.state.events.slice(-40).reverse();
    const bar=this.element(d,'div',null,'td-list-toolbar');bar.append(this.element(d,'p','Recent local activity. Renames can be undone one at a time.'),this.button(d,'Undo last rename',()=>this.p.undo()));root.append(bar);
    const list=this.element(d,'section',null,'td-card');
    for(const e of events){const row=this.element(d,'div',null,'td-event');const message=this.p.setting('privateView')?(e.message.startsWith('Renamed:')?'PDF renamed using a verified title':e.message.startsWith('Undo rename:')?'Previous filename restored':e.message):e.message;row.append(this.element(d,'time',new Date(e.time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})),this.element(d,'div',message));list.append(row);}root.append(list);
  },
  widget(win) {
    const d=win.document,s=this.p.summary();
    if(!s.pending||this.widgetDismissed){d.getElementById('titledrop-widget')?.remove();return;}
    if(!d.getElementById('titledrop-css')){const css=this.element(d,'link');css.id='titledrop-css';css.rel='stylesheet';css.href='chrome://titledrop/content/ui.css';d.documentElement.append(css);}
    d.getElementById('titledrop-widget')?.remove();
    const box=this.element(d,'section',null,'td-app td-widget');box.id='titledrop-widget';box.dataset.theme=this.p.setting('theme');box.setAttribute('aria-label','TitleDrop progress');
    const head=this.element(d,'header',null,'td-header');head.append(this.brand(d,s.paused?'Queue paused':`${s.pending} PDF(s) remaining`,true),this.button(d,'×',()=>{this.widgetDismissed=true;box.remove();},'ghost'));box.append(head);
    const meta=this.element(d,'div',null,'td-progress-meta');meta.append(this.element(d,'strong',s.paused?'Waiting for you':'Processing PDFs'),this.element(d,'span',`${s.completed} / ${s.total}`));box.append(meta);
    const track=this.element(d,'div',null,'td-track'),fill=this.element(d,'div',null,'td-fill');fill.style.width=(s.total?Math.round(s.completed/s.total*100):0)+'%';track.append(fill);box.append(track);
    const actions=this.element(d,'div',null,'td-actions');actions.append(this.button(d,s.paused?'Resume':'Pause',()=>s.paused?this.p.resumeQueue():this.p.pauseQueue()),this.button(d,'View details',()=>this.openDashboard(),'primary'));box.append(actions);d.documentElement.append(box);
  },
  async exportReport(win) {
    const {FilePicker}=ChromeUtils.importESModule('chrome://zotero/content/modules/filePicker.mjs');
    const fp=new FilePicker();fp.init(win,'Export TitleDrop report',fp.modeSave);fp.appendFilter('JSON','*.json');fp.defaultString='titledrop-report.json';
    if(await fp.show()===fp.returnCancel)return;
    const report={version:this.p.version,createdAt:new Date().toISOString(),summary:this.p.summary(),
      review:Object.values(this.p.state.review),renames:this.p.state.history,events:this.p.state.events};
    await Zotero.File.putContentsAsync(fp.file,JSON.stringify(report,null,2));this.status(win.document,'Report saved. It contains local paper titles and filenames.');
  }
};
