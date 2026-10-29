/* Serialized, atomic local state writes. No library data is stored in the repo. */
var TitleDropStorage = {
  pending:null, writing:null,
  async load(legacyKey) {
    this.path=PathUtils.join(Zotero.DataDirectory.dir,'titledrop-state.json');
    this.legacyKey=legacyKey;
    if(await IOUtils.exists(this.path))return IOUtils.readJSON(this.path);
    const legacy=Zotero.Prefs.get(legacyKey,true);
    return legacy?JSON.parse(legacy):{};
  },
  save(state) {
    this.pending=JSON.parse(JSON.stringify(state));
    if(!this.writing)this.writing=this.drain();
    return this.writing;
  },
  async drain() {
    try {
      while(this.pending) {
        const next=this.pending;this.pending=null;
        await IOUtils.writeJSON(this.path,next,{tmpPath:this.path+'.tmp'});
        if(Zotero.Prefs.get(this.legacyKey,true)!==undefined)Zotero.Prefs.clear(this.legacyKey,true);
      }
    } finally { this.writing=null; }
  },
  async flush() { while(this.writing)await this.writing; }
};
