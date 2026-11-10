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
 { const seed=JSON.parse(recipesJson).recipes;
   const DAIRY=/cheese|milk|butter|cream|yogh?urt|parmesan|feta|mozzarella|cheddar|ricotta|paneer/i,MEAT=/chicken|beef|turkey|lamb|brisket|steak|sausage|meatball|hot ?dog|bacon|\bham\b/i;
   ok(seed.every(r=>Number.isInteger(r.servings)&&r.servings>=1&&r.servings<=12),'every shipped recipe has a servings estimate');
   ok(seed.every(r=>Array.isArray(r.sides)&&r.sides.length>=1&&r.sides.length<=2&&r.sides.every(x=>typeof x==='string'&&x.length>2&&x.length<=60)),'every shipped recipe has one or two sides');
   ok(seed.filter(r=>r.category==='meat').every(r=>!r.sides.some(x=>DAIRY.test(x))),'sides for meat dishes contain no dairy');
   ok(seed.filter(r=>r.category!=='meat').every(r=>!r.sides.some(x=>MEAT.test(x)))&&seed.filter(r=>r.category!=='dairy').every(r=>!r.sides.some(x=>/milk|butter|cream|cheese|yogh?urt/i.test(x))),'sides for dairy and pareve dishes contain no meat, and pareve dishes get no dairy sides');
   ok(a.querySelectorAll('.bcard .meta').length===112&&[...a.querySelectorAll('.bcard')].every(c=>/serves ~\d+/.test(c.textContent)&&/Round it out:/.test(c.textContent)),'every recipe card shows servings and sides'); }
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
 // 4b. switch two days without dropping either dinner
 { const plan0=()=>doc(code,'planner/state').plan.map(d=>d.recipeId);
   const names=d=>[...d.querySelectorAll('.daycard .rname')].map(x=>x.textContent);
   const before=plan0(),nm0=names(a);
   ok(a.querySelectorAll('[data-action=move]').length===7,'every day card has a switch-day button');
   a.querySelectorAll('[data-action=move]')[0].click();
   const opts=[...a.querySelectorAll('[data-action=move-pick]')];
   ok(opts.length===6&&!opts.some(o=>o.dataset.j==='0'),'switch-day lists the six other days');
   ok(opts.find(o=>o.dataset.j==='1').textContent.includes(nm0[1]),'each option names the dinner on that day');
   const fri=opts.find(o=>o.dataset.j==='4'),monShab=R(before[0]).shabbat;
   ok(fri.disabled===!monShab,'Friday is only offered when the dinner moving there is Shabbat-style ('+(monShab?'it is':'it is not')+')');
   opts.find(o=>o.dataset.j==='1').click();await sleep(200);
   const after=plan0();
   ok(after[0]===before[1]&&after[1]===before[0],'Monday and Tuesday trade places');
   ok(after.slice(2).join()===before.slice(2).join()&&[...after].sort().join()===[...before].sort().join(),'nothing else changes and no dinner is dropped');
   ok(names(a)[0]===nm0[1]&&names(a)[1]===nm0[0]&&!a.getElementById('modal').firstChild,'the cards show the new order and the dialog closes');
   ok(doc(code,'planner/state').plan[0].day==='Monday'&&doc(code,'planner/state').plan[1].day==='Tuesday','day labels stay in place');
   await B.__wtPoll();await sleep(100);
   ok(names(b)[0]===nm0[1]&&names(b)[1]===nm0[0],'the other device sees the switch');
   // Friday: a Shabbat dinner may move to another day, and a non-Shabbat dinner may not take Friday
   const fp=plan0();
   a.querySelectorAll('[data-action=move]')[4].click();
   const fopts=[...a.querySelectorAll('[data-action=move-pick]')];
   ok(fopts.every(o=>o.disabled===!R(fp[+o.dataset.j]).shabbat),'moving Friday’s dinner only offers days whose dinner is Shabbat-style');
   const bad=fopts.find(o=>o.disabled);if(bad){bad.click();await sleep(100);ok(plan0().join()===fp.join(),'a blocked switch changes nothing');}
   a.querySelector('[data-action=close]').click();
   const friOk=fopts.find(o=>!o.disabled);
   if(friOk){a.querySelectorAll('[data-action=move]')[4].click();[...a.querySelectorAll('[data-action=move-pick]')].find(o=>o.dataset.j===friOk.dataset.j).click();await sleep(200);
     ok(R(plan0()[4]).shabbat&&R(plan0()[4]).category==='meat','Friday is still a Shabbat-style meat dish after a switch');}
   // meat count unchanged by any switch
   ok(plan0().filter(id=>R(id).category==='meat').length===before.filter(id=>R(id).category==='meat').length,'the number of meat nights is unchanged');
   // switch back so later steps see the original order
   a.querySelectorAll('[data-action=move]')[0].click();[...a.querySelectorAll('[data-action=move-pick]')].find(o=>o.dataset.j==='1').click();await sleep(200); }
 // 4c. servings and sides on the week's cards and in the recipe view
 { const cards=[...a.querySelectorAll('.daycard')];
   ok(cards.length===7&&cards.every(c=>/serves ~\d+/.test(c.textContent)&&/Round it out:/.test(c.querySelector('.sides').textContent)),'every day card shows servings and sides');
   const rid=doc(code,'planner/state').plan[0].recipeId;
   ok(cards[0].querySelector('.sides').textContent.includes(R(rid).sides[0]),'the day card shows the recipe’s own sides');
   a.querySelector('[data-action=view-day]').click();
   a.querySelector('[data-action=view-day]').click(); }
 // 4d. a household set up before servings existed gets them added once, custom recipes untouched
 { const keys=Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/')&&!server.docs[k].data.custom);
   const custom=Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/')&&server.docs[k].data.custom).map(k=>[k,JSON.stringify(server.docs[k].data)]);
   keys.forEach(k=>{delete server.docs[k].data.servings;delete server.docs[k].data.sides;});
   server.docs[code+'|meta/seed'].data.version=1;
   const before=Object.fromEntries(keys.map(k=>[k,JSON.stringify(Object.assign({},server.docs[k].data,{servings:0,sides:0}))]));
   device('#join='+code);await sleep(1200);
   const done=keys.filter(k=>server.docs[k].data.servings>=1&&server.docs[k].data.sides.length>=1);
   ok(keys.length===112&&done.length===112,'an existing household gets servings and sides added to its recipes ('+done.length+'/'+keys.length+')');
   ok(keys.every(k=>JSON.stringify(Object.assign({},server.docs[k].data,{servings:0,sides:0}))===before[k]),'nothing else in those recipes changes');
   ok(custom.every(([k,v])=>JSON.stringify(server.docs[k].data)===v),'your own recipes are not touched');
   ok(server.docs[code+'|meta/seed'].data.version===2,'the seed version moves on so this runs once'); }
 // 4e. thumbs up and thumbs down
 { const seedR=JSON.parse(recipesJson).recipes,planIds=()=>doc(code,'planner/state').plan.map(d=>d.recipeId);
   const rid=planIds()[2],nm=R(rid).name;
   const boxCard=(d,name)=>[...d.querySelectorAll('.bcard')].find(c=>c.querySelector('.bname').textContent===name);
   const dayBtn=(d,v)=>d.querySelectorAll('.daycard')[2].querySelector('[data-action=rate][data-v="'+v+'"]');
   const rating=id=>doc(code,'ratings/'+id)&&doc(code,'ratings/'+id).v;
   ok(a.querySelectorAll('.daycard [data-action=rate]').length===14,'every day card has thumbs up and thumbs down');
   dayBtn(a,1).click();await sleep(200);
   ok(rating(rid)===1,'a thumbs up is saved for the household');
   ok(dayBtn(a,1).classList.contains('on')&&dayBtn(a,1).getAttribute('aria-pressed')==='true'&&dayBtn(a,-1).getAttribute('aria-pressed')==='false','the thumbs up shows as pressed');
   ok(/liked/.test(boxCard(a,nm).textContent),'the recipe box marks it as liked');
   a.querySelector('[data-action=filter][data-f=liked]').click();
   ok(a.querySelectorAll('.bcard').length===1&&boxCard(a,nm),'the Liked filter lists it');
   a.querySelector('[data-action=filter][data-f=all]').click();
   await B.__wtPoll();await sleep(100);
   ok(b.querySelectorAll('.daycard')[2].querySelector('[data-action=rate][data-v="1"]').getAttribute('aria-pressed')==='true','the other device sees the rating');
   dayBtn(a,1).click();await sleep(200);
   ok(rating(rid)===undefined&&dayBtn(a,1).getAttribute('aria-pressed')==='false','tapping again clears the rating');
   dayBtn(a,-1).click();await sleep(200);
   ok(rating(rid)===-1&&/out of rotation/.test(boxCard(a,nm).textContent)&&boxCard(a,nm).classList.contains('disliked'),'a thumbs down marks it out of rotation');
   ok(planIds()[2]===rid,'rating a dinner already in the week does not change the week');
   dayBtn(a,1).click();await sleep(200);
   ok(rating(rid)===1,'switching from thumbs down to thumbs up replaces the rating');
   dayBtn(a,1).click();await sleep(200);
   // swap picker hides disliked recipes and lists liked ones first
   const other=seedR.find(r=>!planIds().includes(r.id)&&r.category==='dairy'&&!r.shabbat),otherId=other.id;
   const picks=()=>[...a.querySelectorAll('[data-action=swap-pick]')].map(x=>x.dataset.id);
   a.querySelectorAll('[data-action=swap]')[1].click();
   ok(picks().includes(otherId)&&!/Hiding/.test(a.getElementById('modal').textContent),'before a thumbs down the recipe is offered in the swap picker');
   a.querySelector('[data-action=close]').click();
   boxCard(a,other.name).querySelector('[data-action=rate][data-v="-1"]').click();await sleep(200);
   a.querySelectorAll('[data-action=swap]')[1].click();
   ok(!picks().includes(otherId)&&/Hiding 1 recipe with a thumbs down/.test(a.getElementById('modal').textContent),'a disliked recipe is hidden from the swap picker, with a note');
   a.querySelector('[data-action=close]').click();
   const likedPick=seedR.find(r=>!planIds().includes(r.id)&&r.category==='dairy'&&!r.shabbat&&r.id!==otherId);
   boxCard(a,likedPick.name).querySelector('[data-action=rate][data-v="1"]').click();await sleep(200);
   a.querySelectorAll('[data-action=swap]')[1].click();
   const firstDairy=a.querySelector('#modal .group:nth-of-type(1) [data-action=swap-pick]');
   const dairyGroup=[...a.querySelectorAll('#modal .group')].find(g=>/dairy/i.test(g.querySelector('.dlabel').textContent));
   ok(dairyGroup.querySelector('[data-action=swap-pick]').dataset.id===likedPick.id&&/👍/.test(dairyGroup.querySelector('[data-action=swap-pick]').textContent),'liked recipes are listed first in the swap picker');
   a.querySelector('[data-action=close]').click();
   boxCard(a,other.name).querySelector('[data-action=rate][data-v="-1"]').click();boxCard(a,likedPick.name).querySelector('[data-action=rate][data-v="1"]').click();await sleep(200);
   ok(rating(otherId)===undefined&&rating(likedPick.id)===undefined,'ratings are cleared again');
   // junk in a rating doc is ignored
   const rid3=planIds()[3];server.docs[code+'|ratings/'+rid3]={data:{v:5},t:'tjunk'};await A.__wtPoll();await sleep(100);
   ok(a.querySelectorAll('.daycard')[3].querySelectorAll('[data-action=rate].on').length===0,'an invalid rating value is ignored');
   delete server.docs[code+'|ratings/'+rid3];await A.__wtPoll();await sleep(50); }
 // 4f. ratings steer the generated week
 { const G=A.__wtGenerate,recs=JSON.parse(recipesJson).recipes,highs=[15,15,15,15,15,15,15];
   const weeks=(n,hist,rt)=>Array.from({length:n},()=>G(recs,hist,highs,rt));
   const dis={};recs.forEach((r,i)=>{if(i%3===0&&!r.shabbat)dis[r.id]=-1;});
   const wd=weeks(400,[],dis);
   ok(wd.every(w=>w.every(d=>dis[d.recipeId]!==-1)),'disliked recipes never appear while other recipes can fill the week ('+Object.keys(dis).length+' disliked)');
   const W2=recs.filter(r=>r.category!=='meat'&&r.warmth===2),liked={};W2.slice(0,4).forEach(r=>{liked[r.id]=1;});
   const cnt={};weeks(800,[],liked).forEach(w=>w.forEach(d=>{cnt[d.recipeId]=(cnt[d.recipeId]||0)+1;}));
   const lk=W2.slice(0,4).reduce((s,r)=>s+(cnt[r.id]||0),0)/4,ct=W2.slice(4).reduce((s,r)=>s+(cnt[r.id]||0),0)/(W2.length-4);
   ok(lk>ct*2,'liked recipes come up more than twice as often as similar ones ('+(lk/ct).toFixed(1)+'x)');
   const hist=[{id:1,recipeIds:W2.slice(0,4).map(r=>r.id)}];
   ok(weeks(300,hist,liked).every(w=>w.every(d=>!liked[d.recipeId])),'a liked recipe still waits out the four-week rule');
   const noShab={};recs.filter(r=>r.shabbat).forEach(r=>{noShab[r.id]=-1;});
   ok(weeks(150,[],noShab).every(w=>{const f=recs.find(r=>r.id===w[4].recipeId);return f.shabbat&&f.category==='meat';}),'Friday is still a Shabbat dish even if every one is disliked');
   const noMeat={};recs.filter(r=>r.category==='meat').forEach(r=>{noMeat[r.id]=-1;});
   ok(weeks(150,[],noMeat).every(w=>w.filter(d=>recs.find(r=>r.id===d.recipeId).category==='meat').length===3),'the three meat nights are still filled if every meat dish is disliked');
   ok(weeks(100,[],{}).every(w=>new Set(w.map(d=>d.recipeId)).size===7),'a week never repeats a dinner'); }
 // 5. B imports from URL
 b.querySelector('#addBtn').click();
 importReply={name:'Slow Cooker Chicken & Rice',minutes:375,servings:6,ingredients:['2 lb chicken thighs','1 cup rice','1 onion'],instructions:['Add everything to the slow cooker.','Cook on low 6 hours.'],keywords:'crockpot',source:'good.example'};
 b.getElementById('fUrl').value='https://good.example/recipe';
 b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(b.getElementById('fName').value==='Slow Cooker Chicken & Rice','import prefilled the name');
 ok(b.getElementById('fCat').value==='meat','chicken recipe guessed as meat');
 ok(b.getElementById('fStyle').value==='slow-cooker','slow-cooker style guessed');
 ok(b.getElementById('fMin').value==='375','time prefilled');
 ok(b.getElementById('fIng').value.split('\n').length===3,'ingredients prefilled');
 ok(b.getElementById('fServ').value==='6','servings prefilled from the page');
 b.querySelector('[data-action=add-save]').click();await sleep(200);
 const added=Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/c-'));
 ok(added.length===1&&server.docs[added[0]].data.sourceUrl==='https://good.example/recipe','imported recipe saved with source link');
 await A.__wtPoll();await sleep(100);
 ok(a.querySelectorAll('.bcard').length===113,'A sees the imported recipe after polling');
 { const card=[...a.querySelectorAll('.bcard')].find(c=>/Slow Cooker Chicken & Rice/.test(c.textContent));
   ok(server.docs[added[0]].data.servings===6,'servings are saved with the recipe');
   ok(card&&/serves ~6/.test(card.textContent),'a saved recipe shows its servings');
   ok(card&&/Round it out:/.test(card.textContent)&&!/chicken|cheese|milk/i.test(card.querySelector('.sides').textContent),'a recipe with no sides of its own gets a dairy- and meat-free suggestion'); }
 // 6. mixed meat+dairy and non-kosher warnings
 b.querySelector('#addBtn').click();
 importReply={name:'Chicken Parmesan',minutes:40,ingredients:['4 chicken breasts','1 cup mozzarella','1/2 cup parmesan','1 cup marinara'],instructions:['Top with mozzarella and parmesan.','Bake.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/cp';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/mix meat and dairy/.test(b.getElementById('impMsg').textContent),'meat+dairy import is flagged');
 { const imp=()=>b.getElementById('impMsg'),boxes=()=>[...imp().querySelectorAll('[data-swap]')],btn=()=>b.getElementById('applyBtn');
   const box=t=>boxes().find(c=>c.parentNode.textContent.includes(t));
   const orig=b.getElementById('fIng').value,origSteps=b.getElementById('fSteps').value;
   ok(boxes().length===3&&boxes().every(c=>!c.checked),'each swap is a checkbox, none ticked until you pick a route');
   ok(btn().disabled,'apply is disabled while nothing is ticked');
   ok(/“1 cup mozzarella”\s*→\s*“1 cup dairy-free cheese”/.test(imp().textContent),'a swap previews the line before and after');
   ok(/Also updates 1 step/.test(box('mozzarella').parentNode.textContent),'a swap says it also updates the steps');
   ok(/pareve/.test(imp().textContent),'suggestions remind you to look for pareve certification');
   imp().querySelector('[data-route=meat]').click();
   ok(box('mozzarella').checked&&box('parmesan').checked&&!box('chicken').checked&&/Apply 2 swaps/.test(btn().textContent),'keep it a meat dish ticks the dairy swaps');
   box('mozzarella').click();
   ok(!box('mozzarella').checked&&/Apply 1 swap$/.test(btn().textContent)&&box('mozzarella').parentNode.classList.contains('off'),'unticking a swap removes it from the count');
   btn().click();
   ok(/1 cup mozzarella/.test(b.getElementById('fIng').value)&&/1\/2 cup nutritional yeast/.test(b.getElementById('fIng').value)&&/4 chicken breasts/.test(b.getElementById('fIng').value),'only the ticked swap is made in the ingredients');
   ok(b.getElementById('fSteps').value.split('\n')[0]==='Top with mozzarella and nutritional yeast.','the ticked swap is made in the steps too');
   ok(/Applied 1 swap/.test(imp().textContent)&&/still mixes meat and dairy/.test(imp().textContent),'a partial apply reports what is left');
   imp().querySelector('[data-action=undo-swaps]').click();
   ok(b.getElementById('fIng').value===orig&&b.getElementById('fSteps').value===origSteps&&boxes().length===3,'undo restores the imported recipe');
   imp().querySelector('[data-route=meat]').click();btn().click();
   ok(/dairy-free cheese/.test(b.getElementById('fIng').value)&&/nutritional yeast/.test(b.getElementById('fIng').value)&&/4 chicken breasts/.test(b.getElementById('fIng').value),'applying the meat route swaps all the dairy');
   ok(b.getElementById('fCat').value==='meat'&&/now look kosher/.test(imp().textContent)&&!imp().querySelector('[data-swap]'),'a full apply makes it a kosher meat dish');
   b.querySelector('[data-action=close]').click();b.querySelector('#addBtn').click();
   importReply={name:'Beef Lasagna',minutes:60,ingredients:['1 lb ground beef','2 cups ricotta','1 jar marinara'],instructions:['Brown the ground beef.','Layer and bake.'],source:'x.example'};
   b.getElementById('fUrl').value='https://x.example/lasagna';b.querySelector('[data-action=import-url]').click();await sleep(100);
   imp().querySelector('[data-route=dairy]').click();btn().click();
   ok(b.getElementById('fIng').value.split('\n')[0]==='1 lb plant-based ground meat (such as Impossible)'&&/2 cups ricotta/.test(b.getElementById('fIng').value),'keep it a dairy dish swaps ground beef for plant-based ground meat');
   ok(/Brown the plant-based ground meat/.test(b.getElementById('fSteps').value)&&b.getElementById('fCat').value==='dairy','the steps follow and the category becomes dairy'); }
 b.querySelector('[data-action=close]').click();
 b.querySelector('#addBtn').click();
 importReply={name:'Shrimp Pasta',minutes:20,ingredients:['1 lb shrimp','12 oz pasta'],instructions:['Cook.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/sp';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/shrimp.*isn’t kosher/.test(b.getElementById('impMsg').textContent),'shellfish import is flagged');
 ok(/shrimp\s*→\s*cod chunks/.test(b.getElementById('impMsg').textContent)&&b.getElementById('impMsg').querySelector('[data-swap]').checked,'shellfish import suggests kosher fish, ticked by default');
 b.querySelector('[data-action=close]').click();
 b.querySelector('#addBtn').click();
 importReply={name:'Peanut Butter Noodles',minutes:15,ingredients:['8 oz noodles','3 tbsp peanut butter','1 cup almond milk'],instructions:['Mix.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/pb';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(b.getElementById('fCat').value==='pareve'&&!/mix/.test(b.getElementById('impMsg').textContent),'peanut butter and almond milk are not treated as dairy');
 ok(!/Simple swaps/.test(b.getElementById('impMsg').textContent),'a kosher import gets no swap suggestions');
 b.querySelector('[data-action=close]').click();
 b.querySelector('#addBtn').click();
 importReply={name:'Odd Dish',minutes:20,ingredients:['1 lb chicken <img src=x onerror=alert(1)>','1 cup milk <script>window.pwned=1</script>'],instructions:['Cook.'],source:'x.example'};
 b.getElementById('fUrl').value='https://x.example/xss';b.querySelector('[data-action=import-url]').click();await sleep(100);
 ok(/Simple swaps/.test(b.getElementById('impMsg').textContent)&&!b.getElementById('impMsg').querySelector('img,script'),'page text in suggestions is escaped');
 { const K=A.__wtKosherFixes,AP=A.__wtApplyFixes;
   const cls=(meat,dairy,cat,bad)=>({category:cat||(meat>=dairy?'meat':'dairy'),mixed:!!(meat&&dairy),meat,dairy,notKosher:bad||[]});
   const all=r=>[].concat(r.common,r.meat,r.dairy);
   const swap=(ings,steps,c,id)=>{const fx=K(ings,steps,c);const on={};on[id]=1;return {fx,out:t=>AP(t,fx.defs,on)};};
   const find=(fx,from)=>all(fx).find(x=>x.from===from);
   let fx=K(['1 lb beef','2 tbsp butter','1 cup milk'],[],cls(1,2,'meat'));
   ok(find(fx,'butter').to==='margarine'&&find(fx,'milk').to==='unsweetened soy milk','butter becomes margarine and milk becomes plant milk');
   fx=K(['1 lb ground beef','2 cups cheese'],[],cls(1,1,'dairy'));
   ok(/plant-based ground meat \(such as Impossible\)/.test(find(fx,'ground beef').to),'ground beef becomes plant-based ground meat');
   fx=K(['1 lb beef','2 tbsp peanut butter','1 cup almond milk','1 butternut squash','Butter lettuce','1 cup milk'],[],cls(1,1,'meat'));
   ok(!find(fx,'butter')&&fx.meat.length===1&&fx.meat[0].from==='milk','peanut butter, almond milk, butternut and butter lettuce are left alone');
   fx=K(['1 cup chicken broth','1 cup milk'],[],cls(1,1,'meat'));
   ok(fx.dairy.some(x=>x.from==='chicken broth'&&x.to==='vegetable broth'),'meat broth is swapped when the dish stays dairy');
   const bk=K(['4 slices bacon','1 cup parmesan'],['Fry the bacon.'],cls(0,1,'dairy',['bacon']));
   ok(bk.common.length===1&&bk.common[0].to==='plant-based bacon'&&bk.common[0].steps===1,'bacon in a dairy dish gets a plant-based swap');
   ok(['2 cups dairy-free cheese','1 cup non-dairy sour cream','1 cup plain plant-based yogurt','1 cup plant milk','1/2 cup non-dairy cream cheese'].every(l=>A.__wtClassify('',[l,'1 lb beef']).dairy===0),'swapped-in dairy-free foods are not counted as dairy');
   const bm=K(['1 lb ground pork','4 slices cheddar'],[],cls(1,1,'meat',['pork']));
   ok(bm.meat.some(x=>x.from==='ground pork'&&x.to==='ground beef')&&bm.dairy.some(x=>x.from==='ground pork'&&/plant-based ground meat/.test(x.to)),'a non-kosher meat gets a swap that fits each route');
   let t=swap(['1 cup cream cheese and cheddar'],[],cls(1,1,'meat'),K(['1 cup cream cheese and cheddar'],[],cls(1,1,'meat')).meat.find(x=>x.from==='cheddar').id);
   ok(t.out('1 cup cream cheese and cheddar')==='1 cup cream cheese and dairy-free cheese','"cream cheese" is not swapped when only "cheddar" is ticked');
   ok(swap(['Butter, softened'],[],cls(1,1,'meat'),K(['Butter, softened'],[],cls(1,1,'meat')).meat[0].id).out('Butter, softened')==='Margarine, softened','a swap keeps a leading capital letter');
   ok(AP('2 tbsp butter',K(['2 tbsp butter','1 lb beef'],[],cls(1,1,'meat')).defs,{})==='2 tbsp butter','with nothing ticked nothing changes'); }
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
  { const S2=A.__wtSuggestSides,mk=(name,ings)=>({name,ingredients:ings});
    const none=S2(mk('Plain pasta',['12 oz pasta','1 tbsp olive oil']));
    ok(none.length<=2&&none.some(x=>/chickpeas|edamame|bean/i.test(x)),'a dish with no protein is offered a protein side');
    ok(S2(mk('Chicken',['2 lb chicken','1 cup rice'])).length===1&&/broccoli|salad|carrots|green beans|zucchini/i.test(S2(mk('Chicken',['2 lb chicken','1 cup rice']))[0]),'a dish with no veg is offered a veg side');
    ok(S2(mk('Bowl',['1 lb chicken','3 cups rice','2 cups broccoli','2 carrots','1 cucumber'])).length===1,'a dish that has everything gets one extra fibre side');
    ok(S2(mk('Salad',['2 cups lettuce','1 cucumber','1 tomato'])).some(x=>/rice|potato|quinoa|couscous|bread/i.test(x)),'a dish with no carbs is offered a carb side');
    const all=['Pasta','Stew','Pie','Soup','Wrap','Bowl','Bake'].flatMap(n=>S2(mk(n,['1 cup flour']))).concat(S2(mk('x',['1 lb ground beef'])));
    ok(all.every(x=>!/cheese|milk|butter|cream|yogh?urt|chicken|beef|turkey/i.test(x)),'suggested sides are always meat- and dairy-free'); }
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
 const rm=a.querySelector('[data-action=remove]');ok(!!rm,'custom recipe has a remove button');
 const cid=rm.dataset.id;rm.closest('.bcard').querySelector('[data-action=rate][data-v="1"]').click();await sleep(150);
 ok(!!doc(code,'ratings/'+cid),'your own recipes can be rated');
 a.querySelector('[data-action=remove]').click();await sleep(150);
 ok(!doc(code,'ratings/'+cid),'removing a recipe removes its rating too');
 ok(Object.keys(server.docs).filter(k=>k.startsWith(code+'|recipes/c-')).length===0,'custom recipe removed on server');
 // 12. leaving
 a.querySelector('[data-action=settings]').click();a.querySelector('[data-action=leave]').click();
 ok(!!a.querySelector('.welcome')&&A.localStorage.getItem('wt-household')===null,'leave returns to the welcome screen');
 console.log('\nrpc calls:',rpcCount,'| failures:',fails);
 process.exit(fails?1:0);
})();
