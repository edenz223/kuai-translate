import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {projectRoot} from './project.mjs';

const executable=process.env.CHROMIUM_PATH || process.argv[2];
if(!executable)throw Error('Set CHROMIUM_PATH to a Chromium/Chrome for Testing executable.');
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'kuai-browser-smoke-'));
const sockets=[],exceptions=[];
let browser;
const server=createServer(async(req,res)=>{
  if(req.url==='/api/translate'){
    let body='';for await(const chunk of req)body+=chunk;
    res.writeHead(200,{'Content-Type':'application/json'});
    res.end(JSON.stringify({code:200,data:'测试译文 '+JSON.parse(body).text}));return;
  }
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8',...(process.env.SMOKE_STRICT_CSP?{'Content-Security-Policy':"style-src 'none'"}:{})});
  if(process.env.SMOKE_HN){
    res.end('<!doctype html><html lang="en"><title>HN mixed comment</title><body><div id="fixture" class="commtext c00">Hello from the TypeScript migration.<p id="fixture-next">Second paragraph.</p><p>Look at the PHP situation:</p><p>- HTTP details.</p><p>- PHP details.</p></div><div id="other-comment">Another user comment.</div></body></html>');return;
  }
  if(process.env.SMOKE_SLOTTED){
    res.end(`<!doctype html><html lang="en"><title>Slotted title fixture</title><body>
      <article><shreddit-post>
        <a slot="full-post-link" href="/post"><faceplate-screen-reader-content>What do you think of Justin’s style?</faceplate-screen-reader-content></a>
        <span slot="credit-bar"><time>11h ago</time></span>
        <a slot="title" id="fixture" href="/post"><span>What do you think of Justin’s style?</span></a>
        <p slot="body" id="fixture-body">I am just curious.</p>
      </shreddit-post></article>
      <script>
        customElements.define('shreddit-post',class extends HTMLElement{
          constructor(){super();this.attachShadow({mode:'open'}).innerHTML='<slot name="full-post-link"></slot><slot name="credit-bar"></slot><h2><slot name="title"></slot></h2><slot name="body"></slot>';}
        });
        if(${!!process.env.SMOKE_CARD}){
          const post=document.querySelector('shreddit-post'),overlay=post.querySelector('[slot="full-post-link"]');
          post.style.cssText='display:block;position:relative;padding-bottom:40px';
          overlay.style.cssText='position:absolute;inset:0;display:block';
        }
        for(const node of document.querySelectorAll('faceplate-screen-reader-content')){
          node.style.position='absolute';node.style.width='1px';node.style.height='1px';node.style.overflow='hidden';node.style.clip='rect(0,0,0,0)';node.style.clipPath='inset(50%)';
        }
      </script></body></html>`);return;
  }
  res.end('<!doctype html><html lang="en"><title>Kuai smoke fixture</title><body><div id="fixture">Hello from the TypeScript migration.<p id="fixture-next">Second paragraph.</p></div></body></html>');
});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(read,label){
  const deadline=Date.now()+15000;let last;
  while(Date.now()<deadline){try{const value=await read();if(value)return value;}catch(error){last=error;}await delay(100);}
  throw Error('Timed out: '+label+(last?' ('+last.message+')':''));
}
async function connect(url){
  const ws=new WebSocket(url);sockets.push(ws);
  await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});});
  let next=0;const pending=new Map();
  ws.addEventListener('message',event=>{
    const message=JSON.parse(event.data);
    if(message.method==='Runtime.exceptionThrown')exceptions.push(message.params.exceptionDetails);
    if(message.id&&pending.has(message.id)){
      const {resolve,reject,timer}=pending.get(message.id);pending.delete(message.id);clearTimeout(timer);
      if(message.error)reject(Error(JSON.stringify(message.error)));else resolve(message.result);
    }
  });
  return async(method,params={})=>new Promise((resolve,reject)=>{
    const id=++next,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timeout: '+method));},15000);
    pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));
  });
}
async function evaluate(cdp,expression){
  const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(result.exceptionDetails)throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const fixtureURL='http://127.0.0.1:'+server.address().port+'/';
  browser=spawn(executable,[
    '--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check',
    '--disable-background-networking','--disable-component-update','--remote-debugging-port=0',
    '--user-data-dir='+profile,'--disable-extensions-except='+path.join(projectRoot,'dist'),
    '--load-extension='+path.join(projectRoot,'dist'),'about:blank',
  ],{stdio:['ignore','ignore','ignore']});
  browser.on('error',()=>{});
  const port=await until(async()=>Number((await fs.readFile(path.join(profile,'DevToolsActivePort'),'utf8')).split('\n')[0]),'browser startup');
  const base='http://127.0.0.1:'+port;
  const targets=()=>fetch(base+'/json/list').then(response=>response.json());
  const worker=await until(async()=>(await targets()).find(target=>target.type==='service_worker'&&target.url.includes('/src/background/index.js')),'MV3 service worker');
  const extensionOrigin=new URL(worker.url).origin==='null'?worker.url.split('/').slice(0,3).join('/'):new URL(worker.url).origin;
  async function page(url){
    const target=await fetch(base+'/json/new?'+encodeURIComponent(url),{method:'PUT'}).then(response=>response.json());
    const cdp=await connect(target.webSocketDebuggerUrl);await cdp('Runtime.enable');
    await until(()=>evaluate(cdp,'document.readyState==="complete"'),'document ready');
    return cdp;
  }
  const fixture=await page(fixtureURL);
  const popup=await page(extensionOrigin+'/popup.html');
  await until(()=>evaluate(popup,'document.querySelector("#provider")?.options.length===4'),'popup initialization');
  const getSettings=()=>evaluate(popup,'chrome.runtime.sendMessage({type:"KUAI_GET_SETTINGS",includeSecrets:true})');
  const initial=await getSettings();assert.equal(initial.ok,true);assert.equal(initial.value.providers.length,4);
  const configured=structuredClone(initial.value);
  configured.providers.push({id:'smoke-local',type:'deeplx',name:'Local smoke fixture',enabled:true,baseUrl:fixtureURL+'api',apiKey:'',model:'',region:'',temperature:null});
  configured.pageStyle={preset:'blur'};configured.hoverEnabled=!!(process.env.SMOKE_SLOTTED||process.env.SMOKE_HN);configured.hoverOptions={trigger:process.env.SMOKE_CARD||process.env.SMOKE_HN?'shift':'alt',delay:50};configured.activeProviderId='smoke-local';configured.sourceLanguage='en';
  const saved=await evaluate(popup,'chrome.runtime.sendMessage('+JSON.stringify({type:'KUAI_SAVE_SETTINGS',settings:configured,baseSettings:initial.value})+')');
  assert.equal(saved.ok,true);
  const action=type=>evaluate(popup,'(async()=>{const [tab]=await chrome.tabs.query({url:'+JSON.stringify(fixtureURL+'*')+'});return chrome.tabs.sendMessage(tab.id,{type:'+JSON.stringify(type)+'},{frameId:0});})()');
  await until(async()=>{const reply=await action('KUAI_PAGE_STATUS');return reply?.ok&&reply.value?.phase==='ready';},'content bootstrap and message response');
  if(process.env.SMOKE_SLOTTED||process.env.SMOKE_HN){
    await fixture('Page.bringToFront');
    const point=await evaluate(fixture,process.env.SMOKE_HN?
      "(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#fixture').firstChild);const rect=range.getBoundingClientRect();return {x:rect.x+10,y:rect.y+5}})()":process.env.SMOKE_CARD?
      "(()=>{const rect=document.querySelector('shreddit-post').getBoundingClientRect();return {x:rect.x+10,y:rect.bottom-15}})()":
      "(()=>{const rect=document.querySelector('#fixture span').getBoundingClientRect();return {x:rect.x+10,y:rect.y+5}})()");
    if(process.env.SMOKE_CARD)assert.equal(await evaluate(fixture,'document.elementFromPoint('+point.x+','+point.y+').getAttribute("slot")'),'full-post-link');
    await fixture('Input.dispatchMouseEvent',{type:'mouseMoved',...point});
    const key=(process.env.SMOKE_CARD||process.env.SMOKE_HN)?'Shift':'Alt',code=(process.env.SMOKE_CARD||process.env.SMOKE_HN)?'ShiftLeft':'AltLeft',virtualKey=(process.env.SMOKE_CARD||process.env.SMOKE_HN)?16:18,modifiers=(process.env.SMOKE_CARD||process.env.SMOKE_HN)?8:1;
    await fixture('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey,modifiers});
    await fixture('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey,modifiers:0});
  }else assert.equal((await action('KUAI_PAGE_TRANSLATE')).ok,true);
  await until(()=>evaluate(fixture,'document.querySelector("[data-kuai-page-translation][data-state=success]")?.textContent.includes("测试译文")'),'real browser translation');
  const layout=await evaluate(fixture,`(()=>{
    const host=document.querySelector('[data-kuai-page-translation]'),inner=host.querySelector('font');
    const source=host.parentElement;source.style.cssText='-webkit-line-clamp:1;max-height:5px;height:5px';
    const computed=getComputedStyle(source);
    return {followingParagraph:host.nextElementSibling?.id,tag:host.localName,children:[...host.children].map(node=>node.localName),
      inlineStyles:host.hasAttribute('style')||inner.hasAttribute('style'),
      lineClamp:computed.webkitLineClamp,maxHeight:computed.maxHeight,innerDisplay:getComputedStyle(inner).display,
      translatedLine:inner.getBoundingClientRect().top>source.firstChild.parentElement.getBoundingClientRect().top};
  })()`);
  assert.equal(layout.followingParagraph,process.env.SMOKE_SLOTTED?undefined:'fixture-next');assert.equal(layout.tag,'kuai-translator');assert.deepEqual(layout.children,['br','font']);
  assert.equal(layout.inlineStyles,false);assert.equal(layout.lineClamp,'none');assert.equal(layout.maxHeight,'none');
  assert.equal(layout.translatedLine,true);assert.equal(layout.innerDisplay,'inline-block');
  await fixture('Page.bringToFront');
  assert.equal(await evaluate(fixture,"document.querySelector('kuai-translator font').focus();getComputedStyle(document.querySelector('kuai-translator font')).filter"),'none');
  if(process.env.SMOKE_SLOTTED){
    const result=await evaluate(fixture,`(()=>{
      const title=document.querySelector('#fixture'),host=title.querySelector('kuai-translator'),font=host?.querySelector('font');
      const source=document.createRange();source.selectNodeContents(title.firstChild);
      return {count:document.querySelectorAll('kuai-translator').length,parent:host?.parentElement.id,
        text:font?.textContent,below:font.getBoundingClientRect().top>=source.getBoundingClientRect().bottom-1,
        nestedLinks:host.querySelectorAll('a').length};
    })()`);
    assert.equal(result.count,process.env.SMOKE_CARD?2:1);assert.equal(result.parent,'fixture');assert.equal(result.below,true);
    assert.equal(result.text,'测试译文 What do you think of Justin’s style?');assert.equal(result.nestedLinks,0);
    if(process.env.SMOKE_CARD){
      const body=await evaluate(fixture,`(()=>{
        const p=document.querySelector('#fixture-body'),font=p.querySelector('kuai-translator font'),source=document.createRange();
        source.selectNodeContents(p.firstChild);return {text:font?.textContent,below:font.getBoundingClientRect().top>=source.getBoundingClientRect().bottom-1,
          metadataOutput:document.querySelector('[slot="credit-bar"] kuai-translator')!==null};
      })()`);
      assert.equal(body.text,'测试译文 I am just curious.');assert.equal(body.below,true);assert.equal(body.metadataOutput,false);
    }
  }
  if(process.env.SMOKE_HN){
    const comment=await evaluate(fixture,`(()=>{
      const root=document.querySelector('#fixture'),outputs=[...root.querySelectorAll('kuai-translator')];
      return {count:outputs.length,parents:outputs.map(node=>node.parentElement.tagName),
        below:outputs.every(node=>{const range=document.createRange();range.selectNodeContents(node.parentElement.firstChild);return node.querySelector('font').getBoundingClientRect().top>=range.getBoundingClientRect().bottom-1}),
        outside:document.querySelector('#other-comment kuai-translator')!==null};
    })()`);
    assert.equal(comment.count,5);assert.deepEqual(comment.parents,['DIV','P','P','P','P']);assert.equal(comment.below,true);assert.equal(comment.outside,false);
  }
  const translated=await evaluate(fixture,'document.querySelector("[data-kuai-page-translation]").textContent');
  assert.equal((await action('KUAI_PAGE_RESTORE')).ok,true);
  await until(()=>evaluate(fixture,'!document.querySelector("[data-kuai-page-translation]")'),'page restore');
  assert.equal(await evaluate(fixture,"getComputedStyle(document.querySelector('#fixture')).maxHeight"),'5px');
  const pages={};
  for(const name of ['options.html','text.html']){
    const cdp=await page(extensionOrigin+'/'+name);
    await until(()=>evaluate(cdp,'document.querySelector("#provider")?.options.length>0 || document.querySelector("#provider-list")?.children.length>0'),'UI initialization '+name);
    pages[name]=await evaluate(cdp,'({title:document.title,controls:document.querySelectorAll("button,input,select,textarea").length})');
  }
  assert.deepEqual(exceptions,[]);
  console.log(JSON.stringify({browser:'Chromium',serviceWorker:worker.url,popupProviders:4,settingsSave:true,pageTranslation:translated,pageRestore:true,pages,uncaughtExceptions:exceptions.length},null,2));
}finally{
  for(const socket of sockets)socket.close();
  if(browser){browser.kill('SIGTERM');await new Promise(resolve=>{if(browser.exitCode!==null)return resolve();browser.once('exit',resolve);setTimeout(resolve,2000);});}
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
