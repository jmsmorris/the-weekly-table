const {JSDOM}=require('jsdom');const fs=require('fs');
const ROOT=require('path').join(__dirname,'..')+'/';
const indexHtml=fs.readFileSync(ROOT+'index.html','utf8');
const appJs=fs.readFileSync(ROOT+'app.js','utf8');
const recipesJson=fs.readFileSync(ROOT+'recipes.json','utf8');
const URLBASE='https://gitrtnnpmouqulgdejtd.supabase.co';
// ---- fake Supabase ----
const server={docs:{},t:0};
let rpcCount=0;
function rpc(fn,a){
  rpcCount++;
  const code=a.p_code;
  if(!code||code.length<8){if(fn==='wt_put')throw {status:400};return [];}
  const own=Object.keys(server.docs).filter(k=>k.startsWith(code+'|'));
  if(fn==='wt_list')return own.map(k=>({path:k.split('|')[1],updated_at:server.docs[k].t}));
  if(fn==='wt_get')return own.filter(k=>!a.p_paths||a.p_paths.includes(k.split('|')[1])).map(k=>({path:k.split('|')[1],data:server.docs[k].data,updated_at:server.docs[k].t}));
  if(fn==='wt_put'){a.p_rows.forEach(r=>{server.docs[code+'|'+r.path]={data:JSON.parse(JSON.stringify(r.data)),t:'t'+(++server.t)};});return null;}
  if(fn==='wt_del'){delete server.docs[code+'|'+a.p_path];return null;}
}
let temps={base:10},importReply=null,importStatus=200;
function forecast(){
  const days=[],highs=[];
  for(let i=-3;i<=12;i++){const d=new Date();d.setHours(12,0,0,0);d.setDate(d.getDate()+i);days.push(d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0'));highs.push(temps.base);}
  return {daily:{time:days,temperature_2m_max:highs}};
}
function makeFetch(){
  return async function(url,opts){
    const u=String(url);
    const res=(body,status=200)=>({ok:status>=200&&status<300,status,text:async()=>body==null?'':JSON.stringify(body),json:async()=>body});
    if(u==='recipes.json')return {ok:true,status:200,json:async()=>JSON.parse(recipesJson)};
    if(u.startsWith(URLBASE+'/rest/v1/rpc/')){const fn=u.split('/rpc/')[1];try{return res(rpc(fn,JSON.parse(opts.body)));}catch(e){return res(null,e.status||500);}}
    if(u.startsWith(URLBASE+'/functions/v1/import-recipe'))return res(importReply,importStatus);
    if(u.startsWith('https://api.open-meteo.com/'))return res(forecast());
    if(u.startsWith('https://geocoding-api.open-meteo.com/'))return res({results:[{name:'Ottawa',admin1:'Ontario',country_code:'CA',latitude:45.4,longitude:-75.7}]});
    throw new Error('unexpected fetch '+u);
  };
}
function device(hash,key){
  const html=indexHtml.replace('<script src="config.js"></script>','<script>window.WT_CONFIG={supabaseUrl:"'+URLBASE+'",supabaseAnonKey:"'+(key||'sb_publishable_test')+'"};</script>').replace('<script src="app.js"></script>','<script>'+appJs+'</script>');
  const dom=new JSDOM(html,{url:'https://jmsmorris.github.io/the-weekly-table/'+(hash||''),runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.fetch=makeFetch();w.confirm=()=>true;}});
  return dom.window;
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
let fails=0;
const ok=(c,m)=>{console.log((c?'PASS ':'FAIL ')+m);if(!c)fails++;};
const doc=(code,p)=>server.docs[code+'|'+p]&&server.docs[code+'|'+p].data;
(async()=>{
 // 0. not configured
 let w0=device('', 'PASTE_YOUR_ANON_PUBLIC_KEY_HERE');await sleep(100);
 ok(/isn’t connected to its database/.test(w0.document.getElementById('banner').textContent),'unconfigured site shows setup banner');
 // 1. device A: welcome -> create
 const A=device('');await sleep(150);const a=A.document;
 ok(!!a.querySelector('.welcome'),'A sees the welcome screen');
 ok(a.getElementById('boxSection').hidden,'recipe box hidden before setup');
 a.querySelector('[data-action=create-household]').click();await sleep(400);
 const code=A.localStorage.getItem('wt-household');
 ok(/^[A-Z2-9]{10}$/.test(code),'household code generated: '+code);
 const recipeDocs=Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/')).length;
 ok(recipeDocs===112,'seeded 112 recipes ('+recipeDocs+')');
 ok(!!doc(code,'meta/seed'),'seed version recorded');
 ok(a.querySelectorAll('.bcard').length===112,'A shows 112 recipe cards');
 ok(/Household code/.test(a.getElementById('modal').textContent),'settings (invite) opened after create');
 a.querySelector('[data-action=close]').click();
 // 2. generate
 temps.base=3;
 a.querySelector('[data-action=generate]').click();await sleep(300);
 let st=doc(code,'planner/state');
 ok(st&&st.plan&&st.plan.length===7,'plan saved');
 const R=id=>doc(code,'recipes/'+id);
 const meat=st.plan.filter(x=>R(x.recipeId).category==='meat').length;
 ok(meat===3,'3 meat nights');
 ok(R(st.plan[4].recipeId).category==='meat'&&R(st.plan[4].recipeId).shabbat,'Friday is a Shabbat-style meat dish');
 ok(/^\d{4}-\d\d-\d\d$/.test(st.weekStart),'plan records weekStart '+st.weekStart);
 const tabs=[...a.querySelectorAll('.tab')].map(t=>t.textContent);
 ok(tabs.length===7&&/FRI \d+ · SHABBAT · 10°C/.test(tabs[4]),'tabs show date and °C: '+tabs[4]);
 ok(/cool weather/.test(a.getElementById('hint').textContent),'hint says cool weather (10°C forecast): '+a.getElementById('hint').textContent.slice(0,90));
 // 3. device B joins via invite link
 const B=device('#join='+code);await sleep(400);const b=B.document;
 ok(b.querySelectorAll('.daycard').length===7,'B joined via invite link and sees the plan');
 ok(b.querySelectorAll('.bcard').length===112,'B sees the recipe box');
 ok(B.location.hash==='','invite code removed from address bar');
 ok(B.localStorage.getItem('wt-household')===code,'B stored the household');
 // 4. sync A->B
 a.querySelectorAll('[data-action=swap]')[1].click();
 const pick=a.querySelector('[data-action=swap-pick]:not([disabled])');const newId=pick.dataset.id;pick.click();await sleep(200);
 await B.__wtPoll();await sleep(100);
 ok(B.document.querySelectorAll('.daycard')[1].textContent.includes(R(newId).name),'B sees A’s swap after polling');
 // 5. B imports from URL
 b.querySelector('#addBtn').click();
 importReply={name:'Slow Cooker Chicken & Rice',minutes:375,ingredients:['2 lb chicken thighs','1 cup rice','1 onion'],instructions:['Add everything to the slow cooker.','Cook on low 6 hours.'],keywords:'crockpot',source:'good.example'};
 b.getElementById('fUrl').value='https://good.example/recipe';
 b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(b.getElementById('fName').value==='Slow Cooker Chicken & Rice','import prefilled the name');
 ok(b.getElementById('fCat').value==='meat','chicken recipe guessed as meat');
 ok(b.getElementById('fStyle').value==='slow-cooker','slow-cooker style guessed');
 ok(b.getElementById('fMin').value==='375','time prefilled');
 ok(b.getElementById('fIng').value.split('\n').length===3,'ingredients prefilled');
 b.querySelector('[data-action=add-save]').click();await sleep(200);
 const added=Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/c-'));
 ok(added.length===1&&server.docs[added[0]].data.sourceUrl==='https://good.example/recipe','imported recipe saved with source link');
 await A.__wtPoll();await sleep(100);
 ok(a.querySelectorAll('.bcard').length===113,'A sees the imported recipe after polling');
 // 6. mixed meat+dairy and non-kosher warnings
 b.querySelector('#addBtn').click();
 importReply={name:'Chicken Parmesan',minutes:40,ingredients:['4 chicken breasts','1 cup mozzarella','1/2 cup parmesan','1 cup marinara'],instructions:['Bake.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/cp';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/mix meat and dairy/.test(b.getElementById('impMsg').textContent),'meat+dairy import is flagged');
 b.querySelector('[data-action=close]').click();
 b.querySelector('#addBtn').click();
 importReply={name:'Shrimp Pasta',minutes:20,ingredients:['1 lb shrimp','12 oz pasta'],instructions:['Cook.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/sp';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/shrimp.*isn’t kosher/.test(b.getElementById('impMsg').textContent),'shellfish import is flagged');
 b.querySelector('[data-action=close]').click();
 b.querySelector('#addBtn').click();
 importReply={name:'Peanut Butter Noodles',minutes:15,ingredients:['8 oz noodles','3 tbsp peanut butter','1 cup almond milk'],instructions:['Mix.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/pb';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(b.getElementById('fCat').value==='pareve'&&!/mix/.test(b.getElementById('impMsg').textContent),'peanut butter and almond milk are not treated as dairy');
 b.querySelector('[data-action=close]').click();
 // 7. import failures
 b.querySelector('#addBtn').click();importStatus=404;importReply=null;
 b.getElementById('fUrl').value='https://x.example/a';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/isn’t set up yet/.test(b.getElementById('impMsg').textContent),'undeployed function gives a friendly message');
 importStatus=422;importReply={error:'No recipe data found on that page.'};
 b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/No recipe data found/.test(b.getElementById('impMsg').textContent),'server error message shown');
 b.getElementById('fUrl').value='nonsense';b.querySelector('[data-action=import-url]').click();await sleep(50);
 ok(/full web address/.test(b.getElementById('impMsg').textContent),'invalid URL rejected locally');
 importStatus=200;b.querySelector('[data-action=close]').click();
 // 8. weather bias, repeated generation (cold vs hot)
 async function share(base,n){
   temps.base=base;A.localStorage.getItem('x');a.querySelector('[data-action=weather-clear]');
   let h=0,tot=0,bad=0;
   for(let i=0;i<n;i++){
     // reset history so exclusions don't skew the sample
     const cur=doc(code,'planner/state');server.docs[code+'|planner/state'].data={...cur,history:[]};await A.__wtPoll();
     A.live&&0;a.querySelector('[data-action=generate]').click();await sleep(30);
     const s=doc(code,'planner/state');
     s.plan.forEach((x,k)=>{if(k===4)return;tot++;if(R(x.recipeId).warmth===3)h++;});
     const m=s.plan.filter(x=>R(x.recipeId).category==='meat').length;
     if(m!==3||!R(s.plan[4].recipeId).shabbat)bad++;
   }
   return {share:Math.round(h/tot*100),bad};
 }
 // force a fresh forecast fetch each time by zeroing liveAt through settings change path
 const forceLoad=async(base)=>{temps.base=base;a.querySelector('[data-action=settings]').click();a.querySelector('[data-action=loc-search]').click();await sleep(60);a.querySelector('[data-action=loc-pick]').click();await sleep(120);};
 await forceLoad(-2);let cold=await share(-2,50);
 await forceLoad(29);let hot=await share(29,50);
 console.log('   cold hearty share',cold.share+'%','hot hearty share',hot.share+'%');
 ok(cold.share>=75&&hot.share<=25,'forecast changes what gets picked');
 ok(cold.bad===0&&hot.bad===0,'meat cap and Friday rule hold in every generated week');
 ok(doc(code,'planner/settings').name.startsWith('Ottawa'),'weather location change saved and shared');
 // 9. manual override
 a.querySelector('[data-action=weather]').click();
 [...a.querySelectorAll('.wi')].forEach(i=>i.value='20');
 a.querySelector('[data-action=weather-save]').click();await sleep(100);
 ok(doc(code,'planner/weather')&&doc(code,'planner/weather').highs.every(x=>x===20),'manual forecast override saved');
 ok(/forecast you entered/.test(a.getElementById('hint').textContent),'hint reflects the manual override');
 a.querySelector('[data-action=weather]').click();a.querySelector('[data-action=weather-clear]').click();await sleep(100);
 ok(!doc(code,'planner/weather'),'override cleared back to live forecast');
 // 10. wrong code
 const C=device('');await sleep(100);C.document.getElementById('joinCode').value='WRONGCODE1';C.document.querySelector('[data-action=join-household]').click();await sleep(150);
 ok(/No household found/.test(C.document.getElementById('week').textContent),'wrong code shows an error');
 // 11. shopping list + removal of a custom recipe
 a.querySelector('[data-action=export]').click();
 ok(a.getElementById('listText').value.includes('TO BUY'),'shopping list builds');
{ const M=A.__wtMergeIngredients,has=(l,t)=>M(l).includes(t);
  ok(has(['2 eggs','3 eggs, beaten'],'5 eggs'),'shopping list adds 2 eggs + 3 eggs = 5 eggs');
  ok(has(['1 onion, diced','1 onion, 2 carrots, diced','3 onions, sliced'],'5 onions')&&has(['1 onion, 2 carrots, diced'],'2 carrots'),'combined lines are split and prep notes dropped');
  ok(has(['2 cloves garlic, minced','1 clove garlic'],'3 cloves garlic'),'units are matched across singular and plural');
  ok(has(['1 can (28 oz) crushed tomatoes','1 can (28 oz) crushed tomatoes'],'2 cans (28 oz) crushed tomatoes'),'can sizes are kept');
  ok(has(['2 tbsp olive oil, salt, pepper','3 tbsp olive oil','1/4 cup olive oil'],'Olive oil: 1/2 cup + 1 tbsp'),'spoons and cups are added together');
  ok(has(['1 lb pasta','8 oz pasta'],'1 1/2 lb pasta')&&has(['1 lb pasta','10 oz pasta'],'Pasta: 1 lb + 10 oz'),'pounds and ounces are added together');
  ok(M(['Salt and pepper','2 tbsp oil, salt, pepper']).filter(t=>/^salt$/i.test(t)).length===1,'unquantified items appear once');
  ok(has(['3-4 lb brisket'],'4 lb brisket'),'a range buys the upper end');
  const listLines=a.getElementById('listText').value.split('BY NIGHT')[0].split('\n').filter(l=>l.startsWith('[ ]'));
  ok(new Set(listLines.map(l=>l.toLowerCase())).size===listLines.length,'no item is listed twice ('+listLines.length+' items)'); }

  // interactive: tick items already at home, export only the rest
  const boxes=()=>[...a.querySelectorAll('#shopRows input')];
  const exportText=()=>a.getElementById('listText').value;
  const toBuy=()=>exportText().split('BY NIGHT')[0].split('\n').filter(l=>l.startsWith('[ ]'));
  const total=boxes().length, before=toBuy().length;
  ok(total>0&&total===before,'every item gets a checkbox and starts in the export ('+total+')');
  ok(/\d+ to buy · 0 at home/.test(a.getElementById('shopCount').textContent),'counter starts at 0 at home');
  const firstName=boxes()[0].parentNode.textContent.trim();
  const tick=(i,on)=>{const c=boxes()[i];c.checked=on;c.dispatchEvent(new A.Event('change',{bubbles:true}));};
  tick(0,true);tick(1,true);
  ok(toBuy().length===before-2,'ticked items leave the export');
  ok(!toBuy().some(l=>l.includes(firstName)),'the ticked item is not in the exported list');
  ok(boxes()[0].parentNode.classList.contains('have'),'ticked row is struck through');
  ok(new RegExp('^'+(before-2)+' to buy · 2 at home').test(a.getElementById('shopCount').textContent),'counter updates');
  ok(/TO BUY \(\d+ of \d+; the rest is at home\)/.test(exportText()),'export says some items are at home');
  a.querySelector('[data-action=close]').click();a.querySelector('[data-action=export]').click();
  ok(boxes()[0].checked&&boxes()[1].checked&&!boxes()[2].checked,'ticks are remembered when the list is reopened');
  tick(0,false);ok(toBuy().length===before-1,'unticking puts the item back');
  boxes().forEach((c,i)=>{if(!c.checked)tick(i,true);});
  ok(/Nothing to buy/.test(exportText())&&!/BY NIGHT/.test(exportText()),'ticking everything leaves nothing to buy');
  a.querySelector('[data-action=have-clear]').click();
  ok(toBuy().length===before&&boxes().every(c=>!c.checked),'untick all restores the full list');
 a.querySelector('[data-action=close]').click();
 const rm=a.querySelector('[data-action=remove]');ok(!!rm,'custom recipe has a remove button');rm.click();await sleep(150);
 ok(Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/c-')).length===0,'custom recipe removed on server');
 // 12. leaving
 a.querySelector('[data-action=settings]').click();a.querySelector('[data-action=leave]').click();
 ok(!!a.querySelector('.welcome')&&A.localStorage.getItem('wt-household')===null,'leave returns to the welcome screen');
 console.log('\nrpc calls:',rpcCount,'| failures:',fails);
 process.exit(fails?1:0);
})();
