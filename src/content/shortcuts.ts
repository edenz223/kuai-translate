import {normalizeKey,normalizeShortcut} from '../shared/interactions.js';

const modifiers: Record<string, 'ctrlKey'|'altKey'|'shiftKey'|'metaKey'>={Control:'ctrlKey',Alt:'altKey',Shift:'shiftKey',Meta:'metaKey'};

/** Match an explicitly configured action without accepting extra modifiers. */
export function matchesShortcut(event: KeyboardEvent | null | undefined,shortcut: unknown): boolean{
  if(!event||event.repeat||event.defaultPrevented||event.isComposing||event.keyCode===229)return false;
  const value=normalizeShortcut(shortcut);if(!value)return false;
  const parts=value.split('+'),letter=parts.pop();
  const key=/^Key[A-Z]$/.test(event.code||'')?event.code.slice(3):normalizeKey(event.key);
  return key===letter&&Object.entries(modifiers).every(([name,flag])=>!!event[flag]===parts.includes(name));
}

/** Mouse modifier flags repair missed keyboard events; letters need real key events. */
export function createHeldKeys(){
  const keys=new Set<string>();
  return {
    update(event: Pick<KeyboardEvent,'ctrlKey'|'altKey'|'shiftKey'|'metaKey'> & Partial<Pick<KeyboardEvent,'key'>>,down?: boolean): void{
      for(const [key,flag]of Object.entries(modifiers))if(event[flag])keys.add(key);else keys.delete(key);
      if(down!==undefined){const key=normalizeKey(event.key);if(key){if(down)keys.add(key);else keys.delete(key);}}
    },
    has:(key: string)=>keys.has(key),
    matches:(required: readonly string[])=>required.length>0&&keys.size===required.length&&required.every(key=>keys.has(key)),
    clear:()=>keys.clear(),
  };
}
