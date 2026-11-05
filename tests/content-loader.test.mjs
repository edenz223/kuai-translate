import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

function run(failures,scenario={}) {
  const path=fileURLToPath(new URL('../public/content-loader.ts',import.meta.url));
  const program=`
    import vm from 'node:vm';import fs from 'node:fs';import ts from 'typescript';
    const scenario=${JSON.stringify(scenario)};
    let attempts=0,imports=0,nextTimer=0,pagehidden=false;const timers=new Map(),delays=[],warnings=[],listeners=new Map(),cleared=[];
    const context=vm.createContext({chrome:{runtime:{getURL:()=> 'chrome-extension://kuai/src/content/index.js'}},console:{warn:(...args)=>warnings.push(args.join(' '))},
      setTimeout:(fn,delay)=>{const id=++nextTimer;timers.set(id,fn);delays.push(delay);return id;},clearTimeout:id=>{if(timers.delete(id))cleared.push(id);},
      addEventListener:(type,fn)=>{if(!listeners.has(type))listeners.set(type,new Set());listeners.get(type).add(fn);},
      removeEventListener:(type,fn)=>listeners.get(type)?.delete(fn)});
    const module=new vm.SyntheticModule(['start'],function(){this.setExport('start',async()=>{attempts++;if(attempts<=${failures}){const error=new Error('private-details-must-not-log');error.code=scenario.errorCode||'TEMPORARY';throw error;}return {ready:true};});},{context});
    await module.link(()=>{});await module.evaluate();
    const script=new vm.Script(ts.transpileModule(fs.readFileSync(${JSON.stringify(path)},'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText,{importModuleDynamically:async()=>{imports++;return module;}});
    script.runInContext(context);script.runInContext(context);
    for(let i=0;i<20;i++){
      await new Promise(setImmediate);
      if(scenario.pagehideDuringRetry&&!pagehidden&&timers.size){pagehidden=true;for(const fn of [...(listeners.get('pagehide')||[])])fn({persisted:!!scenario.persisted});}
      const next=timers.entries().next().value;if(next){timers.delete(next[0]);next[1]();}
    }
    if(context.__kuaiContentLoading)await context.__kuaiContentLoading;
    console.log(JSON.stringify({attempts,imports,delays,warnings,hasLoading:!!context.__kuaiContentLoading,pendingTimers:timers.size,cleared:cleared.length,pagehideListeners:listeners.get('pagehide')?.size||0}));
  `;
  const result=spawnSync(process.execPath,['--no-warnings','--experimental-vm-modules','--input-type=module','-e',program],{encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('actual classic content loader retries a transient startup failure and deduplicates injections',()=>{
  const result=run(1);assert.equal(result.attempts,2);assert.equal(result.imports,1);assert.equal(result.hasLoading,true);assert.deepEqual(result.delays,[250]);assert.equal(result.pagehideListeners,0);
});
test('classic bootstrap stops after a bounded retry budget without logging private error messages',()=>{
  const result=run(10);assert.equal(result.attempts,4);assert.deepEqual(result.delays,[250,1000,3000]);assert.equal(result.hasLoading,false);assert.equal(result.warnings.length,1);assert.ok(!result.warnings.join('').includes('private-details'));assert.equal(result.pagehideListeners,0);
});
test('non-persisted pagehide cancels a queued bootstrap retry and cannot start a new runtime',()=>{
  const result=run(1,{pagehideDuringRetry:true});
  assert.equal(result.attempts,1);assert.equal(result.cleared,1);assert.equal(result.pendingTimers,0);
  assert.equal(result.pagehideListeners,0);assert.equal(result.warnings.length,0);
});
test('a disposed runtime is not retried as a transient initialization failure',()=>{
  const result=run(10,{errorCode:'CONTENT_STOPPED'});
  assert.equal(result.attempts,1);assert.deepEqual(result.delays,[]);assert.equal(result.pagehideListeners,0);assert.equal(result.warnings.length,0);
});
test('persisted pagehide retains the retry needed when a BFCache document resumes',()=>{
  const result=run(1,{pagehideDuringRetry:true,persisted:true});
  assert.equal(result.attempts,2);assert.equal(result.cleared,0);assert.equal(result.hasLoading,true);assert.equal(result.pagehideListeners,0);
});
