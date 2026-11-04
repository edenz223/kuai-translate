import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';

export const projectRoot = fileURLToPath(new URL('../',import.meta.url));
const runtimeExtensions = new Set(['.js','.mjs','.json','.html','.css','.svg','.png','.ico','.txt']);
const buildExtensions = new Set([...runtimeExtensions,'.ts']);
const sourceExtensions = new Set([...buildExtensions,'.cjs','.md','.yml','.yaml']);
const sourceDirectories = ['src','public','scripts','tests','docs','.github'];
const sourceRootFiles = ['package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.types.json','README.md','README.zh-CN.md','LICENSE','PRIVACY.md','CONTRIBUTING.md','SECURITY.md','CHANGELOG.md','THIRD_PARTY_NOTICES.md','ARCHITECTURE.md','.gitignore'];
const sort = values => values.sort((a,b)=>a < b ? -1 : a > b ? 1 : 0);

async function exists(file) { try {await fs.access(file);return true;}catch{return false;} }
export async function walkFiles(root, directory = '', extensions = runtimeExtensions) {
  if ((await fs.lstat(path.join(root,directory))).isSymbolicLink()) throw Error('Symbolic directory roots are not allowed: '+directory);
  const files=[];
  for (const entry of await fs.readdir(path.join(root,directory),{withFileTypes:true})) {
    if (entry.name.startsWith('.') || ['node_modules','dist','release','coverage'].includes(entry.name)) continue;
    const relative=path.posix.join(directory,entry.name), info=await fs.lstat(path.join(root,relative));
    if (info.isSymbolicLink()) throw Error('Symbolic links are not allowed in public artifacts: '+relative);
    if (info.isDirectory()) files.push(...await walkFiles(root,relative,extensions));
    else if (info.isFile()) {
      if (!extensions.has(path.extname(entry.name))) throw Error('Unsupported file in public artifact: '+relative);
      files.push(relative);
    }
  }
  return sort(files);
}

// TypeScript canonicalizes separators even on Windows.
export function compilerPathKey(fileName, paths=path, caseSensitive=ts.sys.useCaseSensitiveFileNames) {
  const absolute=paths.resolve(fileName);
  return caseSensitive ? absolute : absolute.toLowerCase();
}
export function emittedRuntimePath(fileName, output, paths=path) {
  const resolved=paths.resolve(fileName),publicRoot=paths.join(paths.resolve(output),'public');
  const relative=paths.relative(publicRoot,resolved);
  return relative && relative!=='..' && !relative.startsWith('..'+paths.sep) && !paths.isAbsolute(relative)
    ? paths.join(output,relative) : resolved;
}

export async function buildProject(root = projectRoot) {
  const runtime=[];
  for(const directory of ['src','public']) for(const relative of await walkFiles(root,directory,buildExtensions))
    if(!relative.endsWith('.ts')) runtime.push({from:relative,to:directory==='public' ? relative.slice(7) : relative});
  if(await exists(path.join(root,'LICENSE'))) {
    const license=await fs.lstat(path.join(root,'LICENSE'));
    if(license.isSymbolicLink())throw Error('Symbolic links are not allowed in public artifacts: LICENSE');
    if(!license.isFile())throw Error('LICENSE must be a regular file');
    runtime.push({from:'LICENSE',to:'LICENSE.txt'});
  }
  const output=path.join(root,'dist');
  await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
  for(const file of runtime) {const target=path.join(output,file.to);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,file.from),target);}
  const configFile=path.join(root,'tsconfig.json');
  const config=await exists(configFile) ? ts.readConfigFile(configFile,ts.sys.readFile) : {config:{}};
  if(config.error)throw Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,root,{
    rootDir:root,outDir:output,allowJs:true,checkJs:false,noEmit:false,noEmitOnError:true,
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  });
  // Fixtures need the same compiler while keeping their independent source root.
  const names=(await walkFiles(root,'src',buildExtensions)).filter(file=>file.endsWith('.ts')).map(file=>path.join(root,file));
  for(const file of await walkFiles(root,'public',buildExtensions))if(file.endsWith('.ts'))names.push(path.join(root,file));
  if(names.some(file=>!file.endsWith('.d.ts'))) {
    const program=ts.createProgram(names,parsed.options);
    const diagnostics=ts.getPreEmitDiagnostics(program);
    if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{
      getCanonicalFileName:file=>file,getCurrentDirectory:()=>root,getNewLine:()=> '\n',
    }));
    const writes=[],sourceNames=new Set(names.map(file=>compilerPathKey(file)));
    for(const source of program.getSourceFiles()) {
      if(source.isDeclarationFile || !sourceNames.has(compilerPathKey(source.fileName)))continue;
      program.emit(source,(fileName,data)=>{
        // Classic bootstrap lives at the extension root, just as before migration.
        const destination=emittedRuntimePath(fileName,output);
        writes.push(fs.mkdir(path.dirname(destination),{recursive:true}).then(()=>fs.writeFile(destination,data)));
      });
    }
    await Promise.all(writes);
  }
  return output;
}

export async function sourceFiles(root = projectRoot) {
  const files=[];
  for(const directory of sourceDirectories) if(await exists(path.join(root,directory))) files.push(...await walkFiles(root,directory,sourceExtensions));
  for(const relative of sourceRootFiles) if(await exists(path.join(root,relative))) {
    if((await fs.lstat(path.join(root,relative))).isSymbolicLink())throw Error('Symbolic links are not allowed: '+relative);
    files.push(relative);
  }
  return sort(files);
}

export async function checkDist(root = projectRoot) {
  const directory=path.join(root,'dist'), files=await walkFiles(directory), available=new Set(files);
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  if(manifest.manifest_version!==3 || manifest.name!=='Kuai translate')throw Error('Expected independent Kuai translate Manifest V3');
  if(manifest.key || manifest.update_url)throw Error('The independent package must not inherit an extension key or update URL');
  const references=new Set();
  function check(reference,from='manifest.json') {
    if(!reference || reference.startsWith('#') || /^(?:https?:|data:|mailto:)/.test(reference))return;
    const ref=reference.split(/[?#]/)[0];
    const relative=path.posix.normalize(ref.startsWith('/') ? ref.slice(1) : path.posix.join(path.posix.dirname(from),ref));
    if(relative.startsWith('../') || path.posix.isAbsolute(relative))throw Error('Reference outside extension: '+reference);
    if(!available.has(relative))throw Error('Missing extension resource: '+relative+' (from '+from+')');
    references.add(relative);
  }
  check(manifest.background?.service_worker);check(manifest.action?.default_popup);check(manifest.options_page);
  for(const icons of [manifest.icons,manifest.action?.default_icon])for(const ref of Object.values(icons || {}))check(ref);
  for(const script of manifest.content_scripts || [])for(const ref of [...(script.js || []),...(script.css || [])])check(ref);
  for(const rule of manifest.web_accessible_resources || [])for(const pattern of rule.resources || []) {
    if(!pattern.includes('*'))check(pattern);
    else {const regex=new RegExp('^'+pattern.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replaceAll('*','.*')+'$');if(!files.some(file=>regex.test(file)))throw Error('Missing resources matching '+pattern);}
  }
  let scripts=0;
  for(const file of files) {
    const source=await fs.readFile(path.join(directory,file));
    if(file.endsWith('.js') || file.endsWith('.mjs')) {
      scripts++;const result=spawnSync(process.execPath,['--check',path.join(directory,file)],{encoding:'utf8'});
      if(result.status!==0)throw Error('JavaScript syntax check failed: '+file+'\n'+result.stderr);
      const text=source.toString();
      const imports=[...text.matchAll(/\b(?:import|export)\s+(?:[\w*$\s{},]+?\s+from\s*)?['"]([^'"]+)['"]/g),...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]/g)];
      for(const match of imports) {if(!/^\.?\.?\//.test(match[1]))throw Error('Non-local executable import: '+file+' -> '+match[1]);check(match[1],file);}
    }
    if(file.endsWith('.html'))for(const match of source.toString().matchAll(/\b(?:src|href)=["']([^"']+)["']/g))check(match[1],file);
  }
  return {files:files.length,scripts,references:references.size,version:manifest.version};
}
