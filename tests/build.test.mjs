import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inflateRawSync} from 'node:zlib';
import {buildProject,checkDist,sourceFiles,projectRoot} from '../scripts/project.mjs';
import {createZip} from '../scripts/zip.mjs';

async function fixture() {
  const root=await fs.mkdtemp(path.join(projectRoot,'.build-test-'));
  await fs.mkdir(path.join(root,'public'));await fs.mkdir(path.join(root,'src'));
  const manifest={manifest_version:3,name:'Kuai translate',version:'1.0.0',background:{service_worker:'src/background.js',type:'module'},content_scripts:[{matches:['https://example.com/*'],js:['loader.js']}]};
  await fs.writeFile(path.join(root,'public/manifest.json'),JSON.stringify(manifest));
  await fs.writeFile(path.join(root,'public/loader.js'),'void 0;');
  await fs.writeFile(path.join(root,'src/background.js'),'export const value=1;');
  return {root,dispose:()=>fs.rm(root,{recursive:true,force:true})};
}

test('build copies only runtime inputs and produces a manifest-root extension', async()=>{
  const value=await fixture();
  try {
    await fs.writeFile(path.join(value.root,'.env'),'PRIVATE=not-for-build');
    await fs.writeFile(path.join(value.root,'backup.json'),'not-for-build');
    await fs.writeFile(path.join(value.root,'LICENSE'),'MIT license fixture\n');
    const output=await buildProject(value.root);await checkDist(value.root);
    assert.equal(output,path.join(value.root,'dist'));
    assert.deepEqual((await fs.readdir(output)).sort(),['LICENSE.txt','loader.js','manifest.json','src']);
    assert.equal(await fs.readFile(path.join(output,'LICENSE.txt'),'utf8'),'MIT license fixture\n');
    assert.equal(await fs.readFile(path.join(output,'src/background.js'),'utf8'),'export const value=1;');
    await fs.rm(path.join(value.root,'LICENSE'));
    await fs.symlink(path.join(value.root,'.env'),path.join(value.root,'LICENSE'));
    await assert.rejects(buildProject(value.root),/symbolic/i);
    await fs.rm(path.join(value.root,'LICENSE'));
    await fs.writeFile(path.join(value.root,'src/key.pem'),'private');
    await assert.rejects(buildProject(value.root),/不允许|Unsupported/);
  } finally {await value.dispose();}
});

test('runtime checking rejects missing resources and imports outside the extension', async()=>{
  const value=await fixture();
  try {
    await buildProject(value.root);
    await fs.rm(path.join(value.root,'dist/loader.js'));
    await assert.rejects(checkDist(value.root),/Missing|缺少/);
    await buildProject(value.root);
    await fs.writeFile(path.join(value.root,'dist/src/background.js'),"import '../../../outside.js';");
    await assert.rejects(checkDist(value.root),/outside|越界/);
  } finally {await value.dispose();}
});

test('source allowlist excludes secrets, releases and git internals', async()=>{
  const value=await fixture();
  try {
    await fs.mkdir(path.join(value.root,'.git'));await fs.mkdir(path.join(value.root,'release'));
    await fs.writeFile(path.join(value.root,'.git/config'),'not-public');
    await fs.writeFile(path.join(value.root,'release/archive.zip'),'not-source');
    await fs.writeFile(path.join(value.root,'README.md'),'public');
    await fs.writeFile(path.join(value.root,'.env'),'secret');
    const files=await sourceFiles(value.root);
    assert.ok(files.includes('README.md'));assert.ok(files.includes('src/background.js'));
    assert.equal(files.some(file=>file.startsWith('.git/')||file.startsWith('release/')||file==='.env'),false);
    await fs.symlink(path.join(value.root,'.env'),path.join(value.root,'src/escape.js'));
    await assert.rejects(sourceFiles(value.root),/symbolic|链接/i);
  } finally {await value.dispose();}
});

test('resource validation resolves multiline ESM imports and refuses a linked source root',async()=>{
  const value=await fixture();
  try {
    await fs.writeFile(path.join(value.root,'src/background.js'),"import {\n missing\n} from './missing.js';");
    await buildProject(value.root);
    await assert.rejects(checkDist(value.root),/Missing/);
    await fs.rename(path.join(value.root,'src'),path.join(value.root,'private-runtime'));
    await fs.symlink(path.join(value.root,'private-runtime'),path.join(value.root,'src'),'dir');
    await assert.rejects(sourceFiles(value.root),/symbolic/i);
  } finally {await value.dispose();}
});

test('ZIP output is deterministic, ordered and readable by a standard deflate decoder',()=>{
  const first=createZip([{name:'b.txt',data:Buffer.from('world')},{name:'a.txt',data:Buffer.from('hello')}]);
  const second=createZip([{name:'a.txt',data:Buffer.from('hello')},{name:'b.txt',data:Buffer.from('world')}]);
  assert.deepEqual(first,second);
  assert.equal(first.readUInt32LE(0),0x04034b50);
  assert.equal(first.readUInt32LE(14),0x3610a686,'CRC-32 of hello');
  const size=first.readUInt32LE(18), nameLength=first.readUInt16LE(26), extra=first.readUInt16LE(28);
  assert.equal(first.subarray(30,30+nameLength).toString(),'a.txt');
  assert.equal(inflateRawSync(first.subarray(30+nameLength+extra,30+nameLength+extra+size)).toString(),'hello');
  assert.equal(first.readUInt32LE(first.length-22),0x06054b50);
  assert.throws(()=>createZip([{name:'../secret',data:Buffer.from('x')}]),/path|路径/);
  assert.throws(()=>createZip([{name:'same',data:Buffer.from('x')},{name:'same',data:Buffer.from('y')}]),/Duplicate|重复/);
});
