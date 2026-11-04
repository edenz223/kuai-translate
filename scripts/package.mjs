import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {buildProject,checkDist,sourceFiles,walkFiles,projectRoot} from './project.mjs';
import {createZip} from './zip.mjs';

const dist=await buildProject(), checks=await checkDist();
const version=checks.version;
if(!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version))throw Error('Invalid release version');
const release=path.join(projectRoot,'release');await fs.mkdir(release,{recursive:true});
const output=[];
for(const [name,root,files,prefix] of [
  [`kuai-translate-${version}.zip`,dist,await walkFiles(dist),''],
  [`kuai-translate-${version}-source.zip`,projectRoot,await sourceFiles(),`kuai-translate-${version}/`],
]) {
  const entries=await Promise.all(files.map(async file=>({name:prefix+file,data:await fs.readFile(path.join(root,file))})));
  const bytes=createZip(entries),file=path.join(release,name);
  await fs.writeFile(file,bytes);
  output.push({file,entries:entries.length,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
await fs.writeFile(path.join(release,'SHA256SUMS'),output.map(item=>`${item.sha256}  ${path.basename(item.file)}`).join('\n')+'\n');
console.log(JSON.stringify({checks,artifacts:output},null,2));
