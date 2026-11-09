// Visual check for page translation on real sites.
// Loads the unpacked extension in headless Chromium, opens a URL, runs the built
// page translator inside the extension's isolated world with the real background
// transport, then writes before/after screenshots and a layout report.
//
// node scripts/visual-check.mjs --url <url> --out <dir> [--ext dist] [--width 1440] [--height 900]
//   [--scroll 0] [--wait 20000] [--settings '{"pageDisplayMode":"translation_only"}'] [--chrome <path>]
//   [--eval '<expression>'] [--eval-before '<expression>']
// Chromium: --chrome, $CHROME_PATH, or Playwright's cached chromium build.
import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const args = {};
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (!key.startsWith('--')) continue;
  const value = process.argv[index + 1];
  args[key.slice(2)] = value && !value.startsWith('--') ? (index++, value) : true;
}
async function defaultChrome() {
  const cache = path.join(os.homedir(), '.cache/ms-playwright');
  const builds = (await fs.readdir(cache).catch(() => [])).filter(name => /^chromium-\d+$/.test(name)).sort().reverse();
  return builds.length ? path.join(cache, builds[0], 'chrome-linux64/chrome') : 'chromium';
}
const chromePath = args.chrome || process.env.CHROME_PATH || await defaultChrome();
const ext = path.resolve(args.ext || 'dist');
const url = args.url;
const out = path.resolve(args.out || 'visual-out');
const width = Number(args.width || 1440), height = Number(args.height || 900);
const waitMs = Number(args.wait || 20000), scrollY = Number(args.scroll || 0);
if (!url) { console.error('--url is required'); process.exit(2); }
await fs.mkdir(out, {recursive: true});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'kuai-visual-'));
const port = 9300 + Math.floor(Math.random() * 500);
const chrome = spawn(chromePath, [
  '--headless=new', '--no-sandbox', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, `--window-size=${width},${height}`, '--lang=zh-CN',
  `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, 'about:blank',
], {stdio: ['ignore', 'ignore', 'ignore']});
let browser;
async function finish(code) {
  browser?.close(); chrome.kill('SIGKILL');
  await fs.rm(profile, {recursive: true, force: true}).catch(() => {});
  process.exit(code);
}
const deadline = setTimeout(() => { console.error('visual-check timed out'); void finish(1); }, waitMs + 90000);

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

try {
  browser = connect((await devtools('/json/version')).webSocketDebuggerUrl);
  await browser.ready;
  const {targetId} = await browser.send('Target.createTarget', {url: 'about:blank'});
  const {sessionId} = await browser.send('Target.attachToTarget', {targetId, flatten: true});
  const page = (method, params) => browser.send(method, params, sessionId);
  const contexts = [];
  browser.on(message => {
    if (message.sessionId === sessionId && message.method === 'Runtime.executionContextCreated') contexts.push(message.params.context);
  });
  await page('Page.enable');
  await page('Runtime.enable');
  await page('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
  await page('Page.navigate', {url});
  await sleep(8000);
  const evaluate = async (expression, contextId) => {
    const result = await page('Runtime.evaluate', {expression, returnByValue: true, awaitPromise: true, ...(contextId ? {contextId} : {})});
    return result.result?.value ?? result.exceptionDetails?.exception?.description ?? JSON.stringify(result.exceptionDetails);
  };
  if (scrollY) { await evaluate(`window.scrollTo(0, ${scrollY})`); await sleep(1500); }
  const shot = async name => fs.writeFile(path.join(out, name), Buffer.from((await page('Page.captureScreenshot', {format: 'png'})).data, 'base64'));
  await shot('before.png');

  // Messaging from CDP-driven extension targets does not reach the tab here, so drive the
  // built translator directly in the content script world; settings and provider still come
  // from the extension background.
  const mainFrame = (await page('Page.getFrameTree')).frameTree.frame.id;
  let isolated;
  for (let attempt = 0; attempt < 50 && !isolated; attempt++) {
    isolated = contexts.findLast(context => context.auxData?.frameId === mainFrame && context.auxData?.isDefault === false && (context.origin.startsWith('chrome-extension://')||context.name.startsWith('chrome-extension://')));
    if (!isolated) await sleep(200);
  }
  if (!isolated) throw Error('Kuai content script world not found: '+JSON.stringify(contexts));
  const diagnosticsBefore=typeof args['eval-before']==='string'?await evaluate(args['eval-before'],isolated.id):undefined;
  const overrides = args.settings ? JSON.stringify(JSON.parse(args.settings)) : '{}';
  console.log('start:', await evaluate(`(async()=>{
    const base=chrome.runtime.getURL('src/');
    const client=await import(base+'shared/client.js');
    const {createPageTranslator}=await import(base+'content/page-translator.js');
    const settings=Object.assign(await client.getSettings(false),${overrides});
    const translator=globalThis.__kuaiVisual=createPageTranslator({document,env:globalThis,translate:client.translate,cancel:client.cancel,getSettings:()=>settings});
    const dom=await import(base+'content/dom.js');
    globalThis.__kuaiVisualBeforeHeader=document.querySelector('header')?.getBoundingClientRect().toJSON();
    globalThis.__kuaiVisualSources=new Map(dom.collectBlocks(document,globalThis,{visibleOnly:true}).map(({element,text})=>{
      const rects=[];
      const visit=node=>{
        if(node.nodeType===3){if(node.nodeValue.trim()){const range=document.createRange();range.selectNodeContents(node);rects.push(...[...range.getClientRects()].map(rect=>rect.toJSON()));}return;}
        if(node.nodeType!==1||node!==element&&(dom.isBlock(node,globalThis)||!dom.isPageReadable(node,globalThis)))return;
        for(const child of node.childNodes)visit(child);
      };visit(element);
      const textBox=rects.length?{x:Math.min(...rects.map(r=>r.left)),y:Math.min(...rects.map(r=>r.top)),width:Math.max(...rects.map(r=>r.right))-Math.min(...rects.map(r=>r.left)),height:Math.max(...rects.map(r=>r.bottom))-Math.min(...rects.map(r=>r.top))}:null;
      return [element,{html:element.outerHTML,text,box:element.getBoundingClientRect().toJSON(),textBox}];
    }));
    globalThis.__kuaiVisualDone=translator.translatePage().then(status=>JSON.stringify(status),error=>'ERROR '+error.message);
    return 'provider='+settings.activeProviderId+' target='+settings.targetLanguage;
  })()`, isolated.id));
  console.log('status:', await evaluate(`Promise.race([globalThis.__kuaiVisualDone,new Promise(resolve=>setTimeout(()=>resolve('TIMEOUT '+JSON.stringify(globalThis.__kuaiVisual.status())),${waitMs}))])`, isolated.id));
  await sleep(1500);
  // --eval runs an extra expression in the content script world, e.g. to inspect collectBlocks.
  const diagnostics=typeof args.eval==='string'?await evaluate(args.eval,isolated.id):undefined;
  if(diagnostics!==undefined)console.log('eval:',diagnostics);

  const report = await evaluate(`(()=>{
    const describe=element=>element.tagName+(typeof element.className==='string'&&element.className.trim()?'.'+element.className.trim().split(/\\s+/).join('.'):'');
    const font=style=>[style.fontFamily.slice(0,40),style.fontWeight,style.fontSize,style.lineHeight,style.whiteSpace].join(' | ');
    const rows=[...document.querySelectorAll('[data-kuai-page-translation]')].map(output=>{
      const host=output.parentElement,inner=output.querySelector('.kuai-translator-inner')||output;
      const hostStyle=getComputedStyle(host),innerStyle=getComputedStyle(inner),hostBox=host.getBoundingClientRect(),box=inner.getBoundingClientRect();
      const fontSize=parseFloat(innerStyle.fontSize)||16,lineHeight=parseFloat(hostStyle.lineHeight)||(parseFloat(hostStyle.fontSize)||16)*1.2;
      const squeezed=box.height>lineHeight*1.5&&box.width<fontSize*3;
      const clippedBy=[];
      for(let node=host;node&&node!==document.body;node=node.parentElement){
        const style=getComputedStyle(node);if(!/hidden|clip/.test(style.overflowX+style.overflowY))continue;
        const bounds=node.getBoundingClientRect();
        if(box.left<bounds.left-1||box.right>bounds.right+1||box.top<bounds.top-1||box.bottom>bounds.bottom+1)clippedBy.push(describe(node));
      }
      const source=globalThis.__kuaiVisualSources?.get(host);
      return {layout:output.getAttribute('data-kuai-layout'),source:source?.text,beforeBox:source?.box,sourceTextBox:source?.textBox,display:hostStyle.display,flexDirection:hostStyle.flexDirection,hostHTML:host.outerHTML.slice(0,1600),host:describe(host),state:output.getAttribute('data-state'),text:(inner.textContent||'').slice(0,80),
        hostFont:font(hostStyle),outputFont:font(innerStyle),hostBox:[hostBox.x,hostBox.y,hostBox.width,hostBox.height].map(Math.round),
        outputBox:[box.x,box.y,box.width,box.height].map(Math.round),squeezed,offViewport:box.right>innerWidth+1||box.left<-1,clippedBy};
    });
    const visible=element=>{const box=element.getBoundingClientRect();return element.checkVisibility?.()&&box.width>0&&box.height>0&&box.top<innerHeight&&box.bottom>0;};
    const untranslated=[...document.querySelectorAll('a,button,[role=button],[role=tab],[role=menuitem],label,summary,li,h1,h2,h3,h4,p,strong,span')]
      .filter(element=>visible(element)&&/\\p{L}{2,}/u.test(element.innerText||'')&&!element.closest('[data-kuai-owned],[data-kuai-original]')&&!element.querySelector('[data-kuai-page-translation]')&&!element.closest(':has(> [data-kuai-page-translation])'))
      .filter(element=>![...element.children].some(child=>visible(child)&&(child.innerText||'').trim()===(element.innerText||'').trim()))
      .map(element=>describe(element)+': '+(element.innerText||'').trim().replace(/\\s+/g,' ').slice(0,60));
    return {url:location.href,scrollY,beforeHeaderBox:globalThis.__kuaiVisualBeforeHeader,headerBox:document.querySelector('header')?.getBoundingClientRect().toJSON(),viewport:[innerWidth,innerHeight],squeezedCount:rows.filter(row=>row.squeezed).length,rows,untranslatedInViewport:[...new Set(untranslated)]};
  })()`, isolated.id);
  await fs.writeFile(path.join(out, 'report.json'), JSON.stringify({...report,...(diagnosticsBefore!==undefined?{diagnosticsBefore}:{}),...(diagnostics!==undefined?{diagnostics}:{})}, null, 2));
  await shot('after.png');
  const restoration=await evaluate(`(()=>{globalThis.__kuaiVisual.restore();return [...globalThis.__kuaiVisualSources].map(([element,source])=>({text:source.text.slice(0,80),matches:element.outerHTML===source.html,html:element.outerHTML===source.html?undefined:element.outerHTML.slice(0,1500)}));})()`,isolated.id);
  await fs.writeFile(path.join(out,'restore.json'),JSON.stringify(restoration,null,2));
  console.log(`rows=${report?.rows?.length} untranslated=${report?.untranslatedInViewport?.length} -> ${out}`);
  clearTimeout(deadline);
  await finish(0);
} catch (error) {
  console.error(error);
  await finish(1);
}
