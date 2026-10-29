window.addEventListener('load',()=>{
  const plugin=window.arguments[0].plugin;
  plugin.UI.mountDashboard(window,document.getElementById('titledrop-dashboard'));
},{once:true});
window.addEventListener('keydown',event=>{
  if(event.key==='Escape'||((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='w')){event.preventDefault();window.close();}
});
