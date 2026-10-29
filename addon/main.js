/* Zotero 10 integration. All library and file changes use Zotero's APIs. */
var TitleDrop = {
  C: TitleDropCore,
  running: false,
  windows: new Set(), timers: new Map(), busy: new Set(), queue: [], draining: false,
  stateKey: 'extensions.titledrop.state.v1', autoKey: 'extensions.titledrop.auto',
  version: '1.0',

  async start() {
    this.running = true;
    this.state = {managed:{}, pending:{}, review:{}, history:[], events:[], paused:false, batch:null};
    // A corrupt state file must not be silently replaced with an empty state.
    Object.assign(this.state, this.storage?await this.storage.load(this.stateKey):JSON.parse(Zotero.Prefs.get(this.stateKey,true)||'{}'));
    if (Zotero.Prefs.get(this.autoKey, true) === undefined) Zotero.Prefs.set(this.autoKey, true, true);
    Zotero.TitleDrop = this;
    this.observer = Zotero.Notifier.registerObserver({notify: (...args) => this.notify(...args)}, ['item'], 'titledrop');
    for (const win of Zotero.getMainWindows()) this.addWindow(win);
    for (const [id,job] of Object.entries(this.state.pending))if(this.auto()||job.manual)this.schedule(Number(id),4000);
    if (this.UI) await this.UI.start(this);
  },

  auto() { return Zotero.Prefs.get(this.autoKey, true) !== false; },
  setting(name) {
    const defaults = {online:true, download:true, notifications:true, delay:6, theme:'system', privateView:false};
    const value = Zotero.Prefs.get('extensions.titledrop.' + name,true);
    return value === undefined ? defaults[name] : value;
  },
  setSetting(name, value) {
    if (['online','download','notifications','privateView','auto'].includes(name)) value=!!value;
    else if (name==='delay') { value=Number(value); if(![3,6,10].includes(value))throw new Error('Choose a supported import delay.'); }
    else if (name==='theme') { if(!['system','light','dark'].includes(value))throw new Error('Choose a supported theme.'); }
    else throw new Error('Unknown setting.');
    Zotero.Prefs.set('extensions.titledrop.'+name,value,true);
    if (name==='auto' && value) for(const id of Object.keys(this.state.pending))this.schedule(Number(id),100);
    this.refreshWindows();
  },
  pauseQueue() { this.state.paused=true;this.persist();this.refreshWindows(); },
  resumeQueue() {
    this.state.paused=false;
    for(const id of Object.keys(this.state.pending).map(Number)) {
      if(!this.busy.has(id)&&!this.queue.includes(id))this.queue.push(id);
    }
    this.persist();this.refreshWindows();void this.drain();
  },
  reviewKind(record) { return record.kind || (/unavailable locally|not available locally/.test(record.reason)?'missing':'title'); },
  trackJob(id,label='PDF updates') {
    let batch=this.state.batch;
    if(!batch||batch.finishedAt||Object.keys(batch.results).length===batch.ids.length) {
      batch=this.state.batch={label,startedAt:new Date().toISOString(),ids:[],results:{}};
    }
    if(!batch.ids.includes(id))batch.ids.push(id);
    delete batch.results[id];
  },
  summary() {
    const records=Object.values(this.state.review),batch=this.state.batch;
    const pending=Object.keys(this.state.pending).length;
    const missing=records.filter(r=>this.reviewKind(r)==='missing').length;
    const tracked=new Set([...Object.keys(this.state.managed),...Object.keys(this.state.pending),...Object.keys(this.state.review)]).size;
    return {processed:Object.keys(this.state.managed).length,pending,missing,review:records.length-missing,tracked,
      paused:this.state.paused,active:this.busy.size,total:batch?.ids.length||tracked,
      completed:batch?Object.keys(batch.results).length:tracked-pending};
  },
  persist() {
    this.state.history = this.state.history.slice(-80);
    this.state.events = this.state.events.slice(-60);
    if(this.storage)this.storage.save(this.state).catch(e=>Zotero.logError(e));
    else Zotero.Prefs.set(this.stateKey, JSON.stringify(this.state), true);
  },
  event(message) {
    this.state.events.push({time: new Date().toISOString(), message}); this.persist();
    Zotero.debug('TitleDrop: ' + message);
  },
  stop() {
    this.running = false;
    this.UI?.stop();
    if(Zotero.TitleDrop===this)delete Zotero.TitleDrop;
    if (this.observer) Zotero.Notifier.unregisterObserver(this.observer);
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear(); this.queue = [];
    for (const win of [...this.windows]) this.removeWindow(win);
    this.persist();
    return this.storage?.flush();
  },
  notify(event, type, ids) {
    if (!this.running || type !== 'item') return;
    if (event === 'delete' || event === 'trash') {
      for (const id of ids) {
        delete this.state.pending[id]; delete this.state.review[id]; delete this.state.managed[id];
        if (this.timers.has(id)) clearTimeout(this.timers.get(id));
        this.timers.delete(id);
      }
      this.persist(); return;
    }
    if (!this.auto() || !['add','modify'].includes(event)) return;
    for (const id of ids) {
      if (this.busy.has(id)) continue;
      try {
        const item = Zotero.Items.get(id);
        if (!item || item.deleted) continue;
        if (item.isPDFAttachment()) {
          if (this.state.managed[id]?.ignored) continue;
          if (event === 'add') {
            this.state.pending[id] = {added: Date.now(), manual:false};
            this.trackJob(id,'New imports');
            this.schedule(id, this.setting('delay')*1000);
          } else if (this.state.pending[id] || this.state.managed[id] || this.state.review[id]) this.schedule(id, 1500);
        } else if (item.isRegularItem()) {
          for (const childID of item.getAttachments()) {
            if ((this.state.pending[childID] || this.state.managed[childID] || this.state.review[childID]) && !this.state.managed[childID]?.ignored) this.schedule(childID, 1500);
          }
        }
      } catch (e) { Zotero.logError(e); }
    }
    this.persist();
  },
  schedule(id, delay = 100, manual = false) {
    if (!this.running || this.busy.has(id)) return;
    if (manual) {
      this.state.pending[id] = {added: Date.now(), manual:true};
      this.trackJob(id,'Selected PDFs');
      if (this.state.managed[id]) this.state.managed[id].ignored = false;
    } else if(!this.state.pending[id]) {this.state.pending[id]={added:Date.now(),manual:false};this.trackJob(id);}
    if (this.timers.has(id)) clearTimeout(this.timers.get(id));
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id);
      if (!this.queue.includes(id)) this.queue.push(id);
      this.drain();
    }, delay));
    this.persist();
  },
  async drain() {
    if (this.draining || !this.running || this.state.paused) return;
    this.draining = true;
    try {
      while (this.running && !this.state.paused && this.queue.length) {
        const id = this.queue.shift();
        if (this.busy.has(id)) continue;
        this.busy.add(id);
        this.refreshWindows();
        try { await this.process(id); }
        catch (e) {
          Zotero.logError(e);
          if (this.running) this.review(id, '', 'Could not finish: ' + e.message);
        }
        finally {
          this.busy.delete(id);
          const batch=this.state.batch;
          if(batch?.ids.includes(id)&&!this.state.pending[id]) {
            batch.results[id]=this.state.review[id]?this.reviewKind(this.state.review[id]):'processed';
            if(Object.keys(batch.results).length===batch.ids.length)batch.finishedAt=new Date().toISOString();
            this.persist();
          }
          this.refreshWindows();
        }
      }
    } finally { this.draining = false; this.refreshWindows(); }
  },
  nativeBusy(id) {
    try {
      return (Zotero.ProgressQueues.get('recognize')?.getRows() || [])
        .some(row => row.id === id && row.status <= Zotero.ProgressQueue.ROW_PROCESSING);
    } catch (_) { return false; }
  },
  async usable(id) {
    const item = await Zotero.Items.getAsync(id);
    if (!this.running || !item || item.deleted || !item.isPDFAttachment()) return null;
    const library = Zotero.Libraries.get(item.libraryID);
    if (!library?.editable || library.filesEditable === false) throw new Error('This library is read-only.');
    return item;
  },
  async process(id) {
    let item = await this.usable(id);
    if (!item) { delete this.state.pending[id]; delete this.state.review[id]; this.persist(); return; }
    const pending = this.state.pending[id];
    if (this.state.managed[id]?.ignored && !pending?.manual) return;
    let localPath = await item.getFilePathAsync();
    if (!localPath && pending?.download && this.setting('download') && item.isStoredFileAttachment()) {
      try { await Zotero.Sync.Runner.downloadFile(item); }
      catch (e) { Zotero.debug('TitleDrop file download: ' + e.message); }
      if (!this.running) return;
      localPath = await item.getFilePathAsync();
    }
    if (!localPath) throw new Error('PDF is unavailable locally. Restore or sync the file, then retry.');
    if (!item.isStoredFileAttachment() && !pending?.manual) {
      this.review(id, '', 'Linked file: choose Rename Selected PDFs to explicitly rename the external file.'); return;
    }
    if (this.nativeBusy(id)) {
      if (Date.now() - (pending?.added || Date.now()) > 180000) {
        this.review(id, '', 'Zotero is still recognizing this PDF. Retry after it finishes.');
      } else {
        // Leave the native recognizer alone, and retry after this job releases its lock.
        setTimeout(() => { if (this.running) this.schedule(id, 100); }, 3000);
      }
      return;
    }
    if (item.parentID) {
      const parent = await Zotero.Items.getAsync(item.parentID);
      const title = this.C.clean(parent?.getField('title'));
      if (title && !/^\d{4}\.\d{4,5}(v\d+)?$/i.test(title)) {
        await this.rename(item, title, 'Parent item title'); return;
      }
      this.review(id, '', 'The parent item has no usable title. Edit the parent title first.'); return;
    }
    const data = await Zotero.PDFWorker.getRecognizerData(id, true);
    if (!this.running) return;
    const a = this.C.analyze(data, item.attachmentFilename);
    let result = null;
    if (this.setting('online') && !a.ids.conflict && a.ids.arxiv) result = await this.arxiv(a.ids.arxiv, a.text);
    if (this.setting('online') && !result && !a.ids.conflict && !a.ids.arxiv) {
      // A DOI is useful only if its returned title is actually on the opening page.
      for (const doi of a.ids.dois.slice(0, 2)) {
        result = await this.crossref(doi, a.text);
        if (result || !this.running) break;
      }
    }
    if (!this.running) return;
    if (!result && a.candidate.confidence === 'high') {
      result = {title:a.candidate.title, source:a.candidate.source,
        itemType: a.ids.arxiv ? 'preprint' : 'document',
        fields: a.ids.arxiv ? {repository:'arXiv', archiveID:a.ids.arxiv, url:'https://arxiv.org/abs/' + a.ids.arxiv} : {}};
    }
    if (!result) {
      this.review(id, a.candidate.title, a.candidate.reason || 'A reliable title could not be determined. Enter or confirm the paper title.'); return;
    }
    // Network and PDF extraction may take time. Re-check parent/deletion immediately before writing.
    item = await this.usable(id);
    if (!item) return;
    if (item.parentID || this.nativeBusy(id)) {
      setTimeout(() => { if (this.running) this.schedule(id,100); }, 1000); return;
    }
    if (!await this.createParent(item, result)) {
      // Native recognition can win while the DB transaction is waiting to start.
      // Retry from the current parent rather than apply an older fallback title.
      if (this.running && !item.deleted) setTimeout(() => { if(this.running)this.schedule(id,100); },1000);
      return;
    }
    await this.rename(item, result.title, result.source);
  },

  async request(url) {
    const response = await Zotero.HTTP.request('GET', url, {timeout:12000, responseType:'text'});
    if (!this.running) throw new Error('TitleDrop was stopped.');
    return response.responseText;
  },
  async arxiv(id, text) {
    try {
      const html = await this.request('https://arxiv.org/abs/' + encodeURIComponent(id));
      const win = Zotero.getMainWindow();
      const doc = new win.DOMParser().parseFromString(html, 'text/html');
      const meta = name => [...doc.querySelectorAll('meta')].filter(e => e.getAttribute('name') === name).map(e => e.getAttribute('content') || '');
      const title = this.C.clean(meta('citation_title')[0]);
      const pdf = meta('citation_pdf_url')[0] || '';
      const responseID = meta('citation_arxiv_id')[0] || pdf.match(/\/pdf\/([^/?#]+)/)?.[1] || '';
      const norm = v => v.replace(/^arxiv:/i, '').replace(/v\d+$/i, '');
      if (norm(responseID) !== norm(id) || !this.C.plausibleTitle(title) || !this.C.titleAppears(title, text)) return null;
      return {title, itemType:'preprint', source:'Verified arXiv metadata',
        fields:{repository:'arXiv', archiveID:id, url:'https://arxiv.org/abs/' + id, date:meta('citation_date')[0] || ''},
        authors:meta('citation_author')};
    } catch (e) { Zotero.debug('TitleDrop arXiv lookup: ' + e.message); return null; }
  },
  async crossref(doi, text) {
    try {
      const response = JSON.parse(await this.request('https://api.crossref.org/works/' + encodeURIComponent(doi)));
      const m = response.message, title = this.C.clean(m?.title?.[0]);
      if (m?.DOI?.toLowerCase() !== doi.toLowerCase() || !this.C.plausibleTitle(title) || !this.C.titleAppears(title, text)) return null;
      const date = (m.published?.['date-parts']?.[0] || []).join('-');
      return {title, itemType:'journalArticle', source:'Verified DOI metadata',
        fields:{DOI:doi, date, publicationTitle:m['container-title']?.[0] || '', url:'https://doi.org/' + doi},
        creators:(m.author || []).map(x => ({creatorType:'author', firstName:x.given || '', lastName:x.family || x.name || ''})).filter(x => x.lastName)};
    } catch (e) { Zotero.debug('TitleDrop DOI lookup: ' + e.message); return null; }
  },
  async createParent(item, result) {
    if (!this.running || item.parentID || item.deleted) return false;
    return Zotero.DB.executeTransaction(async () => {
      if (item.parentID || item.deleted || !this.running) return false;
      const parent = new Zotero.Item(result.itemType || 'document');
      parent.libraryID = item.libraryID;
      parent.setField('title', result.title);
      for (const [field, value] of Object.entries(result.fields || {})) {
        if (value && Zotero.ItemFields.isValidForType(Zotero.ItemFields.getID(field), parent.itemTypeID)) parent.setField(field,value);
      }
      if (result.creators?.length) parent.setCreators(result.creators);
      else if (result.authors?.length) parent.setCreators(result.authors.map(name => ({creatorType:'author', lastName:name, fieldMode:1})));
      parent.setCollections(item.getCollections());
      await parent.save();
      item.parentID = parent.id;
      await item.save();
      return true;
    });
  },
  async rename(item, title, source, confirmParent = false) {
    if (!this.running || item.deleted) return;
    const quiet = this.state.pending[item.id]?.quiet;
    const filename = this.C.safeFilename(title), previousName = item.attachmentFilename;
    const previousTitle = item.getField('title'), previousParentID = item.parentID;
    const managed = this.state.managed[item.id];
    if (!confirmParent && managed?.title === title && managed?.filename === previousName && previousTitle === title) {
      delete this.state.pending[item.id]; delete this.state.review[item.id]; this.persist(); return;
    }
    const out = {};
    const ok = await item.renameAttachmentFile(filename, {overwrite:false, unique:true, out});
    if (ok !== true) throw new Error('The PDF could not be renamed (missing, locked, or unavailable).');
    if (confirmParent) {
      await this.saveConfirmedTitle(item, title, previousParentID, previousName);
    } else {
      item.setField('title', title);
      await item.saveTx();
    }
    this.state.managed[item.id] = {title, filename:item.attachmentFilename, source, ignored:false};
    delete this.state.pending[item.id]; delete this.state.review[item.id];
    if (previousName !== item.attachmentFilename || previousTitle !== title) {
      this.state.history.push({id:item.id, libraryID:item.libraryID, key:item.key, previousName, previousTitle,
        filename:item.attachmentFilename, title, source, time:new Date().toISOString()});
      this.event('Renamed: ' + title + ' [' + source + ']');
      if (!quiet) this.toast('PDF renamed', title);
    }
    this.persist(); this.refreshWindows();
  },
  async saveConfirmedTitle(item, title, previousParentID, previousName) {
    const renamedFilename = item.attachmentFilename;
    let existingParent;
    try {
      // renameAttachmentFile() saves its own transaction, so it must finish
      // before this one. Parent and attachment metadata then commit together.
      await Zotero.DB.executeTransaction(async () => {
        if (!this.running || item.deleted || item.parentID !== previousParentID || this.nativeBusy(item.id)) {
          throw new Error('This PDF changed during recognition. Review its current title and try again.');
        }
        if (previousParentID) {
          existingParent = await Zotero.Items.getAsync(previousParentID);
          if (!existingParent || existingParent.deleted || !this.running || item.parentID !== previousParentID) {
            throw new Error('The parent item changed. Review the PDF and try again.');
          }
          existingParent.setField('title', title);
          await existingParent.save();
        } else {
          const parent = new Zotero.Item('document');
          parent.libraryID = item.libraryID;
          parent.setField('title', title);
          parent.setCollections(item.getCollections());
          await parent.save();
          item.parentID = parent.id;
        }
        item.setField('title', title);
        await item.save();
      });
    } catch (error) {
      // A database rollback does not restore files or every cached item.
      // Reload committed metadata, then undo only our own filename change.
      const recoveryErrors = [];
      let itemReloaded = false;
      for (const object of [existingParent, item].filter(Boolean)) {
        try { await object.reload(null, true); if (object === item) itemReloaded = true; }
        catch (e) { recoveryErrors.push(e); Zotero.logError(e); }
      }
      if (item.attachmentFilename !== previousName) {
        try {
          if (!itemReloaded) throw new Error('Attachment metadata could not be reloaded; filename recovery was not attempted.');
          if (item.attachmentFilename !== renamedFilename) throw new Error('The filename changed again; it was not overwritten.');
          const restored = await item.renameAttachmentFile(previousName, {overwrite:false, unique:false});
          if (restored !== true) throw new Error('The original filename could not be restored.');
        } catch (e) { recoveryErrors.push(e); Zotero.logError(e); }
      }
      if (recoveryErrors.length) {
        const message = 'The title could not be saved and recovery was incomplete. Check this PDF in Zotero before retrying. ' + error.message;
        this.review(item.id, title, message);
        throw new Error(message);
      }
      throw error;
    }
  },
  review(id, title, reason) {
    if (!this.running) return;
    const prior = this.state.review[id];
    const quiet = this.state.pending[id]?.quiet;
    this.state.review[id] = {id, title, reason, kind:/unavailable locally|not available locally/.test(reason)?'missing':'title',time:new Date().toISOString()};
    delete this.state.pending[id]; this.persist(); this.refreshWindows();
    if (!prior && !quiet) this.toast('Title needs review', 'Tools > TitleDrop > Review Titles');
  },
  async confirmTitle(id, title) {
    title = this.C.clean(title);
    if (title.length < 2) throw new Error('Please enter the paper title.');
    // Reject titles such as "///" before touching a file or bibliographic item.
    this.C.safeFilename(title);
    if (this.busy.has(id)) throw new Error('This PDF is being processed. Try again shortly.');
    this.busy.add(id);
    try {
      const item = await this.usable(id);
      if (!item) throw new Error('This PDF is no longer available.');
      if (this.nativeBusy(id)) throw new Error('Zotero is recognizing this PDF. Try again after it finishes.');
      await this.rename(item,title,'User-confirmed title',true);
    } finally { this.busy.delete(id); this.refreshWindows(); }
  },
  async undo() {
    const record = this.state.history.at(-1);
    if (!record) { this.toast('Nothing to undo', 'No TitleDrop renames have been recorded.'); return; }
    if (this.busy.has(record.id)) throw new Error('This PDF is being processed. Try undo again shortly.');
    const item = await this.usable(record.id);
    if (!item || item.key !== record.key || item.attachmentFilename !== record.filename) {
      throw new Error('The last file has changed since TitleDrop renamed it. No changes were made.');
    }
    if (this.busy.has(item.id)) throw new Error('This PDF is being processed. Try undo again shortly.');
    this.busy.add(item.id);
    try {
      const ok = await item.renameAttachmentFile(record.previousName, {overwrite:false, unique:false});
      if (ok !== true) throw new Error('The original filename is unavailable. No existing file was overwritten.');
      item.setField('title', record.previousTitle); await item.saveTx();
      this.state.managed[item.id] = {ignored:true};
      delete this.state.pending[item.id]; delete this.state.review[item.id];
      this.state.history.pop(); this.event('Undo rename: ' + record.previousName);
      this.toast('Rename undone', 'Bibliographic metadata was kept. Automatic naming is paused for this PDF.');
    } finally { this.busy.delete(item.id); }
  },
  selected(win) {
    const out = new Set();
    for (const item of win.ZoteroPane.getSelectedItems()) {
      if (item.isPDFAttachment()) out.add(item.id);
      else if (item.isRegularItem()) for (const id of item.getAttachments()) if (Zotero.Items.get(id)?.isPDFAttachment()) out.add(id);
    }
    if (!out.size) { this.toast('Select a PDF', 'Select PDF attachments or their parent items in the library.'); return; }
    for (const id of out) this.schedule(id, 100, true);
    this.toast('Processing PDFs', `${out.size} PDF(s) queued. Uncertain titles will appear in Review Titles.`);
  },
  async existingMyLibrary(win) {
    const libraryID = Zotero.Libraries.userLibraryID;
    const library = Zotero.Libraries.get(libraryID);
    if (!library?.editable || library.filesEditable === false) throw new Error('My Library is read-only.');
    const items = await Zotero.Items.getAll(libraryID, false, false);
    if (!this.running) return;
    const pdfs = items.filter(item => item.isPDFAttachment() && !item.deleted
      && (!item.parentID || !Zotero.Items.get(item.parentID)?.deleted));
    // Existing parent titles can be handled quickly, before standalone PDF lookups.
    pdfs.sort((a,b) => Number(!!b.parentID) - Number(!!a.parentID));
    const added = Date.now();
    this.state.batch={label:'My Library',startedAt:new Date().toISOString(),ids:pdfs.map(i=>i.id),results:{}};
    for (const item of pdfs) {
      const id = item.id;
      if (this.busy.has(id)) continue;
      this.state.pending[id] = {added, manual:true, quiet:true, download:true};
      if (this.state.managed[id]) this.state.managed[id].ignored = false;
      if (this.timers.has(id)) clearTimeout(this.timers.get(id));
      this.timers.delete(id);
      if (!this.queue.includes(id)) this.queue.push(id);
    }
    this.event(`Queued existing PDFs in My Library: ${pdfs.length}`);
    if (win) this.UI?.openDashboard('overview');
    this.refreshWindows();
    void this.drain();
    return pdfs.length;
  },
  retryReviews(kind) {
    const records=Object.values(this.state.review).filter(r=>!kind||this.reviewKind(r)===kind);
    this.state.batch={label:kind==='missing'?'Retry unavailable files':'Retry review items',startedAt:new Date().toISOString(),ids:records.map(r=>r.id),results:{}};
    for(const r of records) {
      if(this.busy.has(r.id))continue;
      this.state.pending[r.id]={added:Date.now(),manual:true,quiet:true,download:true};
      if(!this.queue.includes(r.id))this.queue.push(r.id);
    }
    this.persist();this.refreshWindows();void this.drain();
  },
  toast(title, text) {
    if (!this.running || !this.setting('notifications')) return;
    try {
      const p = new Zotero.ProgressWindow({closeOnClick:true});
      p.changeHeadline('TitleDrop — ' + title); p.addDescription(text); p.show(); p.startCloseTimer(5000);
    } catch (e) { Zotero.debug('TitleDrop: ' + title + ': ' + text); }
  },
  addWindow(win) {
    if (!this.running || this.windows.has(win) || !win.ZoteroPane) return;
    this.windows.add(win);
    const d = win.document, make = name => d.createXULElement(name);
    const guard = fn => () => Promise.resolve().then(fn).catch(e => { Zotero.logError(e); this.toast('Action could not finish',e.message); });
    const item = (label, fn) => {
      const el = make('menuitem'); el.setAttribute('label',label); el.addEventListener('command',guard(fn)); return el;
    };
    const menu = make('menu'); menu.id='titledrop-menu'; menu.setAttribute('label','TitleDrop');
    const popup = make('menupopup'); menu.append(popup);
    popup.append(item('Rename Selected PDFs',() => this.selected(win)));
    popup.append(item('Process Existing PDFs in My Library',() => this.existingMyLibrary(win)));
    const review = item('Review Titles',() => this.showReview(win)); review.id='titledrop-review-menu'; popup.append(review);
    popup.append(make('menuseparator'));
    popup.append(item("Settings…",() => this.UI.openSettings()));
    popup.append(item("Processing Dashboard",() => this.UI.openDashboard()));
    popup.append(item("Undo Last Rename",() => this.undo()));
    (d.getElementById('menu_ToolsPopup') || d.getElementById('tools-menu-popup'))?.append(menu);
    const context = item('TitleDrop: Rename Selected PDFs',() => this.selected(win)); context.id='titledrop-context';
    d.getElementById('zotero-itemmenu')?.append(context);
    this.refreshWindows();
  },
  removeWindow(win) {
    for (const id of ['titledrop-menu','titledrop-context','titledrop-panel']) win.document.getElementById(id)?.remove();
    this.windows.delete(win);
  },
  refreshWindows() {
    for (const win of this.windows) {
      const count = Object.values(this.state.review).filter(r=>this.reviewKind(r)==="title").length;
      win.document.getElementById("titledrop-review-menu")?.setAttribute("label",`Review Titles (${count})`);
    }
    this.UI?.refresh();
  },
  showReview(win) { this.UI?.openDashboard('review'); }
};
