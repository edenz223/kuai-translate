const hidden=new WeakMap<Text,string>();
interface Write {before:string;after:string}
let writes=new WeakMap<Node,Write[]>(),cleanup=false;

export function sourceText(node: Node): string {
  const value=node.nodeValue||'';
  if(value!==''){hidden.delete(node as Text);return value;}
  return hidden.get(node as Text)??value;
}
function write(node: Text,value: string): void {
  const before=node.nodeValue||'';if(before===value)return;
  const pending=writes.get(node)||[];pending.push({before,after:value});writes.set(node,pending);
  if(!cleanup){cleanup=true;setTimeout(()=>{writes=new WeakMap();cleanup=false;},0);}
  node.nodeValue=value;
}
export function hideText(node: Text): void {
  const value=sourceText(node);if(!value)return;
  hidden.set(node,value);write(node,'');
}
export function restoreText(node: Text): void {
  const value=hidden.get(node);hidden.delete(node);
  if(value!==undefined&&node.nodeValue==='')write(node,value);
}

/** Each observer consumes our writes independently, including hide/restore in one turn. */
export function originalMutationFilter(): (records: MutationRecord[])=>Set<MutationRecord> {
  const seen=new WeakSet<Write>();
  return records=>{
    const ignored=new Set<MutationRecord>(),next=new Map<Node,string>(),values=new Map<MutationRecord,string>(),last=new Map<Node,MutationRecord>();
    for(let index=records.length-1;index>=0;index--){
      const record=records[index];if(record.type!=='characterData')continue;
      if(!last.has(record.target))last.set(record.target,record);
      values.set(record,next.get(record.target)??record.target.nodeValue??'');next.set(record.target,record.oldValue??'');
    }
    for(const record of records){
      if(record.type!=='characterData')continue;
      const after=values.get(record),own=writes.get(record.target)?.find(value=>!seen.has(value)&&value.before===record.oldValue&&value.after===after);
      if(own){seen.add(own);ignored.add(record);}
      else if(last.get(record.target)===record&&after==='')hidden.delete(record.target as Text);
    }
    return ignored;
  };
}
