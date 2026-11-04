import ts from 'typescript';
import {createHash} from 'node:crypto';

/** Runtime structure, ignoring trivia and grouping emitted around typed arrows.
 * Preserve operators, literals, modifiers and declaration kinds.
 */
export function runtimeStructure(source) {
  const javascript=ts.transpileModule(source,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,verbatimModuleSyntax:true,
  }}).outputText;
  const file=ts.createSourceFile('runtime.js',javascript,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS);
  function visit(node) {
    if(ts.isParenthesizedExpression(node))return visit(node.expression);
    const value=[ts.SyntaxKind[node.kind]];
    if(!ts.isSourceFile(node) && typeof node.text==='string')value.push(node.text);
    if(ts.isPrefixUnaryExpression(node)||ts.isPostfixUnaryExpression(node))value.push(ts.SyntaxKind[node.operator]);
    if(typeof node.rawText==='string')value.push(node.rawText);
    if(ts.isVariableDeclarationList(node))value.push(node.flags & (ts.NodeFlags.Const|ts.NodeFlags.Let));
    ts.forEachChild(node,child=>{value.push(visit(child));});
    return value;
  }
  return createHash('sha256').update(JSON.stringify(visit(file))).digest('hex');
}
