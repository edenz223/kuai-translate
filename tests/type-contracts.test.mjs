import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import path from 'node:path';
import {projectRoot} from '../scripts/project.mjs';
test('the contract compiler includes compile-only message rejection assertions',()=>{
  const configPath=path.join(projectRoot,'tsconfig.types.json');
  const config=ts.readConfigFile(configPath,ts.sys.readFile);
  assert.equal(config.error,undefined);
  const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,projectRoot);
  assert.ok(parsed.fileNames.includes(path.join(projectRoot,'tests/types/message-contracts.ts')));
  assert.equal(parsed.options.strict,true);
});
