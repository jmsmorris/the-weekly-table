let handler;
globalThis.Deno={serve:(h)=>{handler=h;},env:{get:(k)=>({SUPABASE_URL:'https://x.supabase.co',SUPABASE_ANON_KEY:'anon'})[k]}};
const realResponse=Response;
const pages={
 'https://good.example/recipe':{status:200,html:`<html><head><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebSite"},{"@type":["Recipe"],"name":"Slow Cooker Chicken &amp; Rice","recipeYield":["6","6 servings"],"totalTime":"PT6H15M","recipeIngredient":["2 lb chicken thighs","1 cup rice","1 <b>onion</b>, diced"],"recipeInstructions":[{"@type":"HowToSection","itemListElement":[{"@type":"HowToStep","text":"Add everything to the slow cooker."},{"@type":"HowToStep","text":"Cook on low 6 hours."}]},"Shred and serve."],"keywords":"crockpot, dinner"}]}</script></head></html>`},
 'https://nodata.example/':{status:200,html:'<html><body>No structured data</body></html>'},
 'https://redir.example/a':{status:301,location:'http://127.0.0.1/admin'},
 'https://forbidden.example/':{status:403,html:''},
};
globalThis.fetch=async(u,opts)=>{
  const s=String(u);
  if(s.includes('/rest/v1/rpc/wt_list')){const b=JSON.parse(opts.body);return new realResponse(JSON.stringify(b.p_code==='GOODCODE12'?[{path:'x',updated_at:'t'}]:[]),{status:200});}
  const p=pages[s];if(!p)throw new Error('unexpected fetch '+s);
  const h=new Headers();if(p.location)h.set('location',p.location);
  return new realResponse(p.status<300||p.status>=400?p.html:null,{status:p.status,headers:h});
};
await import('./.tmp/fn.mjs');
const call=async(body,method='POST')=>{const r=await handler(new Request('https://f/x',{method,body:method==='POST'?JSON.stringify(body):undefined}));return {status:r.status,json:await r.json().catch(()=>null),cors:r.headers.get('access-control-allow-origin')};};
const out=[];
let r=await call({url:'https://good.example/recipe',code:'GOODCODE12'});
out.push(['good recipe',r.status,r.json.name,r.json.minutes,'servings '+r.json.servings,r.json.ingredients.length,r.json.instructions.join('|'),r.json.source,r.cors]);
r=await call({url:'https://good.example/recipe',code:'WRONGCODE12'});out.push(['bad code',r.status,r.json.error]);
r=await call({url:'https://good.example/recipe'});out.push(['no code',r.status]);
r=await call({url:'https://nodata.example/',code:'GOODCODE12'});out.push(['no recipe',r.status,r.json.error]);
r=await call({url:'http://localhost:8000/',code:'GOODCODE12'});out.push(['localhost',r.status,r.json.error]);
r=await call({url:'http://192.168.1.5/',code:'GOODCODE12'});out.push(['private ip',r.status,r.json.error]);
r=await call({url:'http://[::1]/',code:'GOODCODE12'});out.push(['ipv6 loopback',r.status,r.json.error]);
r=await call({url:'https://redir.example/a',code:'GOODCODE12'});out.push(['redirect to internal',r.status,r.json.error]);
r=await call({url:'https://forbidden.example/',code:'GOODCODE12'});out.push(['403 site',r.status,r.json.error]);
r=await call({url:'ftp://x.example/',code:'GOODCODE12'});out.push(['ftp',r.status,r.json.error]);
r=await call({url:'not a url',code:'GOODCODE12'});out.push(['garbage url',r.status]);
r=await call({},'GET');out.push(['GET',r.status]);
const o=await handler(new Request('https://f/x',{method:'OPTIONS'}));out.push(['OPTIONS',o.status,o.headers.get('access-control-allow-headers')]);
out.forEach(x=>console.log(x.join(' | ')));
