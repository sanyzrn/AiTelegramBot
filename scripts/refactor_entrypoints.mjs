import ts from 'typescript';
import fs from 'node:fs';
import path from 'node:path';

const processor = {
  state: 'TOKEN GK RK BASE LEGACY ADMIN KEY db ready admin reply esc',
  ui: 'TONES SIZES LANG TOOLS toneGuide MENU rows keyboard show navigate',
  transport: 'HOOK hook equal tg send sendSpoiler code deliver',
  admin: 'allowed pref save cfg configSet stats flow testModel adminInput exportMd documentSend',
  media: 'file base64 media doc decode parseDoc repo',
  model: 'ai',
  voice: 'chooseVoice voiceAction handleVoiceReply',
  work: 'reserve refund metric failMessage startWork work retry',
  life: 'lastSweep sweep scheduleRealTimer setReminder saveTasks listTasks doneTask profile',
  index: 'callbacks message',
};
const gateway = {
  state: 'TOKEN GK RK BASE LEGACY ADMIN KEY db ready admin out',
  transport: 'HOOK hook equal tg send forward allowed',
  output: 'esc stripRepeatedIntro deliver',
  config: 'MENUS toneGuide config readHistory',
  search: 'groundedSearch searchMessage',
  conversation: 'reply',
  index: '',
};
const nameMap = (groups) => new Map(Object.entries(groups).flatMap(([group, names]) => names.split(' ').filter(Boolean).map((name) => [name, group])));
function assert(condition, msg) { if (!condition) throw Error(msg); }
function fixSource(text, which) {
  assert(text.startsWith('// @ts-nocheck\n'), `${which}: expected exact legacy header`);
  text=text.slice('// @ts-nocheck\n'.length);
  if(which === 'saeed-ai-v7') {
    const old='async function metric(update, id, s, status, usage = {}, reason = "")';
    assert(text.includes(old), 'metric signature not found');
    text=text.replace(old,'async function metric(update, id, s, status, usage: { input?: number | null; output?: number | null } = {}, reason = "")');
    const parts='const parts = [{ text: input }];';
    assert(text.includes(parts), 'media part signature not found');
    text=text.replace(parts,'const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [{ text: input }];');
  } else {
    const old='      usage = {},';
    assert(text.includes(old), 'gateway usage declaration not found');
    text=text.replace(old,'      usage = {} as { input?: number | null; output?: number | null },');
    const oldMap='new Map(\n        (g.groundingChunks || [])';
    assert(text.includes(oldMap), 'grounding source map not found');
    text=text.replace(oldMap,'new Map<string, { title?: string; uri: string }>(\n        (g.groundingChunks || [])');
  }
  return text;
}
function refactor(which, groups) {
  const file=`supabase/functions/${which}/index.ts`;
  const text=fixSource(fs.readFileSync(file,'utf8'),which);
  const source=ts.createSourceFile(file,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  assert(source.parseDiagnostics.length===0,`${which}: parse errors: ${source.parseDiagnostics.length}`);
  const names=nameMap(groups), statements=[], owner=new Map(), externalImports=[];
  for(const stmt of source.statements){
    if(ts.isImportDeclaration(stmt)) { externalImports.push(text.slice(stmt.getStart(source),stmt.end));continue; }
    let declared=[];
    if(ts.isFunctionDeclaration(stmt)||ts.isClassDeclaration(stmt)||ts.isInterfaceDeclaration(stmt)||ts.isTypeAliasDeclaration(stmt)) {
      declared=[stmt.name?.text].filter(Boolean);
    } else if(ts.isVariableStatement(stmt) && stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) {
      declared=[];
    } else if(ts.isVariableStatement(stmt)) {
      for(const d of stmt.declarationList.declarations){
        assert(ts.isIdentifier(d.name),`${which}: destructuring top-level variable requires review`);
        declared.push(d.name.text);
      }
    } else if(ts.isTryStatement(stmt)) {
      declared=[];
    } else if(ts.isExpressionStatement(stmt)&&ts.isCallExpression(stmt.expression)&&stmt.expression.expression.getText(source)==='Deno.serve') {
      declared=[];
    } else {
      throw Error(`${which}: unexpected statement at ${source.getLineAndCharacterOfPosition(stmt.getStart(source)).line+1}: ${ts.SyntaxKind[stmt.kind]}`);
    }
    let group;
    if(ts.isVariableStatement(stmt) && stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword)) group='index';
    else if(ts.isTryStatement(stmt)) group='state';
    else if(ts.isExpressionStatement(stmt)) group='index';
    else {
      group=names.get(declared[0]);
      assert(group,`${which}: missing group for ${declared[0]}`);
      for(const name of declared) assert(names.get(name)===group,`${which}: mixed declaration ${declared.join(',')}`);
    }
    for(const name of declared) {
      assert(!owner.has(name),`${which}: duplicate ${name}`);
      owner.set(name,group);
    }
    statements.push({stmt,group,declared});
  }
  for(const n of names.keys()) assert(owner.has(n),`${which}: missing mapped declaration ${n}`);
  const options={allowImportingTsExtensions:true,noResolve:true,strict:false,target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext};
  const host=ts.createCompilerHost(options);
  const root=path.resolve(file);
  const originalGet=host.getSourceFile.bind(host);
  host.getSourceFile=(f,languageVersion,onError,shouldCreateNewSourceFile)=>path.resolve(f)===root? source:originalGet(f,languageVersion,onError,shouldCreateNewSourceFile);
  const program=ts.createProgram([file],options,host);
  const checker=program.getTypeChecker();
  const symbols=new Map();
  for(const {stmt,declared} of statements){
    const declNodes=ts.isVariableStatement(stmt)?stmt.declarationList.declarations.map(d=>d.name):stmt.name?[stmt.name]:[];
    for(let i=0;i<declNodes.length;i++){
      const sym=checker.getSymbolAtLocation(declNodes[i]);
      if(sym) symbols.set(sym,declared[i]);
    }
  }
  const dependencies=new Map(), exporters=new Map();
  for(const group of Object.keys(groups)){ dependencies.set(group,new Map());exporters.set(group,new Set()); }
  dependencies.set('index',new Map());exporters.set('index',new Set());
  for(const {stmt,group} of statements){
    const visit=node=>{
      if(ts.isIdentifier(node)){
        const name=symbols.get(checker.getSymbolAtLocation(node));
        if(name&&owner.get(name)!==group){
          const other=owner.get(name);
          dependencies.get(group).set(name,other);
          exporters.get(other).add(name);
          if((ts.isBinaryExpression(node.parent)&&node.parent.left===node&&node.parent.operatorToken.kind>=ts.SyntaxKind.FirstAssignment&&node.parent.operatorToken.kind<=ts.SyntaxKind.LastAssignment)||
             ((ts.isPrefixUnaryExpression(node.parent)||ts.isPostfixUnaryExpression(node.parent))&&[ts.SyntaxKind.PlusPlusToken,ts.SyntaxKind.MinusMinusToken].includes(node.parent.operator))){
            throw Error(`${which}: cross-module mutable binding ${name}`);
          }
        }
      }
      ts.forEachChild(node,visit);
    };
    visit(stmt);
  }
  const dirs=path.dirname(file),newDir=path.join(dirs,'core');
  fs.mkdirSync(newDir,{recursive:true});
  const moduleNames=[...new Set(statements.map(s=>s.group))];
  const paths=[];
  for(const group of moduleNames){
    const filename=group==='index'?file:path.join(newDir,`${group}.ts`);
    const relative=group==='index'?'../_shared/':'../../_shared/';
    const imports=externalImports.map(s=>s.replaceAll('../_shared/',relative)).join('\n');
    const byOwner=new Map();
    for(const [name,other] of dependencies.get(group)){
      if(!byOwner.has(other))byOwner.set(other,[]);
      byOwner.get(other).push(name);
    }
    const ownPath=group==='index'?'./core/':'./';
    const cross=[...byOwner].map(([other,symbols])=>`import { ${symbols.sort().join(', ')} } from "${other==='index' ? (group==='index'?'./index.ts':'../index.ts') : ownPath+other+'.ts'}";`).join('\n');
    let result=[`/** Saeed AI ${which} ${group} module. Source moved without behavioral rewrites. */`,imports,cross, 'declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void };'].filter(Boolean).join('\n')+'\n';
    for(const {stmt,group:actual,declared} of statements){
      if(actual!==group)continue;
      if(ts.isVariableStatement(stmt) && stmt.modifiers?.some(m=>m.kind===ts.SyntaxKind.DeclareKeyword))continue;
      const before=text.slice(stmt.getFullStart(),stmt.getStart(source));
      const body=text.slice(stmt.getStart(source),stmt.end);
      const exported=declared.some(n=>exporters.get(group).has(n));
      result+=before+(exported&&!body.startsWith('export ')?'export ':'')+body+'\n';
    }
    assert(!result.includes('@ts-nocheck'),`${which}:${group} type checking suppression preserved`);
    fs.writeFileSync(filename,result);
    paths.push([filename,result.length]);
  }
  const idx=fs.readFileSync(file,'utf8');
  assert(idx.length < (which==='saeed-ai-v7'?18000:14000),`${which}: index remains too large (${idx.length})`);
  console.log(which,'modular files:',paths,'original bytes:',text.length);
}
refactor('saeed-ai-v7',processor);
refactor('saeed-ai-ui',gateway);
