/** Shared by diagnostic output and secret-free backups. */
export const secretProperty=/key|token|secret|auth|password|signature/i;
export function redactEndpoint(value:string|undefined) {
  if(!value)return value;
  try{
    const url=new URL(value);url.username='';url.password='';url.hash='';
    for(const key of [...url.searchParams.keys()])if(secretProperty.test(key))url.searchParams.delete(key);
    return url.href;
  }catch{return '';}
}
