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
  res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});
  res.end('<!doctype html><html lang="en"><title>Kuai smoke fixture</title><body><p id="fixture">Hello from the TypeScript migration.</p></body></html>');
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
  configured.activeProviderId='smoke-local';configured.sourceLanguage='en';
  const saved=await evaluate(popup,'chrome.runtime.sendMessage('+JSON.stringify({type:'KUAI_SAVE_SETTINGS',settings:configured,baseSettings:initial.value})+')');
  assert.equal(saved.ok,true);
  const action=type=>evaluate(popup,'(async()=>{const [tab]=await chrome.tabs.query({url:'+JSON.stringify(fixtureURL+'*')+'});return chrome.tabs.sendMessage(tab.id,{type:'+JSON.stringify(type)+'},{frameId:0});})()');
  await until(async()=>{const reply=await action('KUAI_PAGE_STATUS');return reply?.ok&&reply.value?.phase==='ready';},'content bootstrap and message response');
  assert.equal((await action('KUAI_PAGE_TRANSLATE')).ok,true);
  await until(()=>evaluate(fixture,'document.querySelector("[data-kuai-page-translation][data-state=success]")?.textContent.includes("测试译文")'),'real browser translation');
  const translated=await evaluate(fixture,'document.querySelector("[data-kuai-page-translation]").textContent');
  assert.equal((await action('KUAI_PAGE_RESTORE')).ok,true);
  await until(()=>evaluate(fixture,'!document.querySelector("[data-kuai-page-translation]")'),'page restore');
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
