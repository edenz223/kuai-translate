/** Original vector mark and deterministic PNG rasterizer. Run: node scripts/icons.mjs */
import fs from 'node:fs/promises';
import {deflateSync} from 'node:zlib';
import {fileURLToPath} from 'node:url';

const directory = fileURLToPath(new URL('../public/icons/', import.meta.url));
const white = [[34,29],[49,29],[49,57],[74,29],[94,29],[65,62],[95,99],[75,99],[49,68],[49,99],[34,99]];
const accent = [[88,82],[112,82],[112,101],[102,101],[96,108],[96,101],[88,101]];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><title>Kuai translate</title><rect x="4" y="4" width="120" height="120" rx="29" fill="#3340a6"/><path d="M34 29H49V57L74 29H94L65 62L95 99H75L49 68V99H34Z" fill="#ffffff"/><path d="M88 82H112V101H102L96 108V101H88Z" fill="#7de3e0"/></svg>\n`;

function inside(points,x,y) {
  let result=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const [xi,yi]=points[i],[xj,yj]=points[j];
    if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)result=!result;
  }
  return result;
}
function colorAt(x,y) {
  const qx=Math.max(33-x,0,x-95),qy=Math.max(33-y,0,y-95);
  if(qx*qx+qy*qy>29*29)return [0,0,0,0];
  if(inside(accent,x,y))return [125,227,224,255];
  if(inside(white,x,y))return [255,255,255,255];
  return [51,64,166,255];
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
function chunk(type,bytes) {
  const name=Buffer.from(type),size=Buffer.alloc(4),crc=Buffer.alloc(4);
  size.writeUInt32BE(bytes.length);crc.writeUInt32BE(crc32(Buffer.concat([name,bytes])));
  return Buffer.concat([size,name,bytes,crc]);
}
function png(size) {
  const samples=8,raw=Buffer.alloc(size*(1+size*4));
  for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
    const sum=[0,0,0,0];
    for(let sy=0;sy<samples;sy++)for(let sx=0;sx<samples;sx++) {
      const color=colorAt((x+(sx+.5)/samples)*128/size,(y+(sy+.5)/samples)*128/size);
      for(let c=0;c<4;c++)sum[c]+=color[c];
    }
    const index=y*(1+size*4)+1+x*4,alpha=sum[3]/(samples*samples);
    for(let c=0;c<3;c++)raw[index+c]=alpha?Math.round(sum[c]*255/sum[3]):0;
    raw[index+3]=Math.round(alpha);
  }
  const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw,{level:9})),chunk('IEND',Buffer.alloc(0))]);
}
await fs.mkdir(directory,{recursive:true});
await fs.writeFile(directory+'kuai.svg',svg);
for(const size of [16,32,48,128])await fs.writeFile(directory+`icon-${size}.png`,png(size));
console.log('Generated original Kuai translate icon assets.');
