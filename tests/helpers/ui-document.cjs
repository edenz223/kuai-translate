/* Form/event boundary built from actual HTML; it does not implement layout. */
const fs=require('node:fs');
function styleBoundary() {
  const values=new Map(),key=name=>String(name).replace(/[A-Z]/g,letter=>'-'+letter.toLowerCase());
  return new Proxy({setProperty(name,value){values.set(key(name),String(value));},removeProperty(name){values.delete(key(name));},getPropertyValue(name){return values.get(key(name))||'';}},{
    get(target,name){return name in target?target[name]:values.get(key(name))||'';},
    set(_target,name,value){if(name==='cssText'){values.clear();for(const entry of String(value).split(';')){const colon=entry.indexOf(':');if(colon>0)values.set(entry.slice(0,colon).trim(),entry.slice(colon+1).trim());}}else values.set(key(name),String(value));return true;},
  });
}
function createDocument(file) {
  const nodes=new Map();
  const document={activeElement:null,defaultView:{addEventListener(){}},getElementById:id=>nodes.get(id)||null,createElement};
  function createElement(tag) {
    const node={tagName:tag.toUpperCase(),value:'',type:'text',checked:false,disabled:false,hidden:false,files:[],dataset:{},listeners:{},children:[],style:styleBoundary(),className:'',textContent:'',
      setAttribute(name,value){this[name]=String(value);},getAttribute(name){return this[name]??null;},removeAttribute(name){delete this[name];},append(...children){this.children.push(...children);},replaceChildren(...children){this.children=children;},
      addEventListener(type,listener){(this.listeners[type] ||= []).push(listener);},removeEventListener(type,listener){this.listeners[type]=(this.listeners[type]||[]).filter(item=>item!==listener);},
      focus(){document.activeElement=this;},async fire(type){await Promise.all((this.listeners[type]||[]).map(listener=>listener({target:this,currentTarget:this,preventDefault(){},stopPropagation(){}})));},
    };
    node.classList={toggle(name,value){const classes=new Set(node.className.split(/\s+/).filter(Boolean));if(value===undefined)value=!classes.has(name);if(value)classes.add(name);else classes.delete(name);node.className=[...classes].join(' ');return value;},contains:name=>node.className.split(/\s+/).includes(name)};
    return node;
  }
  for(const match of fs.readFileSync(file,'utf8').matchAll(/<([a-z][\w-]*)\b([^>]*)>/gi)){
    const attributes=Object.fromEntries([...match[2].matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)].map(value=>[value[1],value[2]]));
    if(!attributes.id)continue;
    const node=createElement(match[1]);Object.assign(node,attributes);
    for(const name of ['disabled','hidden','checked'])node[name]=new RegExp('(?:^|\\s)'+name+'(?:\\s|$)').test(match[2]);
    nodes.set(attributes.id,node);
  }
  return {document,node:id=>document.getElementById(id)};
}
module.exports={createDocument};
