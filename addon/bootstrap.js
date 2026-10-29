var TitleDrop;
var scope;
var chromeHandle;
const TITLEDROP_PRIVATE_BUILD = true;

async function startup({ rootURI }) {
  await Zotero.initializationPromise;
  chromeHandle = Cc['@mozilla.org/addons/addon-manager-startup;1'].getService(Ci.amIAddonManagerStartup)
    .registerChrome(Services.io.newURI(rootURI + 'manifest.json'), [['content','titledrop','./']]);
  // Private build: Zotero requires an HTTPS update URL. The reserved .invalid
  // placeholder cannot serve software; updates are installed manually.
  const { AddonManager } = ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs');
  const addon = await AddonManager.getAddonByID('titledrop@local');
  if (addon) addon.applyBackgroundUpdates = TITLEDROP_PRIVATE_BUILD ? AddonManager.AUTOUPDATE_DISABLE : AddonManager.AUTOUPDATE_DEFAULT;
  const timers = ChromeUtils.importESModule('resource://gre/modules/Timer.sys.mjs');
  scope = { Zotero, Services, ChromeUtils, IOUtils, PathUtils, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout };
  Services.scriptloader.loadSubScript(rootURI + 'core.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'main.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'ui.js', scope);
  Services.scriptloader.loadSubScript(rootURI + 'storage.js', scope);
  TitleDrop = scope.TitleDrop;
  TitleDrop.rootURI = rootURI;
  TitleDrop.UI = scope.TitleDropUI;
  TitleDrop.storage = scope.TitleDropStorage;
  await TitleDrop.start();
}
function onMainWindowLoad({ window }) { TitleDrop?.addWindow(window); }
function onMainWindowUnload({ window }) { TitleDrop?.removeWindow(window); }
async function shutdown() { await TitleDrop?.stop(); TitleDrop = null; scope = null; chromeHandle?.destruct(); chromeHandle=null; }
function install() {}
function uninstall() {}
