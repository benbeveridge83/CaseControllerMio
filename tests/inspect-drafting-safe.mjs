import fs from 'node:fs'
import {parse} from '@babel/parser'
import config from '../vite.config.js'
let code=fs.readFileSync('src/App.jsx','utf8')
for(const plugin of config.plugins.flat(Infinity).filter(Boolean)){
 if(!plugin.name?.startsWith('mio-')||!plugin.transform)continue
 const r=await plugin.transform(code,process.cwd()+'/src/App.jsx');if(r)code=typeof r==='string'?r:r.code
}
const ast=parse(code,{sourceType:'module',plugins:['jsx']})
const names=new Set(['draftingApplyVisualBindings','renderDraftingSettingsLegacy','draftingStudioV284SelectParagraph'])
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='FunctionDeclaration'&&names.has(node.id?.name)){console.log('\nFUNCTION '+node.id.name+'\n'+code.slice(node.start,node.end));names.delete(node.id.name)}for(const [key,value] of Object.entries(node)){if(['loc','start','end','extra'].includes(key))continue;if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value)}}
walk(ast);console.log('PASS: complete transformed application parses without syntax errors')
