import {deflateRawSync} from 'node:zlib';

const crcTable=Uint32Array.from({length:256},(_,value)=>{for(let bit=0;bit<8;bit++)value=value&1 ? 0xedb88320^(value>>>1) : value>>>1;return value>>>0;});
export function crc32(data) {let value=0xffffffff;for(const byte of data)value=crcTable[(value^byte)&255]^(value>>>8);return (value^0xffffffff)>>>0;}

/** ZIP32 with fixed timestamps/mode, UTF-8 names and deterministic entry order. */
export function createZip(entries) {
  if(entries.length>65535)throw Error('ZIP32 entry limit exceeded');
  const local=[], central=[], names=new Set();let offset=0;
  const sorted=[...entries].sort((a,b)=>a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  for(const entry of sorted) {
    if(!entry.name || entry.name.startsWith('/') || entry.name.includes('\\') || entry.name.split('/').some(part=>part==='..'||part==='.'||!part))throw Error('Unsafe ZIP path');
    if(names.has(entry.name))throw Error('Duplicate ZIP path');names.add(entry.name);
    const name=Buffer.from(entry.name,'utf8'),data=Buffer.from(entry.data),compressed=deflateRawSync(data,{level:9}),crc=crc32(data);
    if(name.length>65535 || data.length>0xffffffff || compressed.length>0xffffffff || offset>0xffffffff)throw Error('ZIP32 size limit exceeded');
    const header=Buffer.alloc(30);header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0x800,6);header.writeUInt16LE(8,8);header.writeUInt16LE(0x21,12);
    header.writeUInt32LE(crc,14);header.writeUInt32LE(compressed.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    local.push(header,name,compressed);
    const directory=Buffer.alloc(46);directory.writeUInt32LE(0x02014b50,0);directory.writeUInt16LE(0x314,4);directory.writeUInt16LE(20,6);directory.writeUInt16LE(0x800,8);directory.writeUInt16LE(8,10);directory.writeUInt16LE(0x21,14);
    directory.writeUInt32LE(crc,16);directory.writeUInt32LE(compressed.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE((0o100644<<16)>>>0,38);directory.writeUInt32LE(offset,42);
    central.push(directory,name);offset+=header.length+name.length+compressed.length;
  }
  const directorySize=central.reduce((sum,part)=>sum+part.length,0),end=Buffer.alloc(22);
  if(offset+directorySize>0xffffffff)throw Error('ZIP32 total size limit exceeded');
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directorySize,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...local,...central,end]);
}
