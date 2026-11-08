/* The Weekly Table: static site, shared through Supabase, weather from Open-Meteo. */
(function(){
'use strict';

var CFG=window.WT_CONFIG||{};
var DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
var SHORT=['MON','TUE','WED','THU','FRI','SAT','SUN'];
var MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MEAT_SLOTS=[0,2];
var FRIDAY=4;
var HISTORY_DEPTH=4;
var CAT={meat:{label:'Meat',short:'M'},dairy:{label:'Dairy',short:'D'},pareve:{label:'Pareve',short:'P'}};
var FALLBACK_EMOJI={meat:'🍖',dairy:'🧀',pareve:'🥗'};
var STYLES={'slow-cooker':'Slow cooker','instant-pot':'Instant Pot','one-pot':'One-pot'};
var CODE_CHARS='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
var LS_CODE='wt-household',LS_CACHE='wt-cache-v1';

/* ---------- weather bands (all temperatures in °C) ---------- */
var SEASONAL_HIGHS=[-1,0,5,12,18,24,27,26,22,15,8,2];
var BANDS=[
  {max:5,name:'cold',w:[0.15,0.8,3]},
  {max:13,name:'cool',w:[0.4,1.4,2.2]},
  {max:21,name:'mild',w:[1,1.2,1]},
  {max:27,name:'warm',w:[2.2,1.3,0.4]},
  {max:99,name:'hot',w:[3,1,0.1]}
];

var S={
  code:'',docs:{},known:{},
  recipes:[],map:{},
  planner:{plan:null,weekStart:'',history:[]},
  have:{},
  override:null,
  settings:{name:'Hamilton, ON',lat:43.2557,lon:-79.8711},
  live:{},liveAt:0,liveErr:false,
  loaded:false,online:true,joinErr:'',
  expanded:null,filter:'all',q:'',err:''
};
var chain=Promise.resolve(),pending=0,polling=false,pollTimer=null;
var swapState=null,locResults=[],importSource='';

function $(id){return document.getElementById(id);}
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function isNum(x){return typeof x==='number'&&isFinite(x);}
function pad(n){return (n<10?'0':'')+n;}
function toast(msg){var t=$('toast');t.textContent=msg;t.hidden=false;clearTimeout(toast._t);toast._t=setTimeout(function(){t.hidden=true;},4200);}
function fmtTime(m){m=Number(m)||0;if(m>=90){return (Math.round(m/30)/2)+' hr';}return m+' min';}
function configured(){return !!(CFG.supabaseUrl&&CFG.supabaseAnonKey&&String(CFG.supabaseAnonKey).indexOf('PASTE_')===-1);}

/* ---------- dates ---------- */
function isoDate(d){return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());}
function addDays(iso,n){var d=new Date(iso+'T12:00:00');d.setDate(d.getDate()+n);return isoDate(d);}
function niceDate(iso){var d=new Date(iso+'T12:00:00');return MONTHS[d.getMonth()]+' '+d.getDate();}
function targetWeekStart(){
  var d=new Date();d.setHours(12,0,0,0);
  var dow=(d.getDay()+6)%7; /* Monday = 0 */
  if(dow>=3)d.setDate(d.getDate()+(7-dow)); /* Thursday to Sunday: plan the coming week */
  else d.setDate(d.getDate()-dow);
  return isoDate(d);
}

/* ---------- Supabase (functions only; the table itself is locked) ---------- */
function authHeaders(){
  var h={apikey:CFG.supabaseAnonKey,'Content-Type':'application/json'};
  if(String(CFG.supabaseAnonKey).indexOf('eyJ')===0)h.Authorization='Bearer '+CFG.supabaseAnonKey;
  return h;
}
function baseUrl(){return String(CFG.supabaseUrl).replace(/\/$/,'');}
async function rpc(fn,args){
  var ctl=new AbortController(),t=setTimeout(function(){ctl.abort();},20000);
  try{
    var r=await fetch(baseUrl()+'/rest/v1/rpc/'+fn,{method:'POST',headers:authHeaders(),body:JSON.stringify(args),signal:ctl.signal});
    if(!r.ok){var e=new Error('HTTP '+r.status);e.status=r.status;throw e;}
    var txt=await r.text();
    return txt?JSON.parse(txt):null;
  }finally{clearTimeout(t);}
}

/* ---------- normalizers (shared data is untrusted) ---------- */
function inferWarmth(d){
  if(d.style==='slow-cooker')return 3;
  var n=String(d.name||'').toLowerCase();
  if(/soup|stew|chili|roast|brisket|braise|bake|risotto|curry|ragu|casserole|lasagna|ziti|mac\b|cholent|dal\b|pot pie/.test(n))return 3;
  if(/wrap|salad|taco|burrito|pizza|sandwich|slider|burger|noodle|omelette|frittata|pancake|blintz|bowl/.test(n))return 1;
  return 2;
}
function normRecipe(id,d){
  d=d||{};
  var cat=CAT[d.category]?d.category:'pareve';
  return {
    id:id,name:String(d.name||'Untitled recipe'),category:cat,minutes:Number(d.minutes)||0,
    kidFriendly:d.kidFriendly!==false,emoji:typeof d.emoji==='string'?d.emoji:'',style:STYLES[d.style]?d.style:'',
    ingredients:Array.isArray(d.ingredients)?d.ingredients.map(String):[],
    instructions:Array.isArray(d.instructions)?d.instructions.map(String):[],
    custom:!!d.custom,
    warmth:(Number(d.warmth)>=1&&Number(d.warmth)<=3)?Math.round(Number(d.warmth)):inferWarmth(d),
    shabbat:!!d.shabbat,
    sourceUrl:/^https?:\/\//i.test(String(d.sourceUrl||''))?String(d.sourceUrl):''
  };
}
function normPlanner(d){
  d=d||{};
  var plan=null;
  if(Array.isArray(d.plan)&&d.plan.length===7){
    plan=d.plan.map(function(x,i){return {day:DAYS[i],recipeId:String((x&&x.recipeId)||'')};});
  }
  var hist=Array.isArray(d.history)?d.history.filter(function(w){return w&&Array.isArray(w.recipeIds);}).map(function(w){return {id:w.id||0,recipeIds:w.recipeIds.map(String)};}).slice(-HISTORY_DEPTH):[];
  return {plan:plan,weekStart:/^\d{4}-\d\d-\d\d$/.test(String(d.weekStart||''))?d.weekStart:'',history:hist};
}
function normOverride(d){
  if(!d||!Array.isArray(d.highs)||d.highs.length!==7||!d.highs.every(isNum)||!/^\d{4}-\d\d-\d\d$/.test(String(d.weekStart||'')))return null;
  return {weekStart:d.weekStart,highs:d.highs.slice(),setAt:Number(d.setAt)||0};
}
function normSettings(d){
  if(d&&isNum(Number(d.lat))&&isNum(Number(d.lon))&&typeof d.name==='string'&&d.name)return {name:d.name,lat:Number(d.lat),lon:Number(d.lon)};
  return {name:'Hamilton, ON',lat:43.2557,lon:-79.8711};
}
function rebuild(){
  var rs=[];
  Object.keys(S.docs).forEach(function(p){if(p.indexOf('recipes/')===0&&S.docs[p])rs.push(normRecipe(p.slice(8),S.docs[p]));});
  rs.sort(function(a,b){return a.name.localeCompare(b.name);});
  S.recipes=rs;S.map={};rs.forEach(function(r){S.map[r.id]=r;});
  S.planner=normPlanner(S.docs['planner/state']);
  S.override=normOverride(S.docs['planner/weather']);
  S.settings=normSettings(S.docs['planner/settings']);
}

/* ---------- local cache ---------- */
function saveCache(){
  try{localStorage.setItem(LS_CACHE,JSON.stringify({code:S.code,docs:S.docs,known:S.known}));}catch(e){}
}
function loadCache(){
  try{
    var c=JSON.parse(localStorage.getItem(LS_CACHE)||'null');
    if(c&&c.code===S.code&&c.docs){S.docs=c.docs;S.known=c.known||{};return true;}
  }catch(e){}
  return false;
}

/* ---------- sync ---------- */
async function pullAll(){
  var rows=await rpc('wt_get',{p_code:S.code,p_paths:null});
  S.docs={};S.known={};
  (rows||[]).forEach(function(r){S.docs[r.path]=r.data;S.known[r.path]=r.updated_at;});
  S.online=true;
  return (rows||[]).length;
}
async function poll(){
  if(!S.code||polling||pending>0||!S.loaded)return;
  polling=true;
  try{
    var list=await rpc('wt_list',{p_code:S.code});
    S.online=true;
    var remote={};(list||[]).forEach(function(x){remote[x.path]=x.updated_at;});
    var changed=Object.keys(remote).filter(function(p){return S.known[p]!==remote[p];});
    var gone=Object.keys(S.known).filter(function(p){return !(p in remote);});
    for(var i=0;i<changed.length;i+=50){
      var rows=await rpc('wt_get',{p_code:S.code,p_paths:changed.slice(i,i+50)});
      (rows||[]).forEach(function(r){S.docs[r.path]=r.data;S.known[r.path]=r.updated_at;});
    }
    gone.forEach(function(p){delete S.docs[p];delete S.known[p];});
    if(changed.length||gone.length){rebuild();saveCache();renderAll();}else renderHead();
  }catch(e){S.online=false;renderHead();}
  finally{polling=false;}
}
function startPolling(){
  if(pollTimer)return;
  pollTimer=setInterval(function(){if(document.visibilityState==='visible')poll();},20000);
  document.addEventListener('visibilitychange',function(){if(document.visibilityState==='visible')poll();});
}
function writeError(e){
  console.error(e);
  S.online=false;renderHead();
  toast('Couldn’t save that change. Check your connection and try again.');
}
function writeDocs(rows){
  rows.forEach(function(r){S.docs[r.path]=r.data;S.known[r.path]=null;});
  rebuild();saveCache();renderAll();
  pending++;
  chain=chain.then(function(){return rpc('wt_put',{p_code:S.code,p_rows:rows});}).catch(writeError).then(function(){pending--;});
  return chain;
}
function removeDoc(path){
  delete S.docs[path];delete S.known[path];
  rebuild();saveCache();renderAll();
  pending++;
  chain=chain.then(function(){return rpc('wt_del',{p_code:S.code,p_path:path});}).catch(writeError).then(function(){pending--;});
  return chain;
}
async function seedIfNeeded(){
  try{
    var r=await fetch('recipes.json',{cache:'no-cache'});
    if(!r.ok)return;
    var seed=await r.json();
    var have=S.docs['meta/seed'];
    if((have&&Number(have.version)||0)>=seed.version)return;
    var rows=[];
    seed.recipes.forEach(function(rec){
      var p='recipes/'+rec.id;
      if(!S.docs[p]){var d=Object.assign({},rec);delete d.id;rows.push({path:p,data:d});}
    });
    rows.push({path:'meta/seed',data:{version:seed.version,at:Date.now()}});
    for(var i=0;i<rows.length;i+=40){await writeDocs(rows.slice(i,i+40));}
  }catch(e){console.error('seed failed',e);}
}
function genCode(){
  var out='',a=new Uint32Array(10);
  (window.crypto||window.msCrypto).getRandomValues(a);
  for(var i=0;i<10;i++)out+=CODE_CHARS[a[i]%CODE_CHARS.length];
  return out;
}
function afterJoin(){
  S.loaded=true;S.joinErr='';
  rebuild();saveCache();renderAll();
  startPolling();loadForecast();
}
async function createHousehold(){
  if(!configured())return;
  S.code=genCode();
  try{localStorage.setItem(LS_CODE,S.code);}catch(e){}
  S.docs={};S.known={};S.loaded=true;
  rebuild();renderAll();
  await seedIfNeeded();
  afterJoin();
  openSettings();
  toast('Household created. Share the invite link from Settings.');
}
async function joinHousehold(raw){
  var code=String(raw||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  if(code.length<8){S.joinErr='That code looks too short.';renderAll();return;}
  S.code=code;S.joinErr='';
  try{
    var n=await pullAll();
    if(!n){S.code='';S.joinErr='No household found with that code. Check it and try again.';renderAll();return;}
    try{localStorage.setItem(LS_CODE,code);}catch(e){}
    afterJoin();
    seedIfNeeded();
  }catch(e){
    S.code='';S.joinErr='Couldn’t reach the server. Check your connection and try again.';renderAll();
  }
}
function leaveHousehold(){
  try{localStorage.removeItem(LS_CODE);localStorage.removeItem(LS_CACHE);}catch(e){}
  S.code='';S.docs={};S.known={};S.loaded=false;rebuild();closeModal();renderAll();
}

/* ---------- weather (Open-Meteo, no key needed) ---------- */
async function loadForecast(){
  var s=S.settings;
  try{
    var url='https://api.open-meteo.com/v1/forecast?latitude='+encodeURIComponent(s.lat)+'&longitude='+encodeURIComponent(s.lon)+'&daily=temperature_2m_max&timezone=auto&past_days=3&forecast_days=16';
    var r=await fetch(url);
    if(!r.ok)throw new Error('weather '+r.status);
    var j=await r.json();
    var t=(j.daily&&j.daily.time)||[],v=(j.daily&&j.daily.temperature_2m_max)||[];
    var live={};
    for(var i=0;i<t.length;i++){if(isNum(v[i]))live[t[i]]=Math.round(v[i]);}
    S.live=live;S.liveAt=Date.now();S.liveErr=false;
  }catch(e){S.liveErr=true;}
  renderAll();
}
function bandOf(t){for(var i=0;i<BANDS.length;i++){if(t<=BANDS[i].max)return BANDS[i];}return BANDS[BANDS.length-1];}
function weightFor(r,t){return bandOf(t).w[r.warmth-1];}
function avgOf(a){var s=0;a.forEach(function(x){s+=x;});return s/a.length;}
function highsFor(ws){
  var o=S.override;
  if(o&&o.weekStart===ws)return {highs:o.highs.slice(),source:'manual'};
  var arr=[],have=[];
  for(var i=0;i<7;i++){var v=S.live[addDays(ws,i)];arr.push(isNum(v)?v:null);if(isNum(v))have.push(v);}
  if(have.length){
    var m=avgOf(have);
    return {highs:arr.map(function(v){return v==null?m:v;}),source:'forecast'};
  }
  var seas=SEASONAL_HIGHS[new Date(ws+'T12:00:00').getMonth()];
  return {highs:[seas,seas,seas,seas,seas,seas,seas],source:'seasonal'};
}
function planWeek(){return S.planner.weekStart||targetWeekStart();}
function tabLabel(i){
  var ws=planWeek(),hf=highsFor(ws),dt=new Date(addDays(ws,i)+'T12:00:00'),t=hf.highs[i];
  return SHORT[i]+' '+dt.getDate()+(i===FRIDAY?' · SHABBAT':'')+(isNum(t)?' · '+Math.round(t)+'°C':'');
}

/* ---------- plan logic ---------- */
function excludedIds(history){var s={};history.slice(-HISTORY_DEPTH).forEach(function(w){w.recipeIds.forEach(function(id){s[id]=1;});});return s;}
function pickOne(pool,taken,ex,t){
  var avail=pool.filter(function(r){return !taken[r.id];});
  var fresh=avail.filter(function(r){return !ex[r.id];});
  var src=fresh.length?fresh:avail;
  if(!src.length)return null;
  var tot=0;src.forEach(function(r){tot+=weightFor(r,t);});
  var x=Math.random()*tot;
  for(var i=0;i<src.length;i++){x-=weightFor(src[i],t);if(x<=0)return src[i];}
  return src[src.length-1];
}
function generateWeek(recipes,history,highs){
  var ex=excludedIds(history);
  var meat=recipes.filter(function(r){return r.category==='meat';});
  var rest=recipes.filter(function(r){return r.category!=='meat';});
  var shab=meat.filter(function(r){return r.shabbat;});
  var taken={},days=[null,null,null,null,null,null,null];
  function place(i,pool){
    var r=pickOne(pool,taken,ex,highs[i])||pickOne(recipes,taken,{},highs[i])||recipes[0];
    taken[r.id]=1;days[i]=r;
  }
  place(FRIDAY,shab.length?shab:meat);
  MEAT_SLOTS.forEach(function(i){place(i,meat);});
  for(var i=0;i<7;i++){if(!days[i])place(i,rest);}
  return days.map(function(r,i){return {day:DAYS[i],recipeId:r.id};});
}
function meatCount(plan){return plan.filter(function(d){var r=S.map[d.recipeId];return r&&r.category==='meat';}).length;}

/* ---------- html helpers ---------- */
function emojiOf(r){return r.emoji||FALLBACK_EMOJI[r.category]||'🍽️';}
function photo(r,h){return '<div class="photo c-'+r.category+'" style="height:'+h+'px"><span style="font-size:'+Math.round(h*0.42)+'px">'+esc(emojiOf(r))+'</span></div>';}
function stamp(r,sm){return '<span class="stamp s-'+r.category+(sm?' sm':'')+'" title="'+CAT[r.category].label+'">'+CAT[r.category].short+'</span>';}
function metaRow(r,extra){
  return '<div class="meta"><span>⏱ '+fmtTime(r.minutes)+'</span>'+(r.kidFriendly?'<span>toddler-ready</span>':'')+(r.style?'<span class="pill">'+STYLES[r.style]+'</span>':'')+(extra||'')+'</div>';
}
function detailHtml(r){
  var src='';
  if(r.sourceUrl){var host='';try{host=new URL(r.sourceUrl).hostname.replace(/^www\./,'');}catch(e){}
    if(host)src='<p style="font-size:12px;color:var(--soft)">Source: <a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener noreferrer" style="color:inherit">'+esc(host)+'</a></p>';}
  return '<div class="detail"><div><p class="dlabel">Ingredients</p><ul>'+r.ingredients.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ul></div>'+
         '<div><p class="dlabel">Steps</p><ol>'+r.instructions.map(function(x){return '<li>'+esc(x)+'</li>';}).join('')+'</ol></div>'+src+'</div>';
}
function inWeekSet(){var s={};if(S.planner.plan)S.planner.plan.forEach(function(d){s[d.recipeId]=1;});return s;}

/* ---------- render ---------- */
function renderHead(){
  var el=$('controls'),hint=$('hint');
  if(!configured()||!S.code){el.innerHTML='';hint.innerHTML='';return;}
  var plan=S.planner.plan,mc=plan?meatCount(plan):0,html='';
  html+='<button class="btn-solid" data-action="generate"'+(S.recipes.length?'':' disabled')+'>⟳ '+(plan?'Generate new week':'Build the first week')+'</button>';
  if(plan){
    var dots='';for(var i=0;i<3;i++)dots+='<span class="dot'+(i<mc?' on':'')+'"></span>';
    html+='<div class="meatctr">'+dots+'MEAT '+mc+'/3 THIS WEEK</div>';
    html+='<button class="btn-outline" data-action="export">⇩ Shopping list</button>';
  }
  html+='<button class="btn-outline" data-action="weather">☁ Set forecast</button>';
  html+='<button class="btn-outline" data-action="settings" aria-label="Settings">⚙ Settings</button>';
  el.innerHTML=html;

  var ws=planWeek(),hf=highsFor(ws),av=Math.round(avgOf(hf.highs)),h='';
  h+='<span class="sync '+(S.online?'on':'warn')+'">'+(S.online?'Shared · syncing':'Offline · showing saved data')+'</span>';
  var src=hf.source==='manual'?'forecast you entered':hf.source==='forecast'?'live forecast':(S.liveErr?'seasonal average (forecast unavailable)':'seasonal average');
  h+='<span>Week of '+niceDate(ws)+': '+bandOf(av).name+' weather, ~'+av+'°C average high · '+src+' · '+esc(S.settings.name)+'</span>';
  hint.innerHTML=h;
}
function renderBanner(){
  var h='';
  if(!configured())h='<div class="note err">This site isn’t connected to its database yet. Add the Supabase public key to config.js (see the README, step 2).</div>';
  else if(S.err)h='<div class="note err">'+esc(S.err)+'</div>';
  $('banner').innerHTML=h;
}
function welcomeHtml(){
  return '<div class="welcome"><h2 class="h2">Set up your household</h2>'+
    '<p>One household holds your shared plan, recipe box and forecast settings. Create a new one, or join the one a family member already made with their household code or invite link.</p>'+
    '<button class="btn-solid" data-action="create-household">Create a new household</button>'+
    '<p class="or-line">or join an existing one</p>'+
    '<div class="join-row"><input id="joinCode" class="search" placeholder="Household code" autocapitalize="characters" autocomplete="off" spellcheck="false" maxlength="32">'+
    '<button class="btn-ghost" data-action="join-household">Join</button></div>'+
    (S.joinErr?'<p class="join-err">'+esc(S.joinErr)+'</p>':'')+'</div>';
}
function dayCard(d,i){
  var r=S.map[d.recipeId];
  if(!r){
    return '<article class="daycard"><div class="tab">'+tabLabel(i)+'</div><div class="dc-body" style="padding-top:22px"><h3 class="rname">This recipe is no longer in the box</h3>'+
      '<div class="dc-actions"><button class="btn-ghost" data-action="swap" data-i="'+i+'">⟳ Swap</button></div></div></article>';
  }
  var open=S.expanded===i;
  return '<article class="daycard"><div class="tab">'+tabLabel(i)+'</div>'+photo(r,96)+
    '<div class="dc-body"><div class="row"><h3 class="rname">'+esc(r.name)+'</h3>'+stamp(r)+'</div>'+metaRow(r)+
    (open?detailHtml(r):'')+
    '<div class="dc-actions"><button class="btn-ghost" data-action="view-day" data-i="'+i+'">'+(open?'▴ Hide recipe':'▾ View recipe')+'</button>'+
    '<button class="btn-ghost" data-action="swap" data-i="'+i+'">⟳ Swap</button></div></div></article>';
}
function renderWeek(){
  var el=$('week');
  if(!configured()){el.innerHTML='';return;}
  if(!S.code){el.innerHTML=welcomeHtml();return;}
  if(!S.loaded){el.innerHTML='<div class="loading"><span class="spin"></span>Setting the table…</div>';return;}
  if(!S.recipes.length){el.innerHTML='<div class="note">The recipe box is empty. If this is a new household it will fill in a moment; otherwise save a recipe below.</div>';return;}
  var plan=S.planner.plan;
  if(!plan){el.innerHTML='<div class="note">No week built yet. Tap “Build the first week” above to generate one from the recipe box and this week’s forecast.</div>';return;}
  el.innerHTML='<div class="week">'+plan.map(dayCard).join('')+'</div>';
}
function renderChips(){
  var defs=[['all','All'],['meat','Meat'],['dairy','Dairy'],['pareve','Pareve'],['slow-cooker','Slow cooker'],['instant-pot','Instant Pot'],['one-pot','One-pot'],['notweek','Not in this week']];
  $('chips').innerHTML=defs.map(function(d){return '<button class="chip" data-action="filter" data-f="'+d[0]+'" aria-pressed="'+(S.filter===d[0])+'">'+d[1]+'</button>';}).join('');
}
function renderBox(){
  var sec=$('boxSection');
  sec.hidden=!(configured()&&S.code);
  if(sec.hidden)return;
  renderChips();
  var iw=inWeekSet(),q=S.q.trim().toLowerCase();
  var list=S.recipes.filter(function(r){
    if(S.filter==='notweek'){if(iw[r.id])return false;}
    else if(STYLES[S.filter]){if(r.style!==S.filter)return false;}
    else if(S.filter!=='all'&&r.category!==S.filter)return false;
    if(q&&(r.name+' '+r.ingredients.join(' ')).toLowerCase().indexOf(q)===-1)return false;
    return true;
  });
  $('boxCount').textContent=S.loaded?('· '+list.length+(list.length===S.recipes.length?'':' of '+S.recipes.length)+' recipes'):'';
  if(!S.loaded){$('boxList').innerHTML='<div class="loading"><span class="spin"></span>Loading recipes…</div>';return;}
  if(!list.length){$('boxList').innerHTML='<p class="empty">'+(S.recipes.length?'No recipes match that search.':'Nothing here yet.')+'</p>';return;}
  $('boxList').innerHTML='<div class="bgrid">'+list.map(function(r){
    var inW=iw[r.id];
    return '<div class="bcard">'+photo(r,72)+'<div class="bbody"><div class="row"><p class="bname">'+esc(r.name)+'</p>'+stamp(r,true)+'</div>'+
      metaRow(r,inW?'<span class="pill">in this week</span>':'')+
      '<div class="bactions"><button class="btn-ghost" data-action="view-recipe" data-id="'+esc(r.id)+'">View</button>'+
      (r.custom?'<button class="btn-ghost danger" data-action="remove" data-id="'+esc(r.id)+'"'+(inW?' disabled title="In this week’s plan: swap it out first"':'')+'>Remove</button>':'')+
      '</div></div></div>';
  }).join('')+'</div>';
}
function renderAll(){renderHead();renderBanner();renderWeek();renderBox();}

/* ---------- modals ---------- */
function openModal(html,flush){
  $('modal').innerHTML='<div class="overlay" data-overlay="1" role="dialog" aria-modal="true"><div class="panel'+(flush?' flush':'')+'">'+html+'</div></div>';
}
function closeModal(){$('modal').innerHTML='';swapState=null;}
function mhead(title,sub){
  return '<div class="mhead"><div><p class="dlabel" style="margin-bottom:2px">'+title+'</p>'+(sub?'<p style="font-size:13px;color:var(--soft)">'+sub+'</p>':'')+'</div><button class="xbtn" data-action="close" aria-label="Close">×</button></div>';
}
function viewRecipe(id){
  var r=S.map[id];if(!r)return;
  openModal('<div class="photo-wrap">'+photo(r,140)+'<button class="xbtn" data-action="close" aria-label="Close">×</button></div>'+
    '<div style="padding:20px"><div class="row"><h3 class="rname" style="font-size:19px">'+esc(r.name)+'</h3>'+stamp(r)+'</div>'+
    '<div class="meta"><span style="font-weight:700;color:var(--'+r.category+')">'+CAT[r.category].label+'</span><span>⏱ '+fmtTime(r.minutes)+'</span>'+(r.kidFriendly?'<span>toddler-ready</span>':'')+(r.style?'<span class="pill">'+STYLES[r.style]+'</span>':'')+'</div>'+
    detailHtml(r)+'</div>',true);
}

/* swap */
function openSwap(i,showRecent){
  var plan=S.planner.plan;if(!plan)return;
  swapState={i:i,recent:!!showRecent};
  var cur=S.map[plan[i].recipeId];
  var used={};plan.forEach(function(d){used[d.recipeId]=1;});
  var ex=excludedIds(S.planner.history);
  var mc=meatCount(plan),curMeat=cur&&cur.category==='meat';
  var hasShab=S.recipes.some(function(r){return r.shabbat;});
  var opts=S.recipes.filter(function(r){
    if(r.id===plan[i].recipeId||used[r.id])return false;
    if(!showRecent&&ex[r.id])return false;
    if(i===FRIDAY&&hasShab&&!r.shabbat)return false;
    return true;
  });
  var groups=['meat','dairy','pareve'].map(function(c){
    var items=opts.filter(function(r){return r.category===c;});
    if(!items.length)return '';
    return '<div class="group"><p class="dlabel" style="color:var(--'+c+')">'+CAT[c].label+'</p>'+items.map(function(r){
      var blocked=r.category==='meat'&&(mc-(curMeat?1:0)+1)>3;
      return '<button class="opt" data-action="swap-pick" data-id="'+esc(r.id)+'"'+(blocked?' disabled':'')+'><span>'+esc(emojiOf(r))+' '+esc(r.name)+'</span><small>'+fmtTime(r.minutes)+(blocked?' · meat limit':'')+'</small></button>';
    }).join('')+'</div>';
  }).join('');
  openModal(mhead('Swap '+DAYS[i]+'’s recipe','Currently: '+esc(cur?cur.name:'(removed)')+(i===FRIDAY?'. Friday stays a Shabbat-style meat-and-veggies dinner.':''))+
    '<label class="check"><input type="checkbox" id="swapRecent"'+(showRecent?' checked':'')+'> Include recipes used in the last '+HISTORY_DEPTH+' weeks</label>'+
    '<div class="list">'+(groups||'<p class="empty">Nothing else available. Try including recently used recipes, or save a new one.</p>')+'</div>');
}

/* forecast override */
function openWeather(){
  var ws=targetWeekStart(),hf=highsFor(ws);
  var fields=DAYS.map(function(d,i){return '<label class="field"><span>'+d+' '+esc(niceDate(addDays(ws,i)))+'</span><input class="wi" data-i="'+i+'" type="number" step="1" value="'+Math.round(hf.highs[i])+'"></label>';}).join('');
  openModal(mhead('Forecast for the week of '+esc(niceDate(ws)),'The live forecast for '+esc(S.settings.name)+' is used automatically. Change any high (°C) to override it for this week.')+
    '<div class="form"><div class="two">'+fields+'</div>'+
    '<button class="btn-solid" data-action="weather-save">Use these temperatures</button>'+
    '<button class="btn-ghost" data-action="weather-clear">Go back to the live forecast</button></div>');
}
function saveWeather(clear){
  if(clear){closeModal();removeDoc('planner/weather');toast('Using the live forecast.');return;}
  var vals=[].slice.call(document.querySelectorAll('.wi')).map(function(x){return Number(x.value);});
  if(vals.length!==7||vals.some(function(v){return !isFinite(v);})){toast('Please enter a temperature for every day.');return;}
  closeModal();
  writeDocs([{path:'planner/weather',data:{weekStart:targetWeekStart(),highs:vals,setAt:Date.now()}}]);
  toast('Forecast saved for this week.');
}

/* settings */
function inviteLink(){return location.origin+location.pathname+'#join='+S.code;}
function openSettings(){
  if(!S.code)return;
  openModal(mhead('Settings')+
    '<div class="form">'+
    '<div class="field"><span>Household code</span><div class="code-row"><code id="codeText" class="code">'+esc(S.code)+'</code><button class="btn-ghost" data-action="copy-code">Copy</button></div></div>'+
    '<div class="field"><span>Invite link</span><button class="btn-ghost" data-action="copy-invite" style="align-self:flex-start">Copy invite link</button>'+
    '<small style="font-weight:400;color:var(--soft)">Anyone with this link or code can see and edit your plan. Share it only with family.</small></div>'+
    '<div class="field"><span>Weather location</span><div class="join-row"><input id="locQ" class="search" placeholder="City, e.g. Hamilton" value="'+esc(S.settings.name.split(',')[0])+'"><button class="btn-ghost" data-action="loc-search">Search</button></div>'+
    '<div id="locList" class="list" style="gap:6px"></div><small style="font-weight:400;color:var(--soft)">Currently: '+esc(S.settings.name)+'</small></div>'+
    '<button class="btn-ghost danger" data-action="leave" style="align-self:flex-start">Leave this household on this device</button>'+
    '</div>');
}
async function searchLocation(){
  var q=($('locQ').value||'').trim();if(!q)return;
  var box=$('locList');box.innerHTML='<p class="empty" style="padding:6px 0">Searching…</p>';
  try{
    var r=await fetch('https://geocoding-api.open-meteo.com/v1/search?name='+encodeURIComponent(q)+'&count=5&language=en&format=json');
    var j=await r.json();
    locResults=(j.results||[]).map(function(x){return {name:[x.name,x.admin1,x.country_code].filter(Boolean).join(', '),lat:x.latitude,lon:x.longitude};});
    box.innerHTML=locResults.length?locResults.map(function(x,i){return '<button class="opt" data-action="loc-pick" data-i="'+i+'"><span>'+esc(x.name)+'</span></button>';}).join(''):'<p class="empty" style="padding:6px 0">No matches. Try a nearby larger city.</p>';
  }catch(e){box.innerHTML='<p class="empty" style="padding:6px 0">Couldn’t search just now.</p>';}
}

/* shopping list: merge the same item across recipes ("2 eggs" + "3 eggs" = "5 eggs") */
var UNITS={cup:'cup',cups:'cup',c:'cup',tbsp:'tbsp',tbs:'tbsp',tablespoon:'tbsp',tablespoons:'tbsp',tsp:'tsp',teaspoon:'tsp',teaspoons:'tsp',
  oz:'oz',ounce:'oz',ounces:'oz',lb:'lb',lbs:'lb',pound:'lb',pounds:'lb',g:'g',kg:'kg',ml:'ml',l:'l',
  can:'can',cans:'can',jar:'jar',jars:'jar',clove:'clove',cloves:'clove',slice:'slice',slices:'slice',sprig:'sprig',sprigs:'sprig',
  pint:'pint',pints:'pint',package:'package',packages:'package',pkg:'package',bunch:'bunch',bunches:'bunch',head:'head',heads:'head',
  stalk:'stalk',stalks:'stalk',box:'box',boxes:'box',bag:'bag',bags:'bag',pinch:'pinch',handful:'handful'};
var UNIT_PLURAL={cup:'cups',can:'cans',jar:'jars',clove:'cloves',slice:'slices',sprig:'sprigs',pint:'pints',package:'packages',bunch:'bunches',head:'heads',stalk:'stalks',box:'boxes',bag:'bags',pinch:'pinches',handful:'handfuls'};
var PREP=/^(?:(?:finely|thinly|roughly|coarsely|lightly|very|well|freshly|and|or|into|in|to|cut|thin|thick|small|large|bite[- ]size[d]?|pieces?|strips?|chunks?|cubes?|rounds?|wedges?|halves|quarters|rings|diced|minced|sliced|chopped|halved|quartered|cubed|drained|rinsed|beaten|smashed|grated|shredded|peeled|crushed|melted|softened|scrambled|skinless|boneless|trimmed|torn|juiced|zested|divided|optional|cooked|warmed|toasted|room|temperature|for|serving|garnish|taste|spiralized|mashed|pitted|seeded|stemmed|cored)\b[ ,-]*)+$/i;
function parseQty(s){
  var r=s.match(/^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)\b/);if(r)return {n:parseFloat(r[2]),len:r[0].length}; // a range: buy the upper end
  var m=s.match(/^(\d+)\s+(\d+)\/(\d+)\b/);if(m)return {n:+m[1]+m[2]/m[3],len:m[0].length};
  m=s.match(/^(\d+)\/(\d+)\b/);if(m)return {n:m[1]/m[2],len:m[0].length};
  m=s.match(/^\d+(?:\.\d+)?/);if(m)return {n:parseFloat(m[0]),len:m[0].length};
  return null;
}
function singularWord(w){
  if(/(ss|us|is)$/i.test(w)||w.length<4)return w;
  if(/ies$/i.test(w))return w.slice(0,-3)+'y';
  if(/(oes|ches|shes|xes)$/i.test(w))return w.slice(0,-2);
  if(/s$/i.test(w))return w.slice(0,-1);
  return w;
}
function pluralWord(w){
  if(/s$/i.test(w))return w;
  if(/[^aeiou]y$/i.test(w))return w.slice(0,-1)+'ies';
  if(/(o|ch|sh|x)$/i.test(w))return w+'es';
  return w+'s';
}
function itemKey(name){
  var words=name.toLowerCase().replace(/[^a-z0-9' -]/g,' ').replace(/\s+/g,' ').trim().split(' ');
  words[words.length-1]=singularWord(words[words.length-1]);
  return words.join(' ');
}
function fmtQty(n){
  var whole=Math.floor(n+1e-9),f=n-whole,fr='';
  [[1/4,'1/4'],[1/3,'1/3'],[1/2,'1/2'],[2/3,'2/3'],[3/4,'3/4']].forEach(function(p){if(Math.abs(f-p[0])<0.02)fr=p[1];});
  if(f<0.02)return String(whole);
  if(fr)return (whole?whole+' ':'')+fr;
  return String(Math.round(n*100)/100);
}
// One ingredient line can hold several items ("1 onion, 2 carrots, diced"): split on commas
// outside brackets; parts with a quantity start new items, prep notes ("diced") are dropped,
// and unquantified parts ("salt and pepper") become items without an amount.
function splitIngredient(line){
  var parts=[],depth=0,cur='';
  for(var i=0;i<line.length;i++){var ch=line[i];if(ch==='(')depth++;if(ch===')')depth=Math.max(0,depth-1);
    if(ch===','&&!depth){parts.push(cur);cur='';}else cur+=ch;}
  parts.push(cur);
  var items=[];
  parts.forEach(function(p){
    p=p.trim();if(!p)return;
    var q=parseQty(p);
    if(q){
      var rest=p.slice(q.len).trim(),unit='',um=rest.match(/^([a-zA-Z]+)\.?(?:\s+|$)/);
      if(um&&UNITS[um[1].toLowerCase()]){unit=UNITS[um[1].toLowerCase()];rest=rest.slice(um[0].length);
        var size=rest.match(/^\(([^)]*\d[^)]*)\)\s*/);if(size){unit+=' ('+size[1].trim()+')';rest=rest.slice(size[0].length);}}
      var name=rest.replace(/\([^)]*\)/g,' ').replace(/^of\s+/i,'').replace(/\s+/g,' ').trim();
      if(name)items.push({n:q.n,unit:unit,name:name});
      return;
    }
    var bare=p.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
    if(!bare||PREP.test(bare))return;
    if(/^or\b/i.test(bare)){if(items.length)items[items.length-1].name+=', '+bare;return;}
    bare.split(/\s+and\s+/i).forEach(function(b){b=b.trim();if(b&&!PREP.test(b))items.push({n:null,unit:'',name:b});});
  });
  return items;
}
function mergeItems(lines){
  var groups={},order=[];
  lines.forEach(function(line){
    splitIngredient(String(line||'')).forEach(function(it){
      var k=itemKey(it.name);if(!k)return;
      var g=groups[k];
      if(!g){g=groups[k]={key:k,one:null,many:null,any:it.name,units:{},unitOrder:[],bare:false};order.push(k);}
      if(it.n===null){g.bare=true;return;}
      if(it.unit){if(!g.unitName)g.unitName=it.name;}
      else if(it.n===1){if(!g.one)g.one=it.name;}else if(!g.many)g.many=it.name;
      if(!(it.unit in g.units)){g.units[it.unit]=0;g.unitOrder.push(it.unit);}
      g.units[it.unit]+=it.n;
    });
  });
  // fold cup/tbsp/tsp into one volume and lb/oz into one weight, kept in imperial
  var VOL={cup:48,tbsp:3,tsp:1},WT={lb:16,oz:1};
  function fold(g,table,unitFor){
    var total=0,first=-1;
    g.unitOrder=g.unitOrder.filter(function(u,i){if(table[u]){total+=g.units[u]*table[u];if(first<0)first=i;return false;}return true;});
    if(first<0)return;
    unitFor(total).forEach(function(p,j){g.units[p[1]]=p[0];g.unitOrder.splice(first+j,0,p[1]);});
  }
  function volParts(t){
    t=Math.round(t*12)/12;
    if(t>=12&&(t%16<0.01||t%12<0.01))return [[t/48,'cup']];
    var parts=[],c=t>=12?Math.floor(t/12)*12:0;if(c)parts.push([c/48,'cup']);t-=c;
    var tb=Math.floor(t/3+1e-9);if(tb)parts.push([tb,'tbsp']);t-=tb*3;
    if(t>0.01)parts.push([t,'tsp']);
    return parts;
  }
  function wtParts(t){
    if(t<16)return [[t,'oz']];
    if(t%4<0.01)return [[t/16,'lb']];
    var lb=Math.floor(t/16+1e-9),oz=t-lb*16;
    return oz>0.01?[[lb,'lb'],[oz,'oz']]:[[lb,'lb']];
  }
  return order.map(function(k){
    var g=groups[k];
    fold(g,VOL,volParts);fold(g,WT,wtParts);
    var amounts=g.unitOrder.map(function(u){
      var n=g.units[u],q=fmtQty(n);
      if(!u)return q;
      var base=u.split(' ')[0],sz=u.slice(base.length);
      return q+' '+(n>1&&UNIT_PLURAL[base]?UNIT_PLURAL[base]:base)+sz;
    });
    var cap=function(s){return s.charAt(0).toUpperCase()+s.slice(1);};
    var text;
    if(!amounts.length)text=cap(g.any);
    else if(amounts.length===1&&!g.unitOrder[0]){
      var n=g.units[''],nm=n===1?(g.one||g.many||g.any):(g.many||g.one||g.any);
      if(n!==1&&!g.many){var w=nm.split(' ');w[w.length-1]=pluralWord(w[w.length-1]);nm=w.join(' ');}
      if(n===1&&!g.one){var w1=nm.split(' ');w1[w1.length-1]=singularWord(w1[w1.length-1]);nm=w1.join(' ');}
      text=amounts[0]+' '+nm;
    }
    else if(amounts.length===1)text=amounts[0]+' '+(g.unitName||g.any);
    else text=cap(g.unitName||g.many||g.one||g.any)+': '+amounts.join(' + ');
    return {key:k,text:text};
  }).sort(function(a,b){return a.key.localeCompare(b.key);});
}
function mergeIngredients(lines){return mergeItems(lines).map(function(x){return x.text;});}
window.__wtMergeIngredients=mergeIngredients;
/* items already at home: ticked in the export dialog, remembered on this device for the week */
var shopItems=[];
function loadHave(){
  var ws=planWeek();
  try{var o=JSON.parse(localStorage.getItem('wt-have-v1')||'null');
    if(o&&o.week===ws&&Array.isArray(o.keys)){var h={};o.keys.forEach(function(k){h[k]=1;});return h;}}catch(e){}
  return {};
}
function saveHave(){
  try{localStorage.setItem('wt-have-v1',JSON.stringify({week:planWeek(),keys:Object.keys(S.have)}));}catch(e){}
}
function allLines(){
  var all=[];(S.planner.plan||[]).forEach(function(d){var r=S.map[d.recipeId];if(r)all=all.concat(r.ingredients);});
  return all;
}
// A recipe line is dropped from the by-night section only when every item on it is at home.
function lineAtHome(line,have){
  var items=splitIngredient(String(line||''));
  return items.length>0&&items.every(function(it){return have[itemKey(it.name)];});
}
function buildList(have){
  have=have||{};
  var plan=S.planner.plan,out=['THE WEEKLY TABLE: SHOPPING LIST',''];
  var items=mergeItems(allLines()),need=items.filter(function(x){return !have[x.key];});
  out.push('TO BUY'+(need.length<items.length?' ('+need.length+' of '+items.length+'; the rest is at home)':''),'------------------------------');
  if(need.length)need.forEach(function(x){out.push('[ ] '+x.text);});
  else out.push('Nothing to buy: you have it all at home.');
  var nights=[];
  plan.forEach(function(d){
    var r=S.map[d.recipeId];if(!r)return;
    var lines=r.ingredients.filter(function(ing){return !lineAtHome(ing,have);});
    if(lines.length)nights.push(['',d.day.toUpperCase()+': '+r.name].concat(lines.map(function(ing){return '  - '+ing;})));
  });
  if(nights.length){out.push('','BY NIGHT','------------------------------');nights.forEach(function(n){out=out.concat(n);});}
  return out.join('\n');
}
function openExport(){
  if(!S.planner.plan)return;
  S.have=loadHave();
  shopItems=mergeItems(allLines());
  openModal(mhead('Shopping list','Tick what you already have at home. Only the rest is exported.')+
    '<div class="shopbar"><span id="shopCount" class="mono"></span><button class="btn-ghost" data-action="have-clear">Untick all</button></div>'+
    '<div id="shopRows" class="shoprows">'+shopItems.map(function(x,i){
      return '<label class="shoprow'+(S.have[x.key]?' have':'')+'"><input type="checkbox" data-have="'+i+'"'+(S.have[x.key]?' checked':'')+'><span>'+esc(x.text)+'</span></label>';
    }).join('')+'</div>'+
    '<p class="dlabel" style="margin:14px 0 4px">What will be exported</p>'+
    '<textarea id="listText" class="mono" rows="7" readonly style="width:100%;font-family:\'Space Mono\',ui-monospace,Menlo,monospace;font-size:12px;line-height:1.5;color:var(--text);background:var(--bg);border:1.5px solid var(--line);border-radius:6px;padding:10px"></textarea>'+
    '<div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap"><button class="btn-solid" data-action="copy-list">Copy list</button>'+
    '<button class="btn-ghost" data-action="save-list">Share or save .txt</button></div>');
  refreshShop();
}
function refreshShop(){
  var ta=$('listText');if(!ta)return;
  var have=0;shopItems.forEach(function(x){if(S.have[x.key])have++;});
  ta.value=buildList(S.have);
  $('shopCount').textContent=(shopItems.length-have)+' to buy · '+have+' at home';
}
function toggleHave(i,on){
  var x=shopItems[i];if(!x)return;
  if(on)S.have[x.key]=1;else delete S.have[x.key];
  saveHave();
  var row=document.querySelector('[data-have="'+i+'"]');if(row&&row.parentNode)row.parentNode.classList.toggle('have',!!on);
  refreshShop();
}
function clearHave(){
  S.have={};saveHave();
  [].forEach.call(document.querySelectorAll('#shopRows input'),function(c){c.checked=false;c.parentNode.classList.remove('have');});
  refreshShop();
}
function saveList(){
  var text=$('listText').value,name='weekly-table-shopping-list-'+isoDate(new Date())+'.txt';
  try{
    if(window.File&&navigator.canShare&&navigator.share){
      var f=new File([text],name,{type:'text/plain'});
      if(navigator.canShare({files:[f]})){navigator.share({files:[f],title:'Shopping list'}).catch(function(){});return;}
    }
  }catch(e){}
  var a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([text],{type:'text/plain;charset=utf-8'}));a.download=name;
  document.body.appendChild(a);a.click();document.body.removeChild(a);
  setTimeout(function(){URL.revokeObjectURL(a.href);},2000);
}
function copyText(ta,okMsg){
  var done=function(){toast(okMsg);};
  if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(ta.value).then(done).catch(function(){ta.select();toast('Press and hold to copy the selected text.');});}
  else{ta.select();try{document.execCommand('copy');done();}catch(x){toast('Press and hold to copy the selected text.');}}
}

/* ---------- recipe import helpers ---------- */
var NOT_DAIRY=/\b(peanut|almond|cashew|sunflower|nut|seed|cocoa|shea|apple|soy ?nut) butter\b|\bbutter ?(nut|cup|fly|milk powder substitute)\b|\bbutternut\b|\bcoconut (milk|cream)\b|\b(almond|oat|soy|rice|cashew|hemp|coconut) milk\b|\bcream of tartar\b|\bnon-?dairy\b|\bdairy-free\b|\bpareve\b|\bmargarine\b|\bice cream\b/g;
var MEAT_RE=/\b(chicken|beef|turkey|brisket|steak|lamb|veal|sausages?|hot ?dogs?|meatballs?|meatloaf|ribs?|duck|schnitzel|pastrami|salami|bologna|flanken|chuck|drumsticks?|cutlets?|ground (?:beef|turkey|chicken|lamb)|roast beef|short ribs?)\b/g;
var DAIRY_RE=/\b(milk|cheese|butter|cream|yogh?urt|parmesan|parmigiano|mozzarella|cheddar|ricotta|feta|gouda|brie|mascarpone|cottage cheese|sour cream|half-and-half|ghee|whey|buttermilk|paneer|halloumi|gruyere|provolone|swiss)\b/g;
var NOT_KOSHER_RE=/\b(pork|bacon|ham|prosciutto|pancetta|chorizo|lard|shrimp|prawns?|lobster|crab|clams?|oysters?|mussels?|scallops?|squid|calamari|gelatin)\b/g;
function countMatches(text,re){var m=text.match(re);return m?m.length:0;}
function classifyImport(name,ings){
  var text=(name+' '+ings.join(' ')).toLowerCase();
  var meat=countMatches(text,MEAT_RE);
  var dairy=countMatches(text.replace(NOT_DAIRY,' '),DAIRY_RE);
  var bad=text.match(NOT_KOSHER_RE);
  var cat=meat&&!dairy?'meat':dairy&&!meat?'dairy':(meat&&dairy?(meat>=dairy?'meat':'dairy'):'pareve');
  return {category:cat,mixed:!!(meat&&dairy),notKosher:bad?Array.from(new Set(bad)):[]};
}
function guessStyle(text){
  var t=String(text||'').toLowerCase();
  if(/slow[- ]cooker|crock ?pot/.test(t))return 'slow-cooker';
  if(/instant pot|pressure cook/.test(t))return 'instant-pot';
  if(/one[- ]pot|one[- ]pan/.test(t))return 'one-pot';
  return '';
}
async function importFromUrl(url){
  var h=authHeaders();
  var r=await fetch(baseUrl()+'/functions/v1/'+(CFG.importFunction||'import-recipe'),{method:'POST',headers:h,body:JSON.stringify({url:url,code:S.code})});
  if(r.status===404){var e=new Error('not deployed');e.notDeployed=true;throw e;}
  var j={};try{j=await r.json();}catch(x){}
  if(!r.ok){var er=new Error(j.error||('Import failed ('+r.status+')'));throw er;}
  return j;
}
async function runImport(){
  var url=($('fUrl').value||'').trim(),msg=$('impMsg'),btn=$('impBtn');
  if(!/^https?:\/\/\S+$/i.test(url)){msg.textContent='Paste a full web address that starts with http:// or https://';msg.className='imp-msg bad';msg.hidden=false;return;}
  btn.disabled=true;btn.textContent='Importing…';msg.hidden=true;
  try{
    var j=await importFromUrl(url);
    var ings=(j.ingredients||[]).map(String),steps=(j.instructions||[]).map(String);
    if(!j.name||(!ings.length&&!steps.length))throw new Error('That page didn’t include a recipe we could read.');
    var cls=classifyImport(j.name,ings);
    $('fName').value=String(j.name).slice(0,120);
    if(Number(j.minutes)>0)$('fMin').value=Math.round(Number(j.minutes));
    $('fIng').value=ings.join('\n');
    $('fSteps').value=steps.join('\n');
    $('fCat').value=cls.category;
    var st=guessStyle(j.name+' '+(j.keywords||'')+' '+steps.join(' '));
    $('fStyle').value=st;
    importSource=url;
    var notes=['Imported from '+esc(j.source||'the page')+'. Check the category and edit anything before saving.'];
    if(cls.mixed)notes.push('This recipe appears to mix meat and dairy, so it isn’t kosher as written. Adjust it before saving.');
    if(cls.notKosher.length)notes.push('It mentions '+esc(cls.notKosher.join(', '))+', which isn’t kosher.');
    msg.innerHTML=notes.join(' ');msg.className='imp-msg'+((cls.mixed||cls.notKosher.length)?' bad':'');msg.hidden=false;
  }catch(e){
    msg.textContent=e.notDeployed?'Link import isn’t set up yet (README, step 4). You can still paste a recipe into the form below.':(e.message||'Couldn’t import that link.');
    msg.className='imp-msg bad';msg.hidden=false;
  }finally{btn.disabled=false;btn.textContent='Import';}
}

/* add recipe */
function openAdd(){
  importSource='';
  openModal(mhead('Save a recipe')+
  '<div class="form">'+
  '<div class="import-box"><label class="field"><span>Import from a link</span><div class="join-row"><input id="fUrl" class="search" type="url" inputmode="url" autocapitalize="off" autocorrect="off" placeholder="https://…"><button class="btn-ghost" id="impBtn" data-action="import-url">Import</button></div></label>'+
  '<p id="impMsg" class="imp-msg" hidden></p></div>'+
  '<p class="or-line" style="margin:0">or enter it yourself</p>'+
  '<label class="field"><span>Recipe name</span><input id="fName" placeholder="e.g. Grandma’s brisket"></label>'+
  '<div class="two"><label class="field"><span>Category</span><select id="fCat"><option value="meat">Meat</option><option value="dairy" selected>Dairy</option><option value="pareve">Pareve</option></select></label>'+
  '<label class="field"><span>Total time (minutes)</span><input id="fMin" type="number" min="0" value="20"></label></div>'+
  '<label class="field"><span>Cooking style (optional)</span><select id="fStyle"><option value="">Any</option><option value="slow-cooker">Slow cooker</option><option value="instant-pot">Instant Pot</option><option value="one-pot">One-pot</option></select></label>'+
  '<label class="cb"><input id="fKid" type="checkbox" checked> Toddler-friendly</label>'+
  '<label class="field"><span>Ingredients (one per line)</span><textarea id="fIng" rows="4"></textarea></label>'+
  '<label class="field"><span>Steps (one per line)</span><textarea id="fSteps" rows="4"></textarea></label>'+
  '<p id="fErr" style="color:var(--meat);font-size:13px" hidden></p>'+
  '<button class="btn-solid" data-action="add-save">Save to the recipe box</button></div>');
}
function lines(v){return String(v||'').split('\n').map(function(s){return s.trim();}).filter(Boolean);}
function newId(){return 'c-'+Date.now().toString(36)+'-'+Math.floor(Math.random()*46656).toString(36);}
function saveRecipe(){
  var name=$('fName').value.trim();
  if(!name){var e=$('fErr');e.textContent='Give the recipe a name.';e.hidden=false;return;}
  var rec={name:name,category:$('fCat').value,minutes:Number($('fMin').value)||0,kidFriendly:$('fKid').checked,style:$('fStyle').value,
    ingredients:lines($('fIng').value),instructions:lines($('fSteps').value),custom:true,addedAt:Date.now()};
  if(importSource)rec.sourceUrl=importSource;
  closeModal();
  writeDocs([{path:'recipes/'+newId(),data:rec}]);
  toast('Saved to the recipe box.');
}
function removeRecipe(id){
  var r=S.map[id];if(!r||!r.custom)return;
  if(!window.confirm('Remove “'+r.name+'” from the recipe box for everyone?'))return;
  removeDoc('recipes/'+id);
}

/* ---------- plan writes ---------- */
async function doGenerate(){
  if(!S.liveAt||Date.now()-S.liveAt>30*60000){try{await loadForecast();}catch(e){}}
  var ws=targetWeekStart(),hf=highsFor(ws),p=S.planner,hist=p.history;
  if(p.plan){hist=hist.concat([{id:Date.now(),recipeIds:p.plan.map(function(d){return d.recipeId;})}]).slice(-HISTORY_DEPTH);}
  S.expanded=null;
  writeDocs([{path:'planner/state',data:{plan:generateWeek(S.recipes,hist,hf.highs),weekStart:ws,history:hist,updatedAt:Date.now()}}]);
}
function doSwap(i,id){
  var p=S.planner;if(!p.plan)return;
  var plan=p.plan.map(function(d,k){return k===i?{day:d.day,recipeId:id}:d;});
  closeModal();
  writeDocs([{path:'planner/state',data:{plan:plan,weekStart:p.weekStart||targetWeekStart(),history:p.history,updatedAt:Date.now()}}]);
}

/* ---------- events ---------- */
document.addEventListener('click',function(e){
  var ov=e.target.closest&&e.target.closest('[data-overlay]');
  if(ov&&e.target===ov){closeModal();return;}
  var t=e.target.closest&&e.target.closest('[data-action]');if(!t)return;
  var a=t.dataset.action;
  if(a==='close')closeModal();
  else if(a==='create-household')createHousehold();
  else if(a==='join-household')joinHousehold(($('joinCode')||{}).value);
  else if(a==='generate')doGenerate();
  else if(a==='view-day'){var i=Number(t.dataset.i);S.expanded=S.expanded===i?null:i;renderWeek();}
  else if(a==='view-recipe')viewRecipe(t.dataset.id);
  else if(a==='swap')openSwap(Number(t.dataset.i),false);
  else if(a==='swap-pick'&&swapState)doSwap(swapState.i,t.dataset.id);
  else if(a==='filter'){S.filter=t.dataset.f;renderBox();}
  else if(a==='add-open')openAdd();
  else if(a==='add-save')saveRecipe();
  else if(a==='import-url')runImport();
  else if(a==='remove')removeRecipe(t.dataset.id);
  else if(a==='export')openExport();
  else if(a==='weather')openWeather();
  else if(a==='weather-save')saveWeather(false);
  else if(a==='weather-clear')saveWeather(true);
  else if(a==='settings')openSettings();
  else if(a==='copy-code'){copyText({value:S.code,select:function(){}},'Household code copied.');}
  else if(a==='copy-invite'){copyText({value:inviteLink(),select:function(){}},'Invite link copied.');}
  else if(a==='loc-search')searchLocation();
  else if(a==='loc-pick'){
    var L=locResults[Number(t.dataset.i)];
    if(L){closeModal();S.live={};S.liveAt=0;writeDocs([{path:'planner/settings',data:{name:L.name,lat:L.lat,lon:L.lon}}]);loadForecast();toast('Weather location set to '+L.name+'.');}
  }
  else if(a==='leave'){if(window.confirm('Leave this household on this device? Your data stays safe in the shared household.'))leaveHousehold();}
  else if(a==='copy-list')copyText($('listText'),'Shopping list copied.');
  else if(a==='save-list')saveList();
  else if(a==='have-clear')clearHave();
});
document.addEventListener('change',function(e){
  if(e.target&&e.target.id==='swapRecent'&&swapState)openSwap(swapState.i,e.target.checked);
  if(e.target&&e.target.dataset&&e.target.dataset.have!==undefined)toggleHave(Number(e.target.dataset.have),e.target.checked);
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'&&$('modal').firstChild)closeModal();
  if(e.key==='Enter'&&e.target&&e.target.id==='joinCode')joinHousehold(e.target.value);
});
$('q').addEventListener('input',function(e){S.q=e.target.value;renderBox();});

/* ---------- boot ---------- */
async function boot(){
  renderAll();
  if(!configured())return;
  try{S.code=localStorage.getItem(LS_CODE)||'';}catch(e){S.code='';}
  var m=/^#join=([A-Za-z0-9]{8,32})/.exec(location.hash||''),joining='';
  if(m){joining=m[1].toUpperCase();try{history.replaceState(null,'',location.pathname+location.search);}catch(e){}}
  if(joining&&joining!==S.code){S.code='';await joinHousehold(joining);return;}
  if(!S.code){renderAll();return;}
  if(loadCache()){rebuild();S.loaded=true;}
  renderAll();
  try{
    var n=await pullAll();
    if(!n){S.code='';S.loaded=false;try{localStorage.removeItem(LS_CODE);}catch(e){}S.joinErr='That household no longer exists. Create a new one or join another.';renderAll();return;}
    afterJoin();
    seedIfNeeded();
  }catch(e){
    S.online=false;
    if(!S.loaded){S.err='Couldn’t reach the shared plan. Check your connection and reload.';}
    S.loaded=true;rebuild();renderAll();
    startPolling();
  }
}
window.__wtPoll=poll;
boot();
})();
