/** Isolated real-WebGL smoke test. Never logs in or writes game/account data. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
const root=process.cwd();
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  if(url.pathname==='/smoke'){res.setHeader('content-type','text/html');res.end('<body style="margin:0;background:#252931"><canvas id="preview" style="width:800px;height:800px"></canvas>');return;}
  const files=['wov-web/build',''].map(p=>path.resolve(root,p,'.'+url.pathname));
  const file=files.find(p=>p.startsWith(root+path.sep)&&fs.existsSync(p)&&fs.statSync(p).isFile());
  if(!file){res.writeHead(404).end();return;}
  res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.json')?'application/json':'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const page=await browser.newPage({viewport:{width:800,height:800}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/smoke');
  const results=[];
  for(const variant of ['male','female']){
    const result=await page.evaluate(async variant=>{
      const {Vorschau}=await import('/assets/js/vorschau.js');
      const v=new Vorschau(document.querySelector('canvas'),location.origin+'/assets/models/');
      const figure=variant==='male'?'wikinger':'wikingerin';
      if(!await v.ladeKoerper(figure+'/'+(variant==='male'?'WikingerKoerper':'WikingerinKoerper')))throw Error('Body load failed');
      const catalog=await(await fetch('/assets/equipment-sets.json')).json();
      const set=catalog.sets.find(s=>s.id==='emberrage_'+variant);
      const original=v.koerperNetze.map(m=>m.isEnabled());
      for(const part of set.parts)await v.setze(part.appearanceSlot,part.previewModel.replace(/\.glb$/,''));
      const loaded=set.parts.every(p=>v.geladen.get(p.previewModel.replace(/\.glb$/,''))?.netze.length>0);
      const glow=v.scene.effectLayers.find(l=>l.name==='Emberrage_equipment_glow');
      if(!loaded||!glow?.isEnabled)throw Error('Missing armor or glow');
      const hidden=v.koerperNetze.filter(m=>!m.isEnabled()).length;
      window.preview=v;
      return {variant,loaded,hidden,bones:v.skelett.bones.length,glow:true};
    },variant);
    await page.waitForTimeout(1000);
    await page.screenshot({path:path.join(root,`.armor-test/emberrage-${variant}-browser.png`)});
    const restored=await page.evaluate(async()=>{
      const v=window.preview;
      const before=v.koerperNetze.map(m=>m.name);
      for(const slot of [...v.aktuell.keys()])await v.setze(slot,null);
      const visible=v.koerperNetze.every(m=>m.isEnabled());
      const glow=v.scene.effectLayers.find(l=>l.name==='Emberrage_equipment_glow');
      const stopped=!glow?.isEnabled;
      v.dispose();return {visible,stopped,bodyMeshes:before.length};
    });
    assert(result.hidden>0);assert(restored.visible);assert(restored.stopped);
    results.push({...result,...restored});
  }
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(root,'.armor-test/emberrage-browser.json'),JSON.stringify(results,null,2)+'\n');
  console.log('PASS WebGL body variants, loaded armor, live glow and full unequip restoration',results);
} finally {await browser.close();server.close();}
