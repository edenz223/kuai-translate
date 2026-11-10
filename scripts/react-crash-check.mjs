// Real content-script + React regression; no npm browser/React dependencies.
// Run under systemd-run --user --scope -p MemoryMax=1G (one Chromium at a time).
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].slice(2)]=process.argv[i+1];
const cache=path.join(os.homedir(),'.cache/ms-playwright');
const builds=(await fs.readdir(cache).catch(()=>[])).filter(name=>/^chromium-\d+$/.test(name)).sort().reverse();
const chromePath=args.chrome||process.env.CHROME_PATH||(builds.length?path.join(cache,builds[0],'chrome-linux64/chrome'):'chromium');
const ext=path.resolve(args.ext||'dist'),port=9400+Math.floor(Math.random()*500);
const profile=await fs.mkdtemp(path.join(os.tmpdir(),'kuai-react-'));
const server=http.createServer(async(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(await fs.readFile('tests/fixtures/react-stream/index.html'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const url=`http://127.0.0.1:${server.address().port}/`;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const chrome=spawn(chromePath,['--headless=new','--no-sandbox','--disable-gpu','--no-first-run',`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--window-size=1200,900',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'about:blank'],{stdio:'ignore'});
let browser;
const timeout=setTimeout(()=>{console.error('React check timed out');chrome.kill('SIGKILL');process.exit(1);},90000);
async function devtools(pathname) {
  for (let attempt = 0; attempt < 100; attempt++) {
    try { const response = await fetch(`http://127.0.0.1:${port}${pathname}`); if (response.ok) return response.json(); } catch {}
    await sleep(100);
  }
  throw Error('DevTools endpoint unavailable');
}
function connect(wsUrl) {
  const socket = new WebSocket(wsUrl), pending = new Map(), listeners = [];
  let id = 0;
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const {resolve, reject} = pending.get(message.id); pending.delete(message.id);
      if (message.error) reject(Error(message.error.message)); else resolve(message.result);
    } else listeners.forEach(listener => listener(message));
  };
  return {
    ready: new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; }),
    send: (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const messageId = ++id; pending.set(messageId, {resolve, reject});
      socket.send(JSON.stringify({id: messageId, method, params, ...(sessionId ? {sessionId} : {})}));
    }),
    on: listener => listeners.push(listener),
    close: () => socket.close(),
  };
}

let failed=false;
try{
  browser=connect((await devtools('/json/version')).webSocketDebuggerUrl);await browser.ready;
  for(const mode of (args.mode?[args.mode]:['bilingual','translation_only'])){
    const {targetId}=await browser.send('Target.createTarget',{url:'about:blank'});
    const {sessionId}=await browser.send('Target.attachToTarget',{targetId,flatten:true});
    const page=(method,params)=>browser.send(method,params,sessionId),contexts=[];
    browser.on(message=>{if(message.sessionId===sessionId&&message.method==='Runtime.executionContextCreated')contexts.push(message.params.context);});
    await page('Page.enable');await page('Runtime.enable');
    const evaluate=async(expression,contextId)=>{
      const result=await page('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true,...(contextId?{contextId}:{})});
      if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||JSON.stringify(result.exceptionDetails));
      return result.result?.value;
    };
    const until=async(expression,contextId)=>{for(let i=0;i<150;i++){if(await evaluate(expression,contextId))return;await sleep(100);}throw Error('Timed out: '+expression);};
    await page('Page.navigate',{url});
    await until('!!window.__start');
    const isolated=contexts.findLast(context=>context.auxData?.isDefault===false&&(context.origin.startsWith('chrome-extension://')||context.name.startsWith('chrome-extension://')));
    if(!isolated)throw Error('Content script isolated world missing');
    const optionsUrl=await evaluate("chrome.runtime.getURL('options.html')",isolated.id);
    const {targetId:optionsId}=await browser.send('Target.createTarget',{url:optionsUrl});
    const {sessionId:optionsSession}=await browser.send('Target.attachToTarget',{targetId:optionsId,flatten:true});
    await browser.send('Runtime.enable',{},optionsSession);
    const saved=await browser.send('Runtime.evaluate',{expression:`(async()=>{
      const client=await import(chrome.runtime.getURL('src/shared/client.js'));
      const settings=await client.getSettings(true);
      settings.pageOptions={...settings.pageOptions,translateDynamic:true,displayModeShortcut:'Alt+Shift+Z'};
      await client.request('KUAI_SAVE_SETTINGS',{settings});return true;
    })()`,returnByValue:true,awaitPromise:true},optionsSession);
    if(saved.exceptionDetails||saved.result?.value!==true)throw Error('Could not configure fixture preferences: '+JSON.stringify(saved));
    await browser.send('Target.closeTarget',{targetId:optionsId});
    await page('Page.bringToFront');
    // Stub only translation transport. The installed runtime, triggers, DOM, observers and settings are real.
    await evaluate(`(async()=>{
      const send=chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__requests=0;
      chrome.runtime.sendMessage=(message,...rest)=>message.type==='KUAI_TRANSLATE'?(++globalThis.__requests,Promise.resolve({ok:true,value:{translations:message.texts.map(()=> '译文内容')}})):send(message,...rest);
      const client=await import(chrome.runtime.getURL('src/shared/client.js'));
      await client.updatePagePreferences({pageDisplayMode:${JSON.stringify(mode)}});
    })()`,isolated.id);
    const key=async(shift=false)=>{for(const type of ['keyDown','keyUp'])await page('Input.dispatchKeyEvent',{type,modifiers:shift?9:1,key:'z',code:'KeyZ',windowsVirtualKeyCode:90});};
    await key();
    await until(`!!document.querySelector('#mixed kuai-translator[data-state=success]${mode==='translation_only'?'[data-kuai-only]':':not([data-kuai-only])'}')`);
    const initial=await evaluate(`({source:document.querySelector('#mixed').innerText,translated:document.querySelector('#mixed kuai-translator').innerText,link:document.querySelector('#mixed kuai-translator a')?.getAttribute('href')})`);
    await evaluate('window.__start()');
    await until('window.__done||window.__errors.length>0');
    for(const top of [1100,0,1100,0]){await evaluate(`window.scrollTo(0,${top})`);await sleep(200);}
    await sleep(8000);
    const streamed=await evaluate(`({errors:window.__errors,intact:!!document.querySelector('#chat[data-step="8"]')&&!document.querySelector('#crashed'),keys:[...document.querySelectorAll('li')].map(n=>n.dataset.key),live:document.querySelector('#live')?.innerText,requests:null})`);
    streamed.requests=await evaluate('__requests',isolated.id);
    console.log('streamed:',JSON.stringify({mode,...streamed}));
    // Alt+Shift+Z mode shortcut exercises the runtime's preference + presentation path.
    if(mode==='translation_only'&&streamed.intact){await key(true);await until(`document.querySelector('#live')?.innerText.includes('The framework changed this paragraph.')`);}
    const bilingual=await evaluate(`({mixed:document.querySelector('#mixed')?.innerText,live:document.querySelector('#live')?.innerText})`);
    await key(); // Alt+Z restores the page and ends the translation session.
    const restored=await evaluate(`({errors:window.__errors,mixed:document.querySelector('#mixed')?.textContent,live:document.querySelector('#live')?.textContent,markers:document.querySelectorAll('[data-kuai-original]').length,outputs:document.querySelectorAll('kuai-translator').length})`);
    const ok=restored.errors.length===0&&streamed.errors.length===0&&streamed.requests<30&&streamed.intact&&streamed.keys.join(',')==='b,c'&&restored.live==='The framework changed this paragraph.'&&restored.markers===0&&restored.outputs===0&&restored.mixed==='Inserted before the retained text. Existing message first part. Updated second text child. Important detail inlineCode Read the guideAfter the break.'&&initial.translated.includes('译文')&&(mode!=='translation_only'||!initial.source.includes('Existing message')&&streamed.live==='译文内容'&&bilingual.live.includes('The framework changed this paragraph.'));
    console.log(JSON.stringify({mode,ok,initial,streamed,bilingual,restored},null,2));failed ||= !ok;
    await browser.send('Target.closeTarget',{targetId});
  }
}catch(error){console.error(error);failed=true;}
finally{
  clearTimeout(timeout);browser?.close();
  if(chrome.exitCode===null&&chrome.signalCode===null){const exited=new Promise(resolve=>chrome.once('exit',resolve));chrome.kill('SIGKILL');await exited;}
  server.close();await fs.rm(profile,{recursive:true,force:true});
}
process.exitCode=failed?1:0;
