type BootstrapRuntime = {stop?:()=>void};
declare var __kuaiContentLoading: Promise<BootstrapRuntime|void>|undefined;
/* Classic MV3 content entry; the readable implementation uses native modules. */
(function () {
  if (globalThis.__kuaiContentLoading) return;
  const delays=[250,1000,3000];
  let disposed=false,cancelRetry:(()=>void)|null|undefined;
  function stoppedError(){
    const error=new Error('Page initialization stopped.') as Error&{code:string};error.code='CONTENT_STOPPED';return error;
  }
  function pagehide(event:PageTransitionEvent){
    if(event.persisted)return;
    disposed=true;cancelRetry?.();removeEventListener('pagehide',pagehide);
  }
  addEventListener('pagehide',pagehide);
  globalThis.__kuaiContentLoading = (async()=>{
    let module:{start:()=>Promise<BootstrapRuntime>}|undefined;
    for(let attempt=0;;attempt++){
      try{
        if(disposed)throw stoppedError();
        module ||= await import(chrome.runtime.getURL('src/content/index.js'));
        if(disposed)throw stoppedError();
        const runtime=await module!.start();
        if(disposed){runtime?.stop?.();throw stoppedError();}
        return runtime;
      }catch(error:unknown){
        if(disposed||(error as {code?:string})?.code==='CONTENT_STOPPED')throw stoppedError();
        if(attempt>=delays.length)throw error;
        await new Promise<void>((resolve,reject)=>{
          const timer=setTimeout(()=>{cancelRetry=null;resolve();},delays[attempt]);
          cancelRetry=()=>{clearTimeout(timer);cancelRetry=null;reject(stoppedError());};
        });
      }
    }
  })().catch(error => {
      // Keep the guard for a disposed document so duplicate injections cannot
      // resurrect it. A real initialization failure still permits a new load.
      if((error as {code?:string})?.code==='CONTENT_STOPPED')return;
      delete globalThis.__kuaiContentLoading;
      const code=/^[A-Z0-9_]{1,64}$/.test((error as {code?:string})?.code||'')?(error as {code:string}).code:'CONTENT_INIT_FAILED';
      console.warn('[Kuai translate] '+code+': Unable to start after retrying. Reload the extension and refresh this page.');
    }).finally(()=>removeEventListener('pagehide',pagehide));
})();
