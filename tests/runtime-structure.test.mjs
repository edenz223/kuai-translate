import test from 'node:test';
import assert from 'node:assert/strict';
import {runtimeStructure} from '../scripts/runtime-structure.mjs';
test('runtime comparison ignores erased annotations and emitted grouping',()=>{
  assert.equal(runtimeStructure('export const f=x=>x+1;'),runtimeStructure('export const f=(x:number)=>x+1;'));
});
test('runtime comparison detects literal, operator, scope and async changes',()=>{
  for(const [before,after] of [
    ['const value=1;','const value=2;'],
    ['const f=x=>x+1;','const f=x=>x-1;'],
    ['const value=1;','let value=1;'],
    ['async function run(){}','function run(){}'],
    ['const f=x=>+x;','const f=x=>-x;'],
    ['let x=0;x++;','let x=0;x--;'],
  ])assert.notEqual(runtimeStructure(before),runtimeStructure(after));
});
