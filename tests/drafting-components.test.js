import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { COMPONENTS, resolveCaseStyle, fileComponentData, fillComponent, validateLayout, componentIssues, semanticSuggestions, reviewSuggestions, componentHasTarget } from '../src/mioDraftingComponents.js'
import { transformDraftingComponents } from '../mio-v278-drafting-components.js'
const profile = { default_case_style_id: 'sapcr', case_styles: [{id:'divorce-children',kind:'divorce',requires_children:true},{id:'divorce',kind:'divorce',requires_children:false},{id:'sapcr',kind:'sapcr'},{id:'custom',kind:'custom'}] }
test('divorce captions are child-aware; all other types use configurable fallback', () => {
  assert.equal(resolveCaseStyle(profile,'Divorce',true).id,'divorce-children')
  assert.equal(resolveCaseStyle(profile,'DIVORCE',false).id,'divorce')
  for(const type of ['SAPCR modification','Enforcement','Other','']) assert.equal(resolveCaseStyle(profile,type,false).id,'sapcr')
})
test('case mapping, document override, and reset have predictable precedence', () => {
  const p={...profile,case_type_style_map:{'SAPCR modification':'custom'}}
  assert.equal(resolveCaseStyle(p,' SAPCR modification ',true).id,'custom')
  assert.equal(resolveCaseStyle(p,'SAPCR modification',true,'divorce').id,'divorce')
  assert.equal(resolveCaseStyle(p,'SAPCR modification',true,'').id,'custom')
})
test('per-file component edits cannot mutate the shared profile or another file', () => {
  const data={case_caption_text:'Default caption',attorney_signature_block:'Attorney',drafting_components:{a:{caption:{text:'Edited\nCaption',placement:'bound'},signature:{text:'',placement:'bound'}}}}
  const before=JSON.stringify(data)
  assert.equal(fileComponentData(data,{id:'a'},profile).case_caption_text,'Edited\nCaption')
  assert.equal(fileComponentData(data,{id:'a'},profile).attorney_signature_block,'')
  assert.equal(fileComponentData(data,{id:'b'},profile).case_caption_text,'Default caption')
  assert.equal(JSON.stringify(data),before)
})
test('append does not change a pre-existing mapped block',()=>{
 const data={case_caption_text:'Original',drafting_components:{a:{caption:{text:'Additional',placement:'append'}}}}
 assert.equal(fileComponentData(data,{id:'a'},profile).case_caption_text,'Original')
})
test('unpopulated service facts are visible, never invented',()=>{
 assert.equal(fillComponent('Served {{who}} on {{date}}',{who:'Counsel'}),'Served Counsel on [Missing: date]')
 assert.equal(componentIssues({drafting_components:{a:{certificate:{text:'[Missing: date]',placement:'bound'}}}},{id:'a'}).length,1)
})
test('layout validation rejects corrupt or unsafe dimensions',()=>{
 for(const v of [{font:'Times',size:0,line:1,margin:1},{font:'Times',size:12,line:'NaN',margin:1},{font:'Times',size:12,line:1,margin:9}])assert.throws(()=>validateLayout(v))
 assert.deepEqual(validateLayout({font:'Times',size:'12',line:'1.5',margin:'1'}),{font:'Times',size:12,line:1.5,margin:1})
})
test('component targets are file-scoped and inactive bindings do not count',()=>{
 const c=COMPONENTS.find(c=>c.key==='certificate'), t={bindings:[{kind:'component_block',field_key:c.token,file_id:'a',is_active:true}]}
 assert.equal(componentHasTarget(c,t,{id:'a'}),true)
 assert.equal(componentHasTarget(c,t,{id:'b'}),false)
 assert.equal(componentHasTarget(c,{bindings:[]},{id:'a'},'{{certificate_of_service_text}}'),true)
})
test('detector rejects legal-language false positives and does not globalize pronouns',()=>{
 const results=reviewSuggestions([{kind:'field',source_text:'Texas Rules'},{kind:'field',source_text:'Civil Procedure'},{kind:'pronoun',source_text:'his',replace_all:true,source:'local_ai'}])
 assert.equal(results.length,1);assert.equal(results[0].replace_all,false);assert.equal(results[0].source,'local_rule')
})
test('semantic detector maps known attorney and cause rather than capitalized phrases',()=>{
 const document={file_id:'f',paragraphs:[{index:0,text:'CAUSE NO. 000-TEST',normalized:'CAUSE NO. 000-TEST'},{index:1,text:'Sample Lawyer files this under the Texas Rules of Civil Procedure.',normalized:'Sample Lawyer files this under the Texas Rules of Civil Procedure.'}]}
 const suggestions=semanticSuggestions(document,['Sample Lawyer'])
 assert.equal(suggestions.length,2);assert.equal(suggestions[1].data_source,'attorney.name');assert.equal(suggestions[0].source_text,'000-TEST')
})
test('integration composes all earlier releases and fails closed on changed anchors',async()=>{
 let code=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
 for(const name of ['mio-v268-transform','mio-v268-hotfix','mio-v272-drafting-formatting','mio-v274-drafting-layout','mio-v275-drafting-editor','mio-v276-autofill-picker','mio-v277-cloud-persistence']){
   const plugin=(await import(`../${name}.js`)).default();const result=await plugin.transform(code,'/repo/src/App.jsx');code=typeof result==='string'?result:result?.code||code
 }
 const next=transformDraftingComponents(code)
 assert.match(next,/DraftingComponents data=\{assemblyData\}/)
 assert.match(next,/mioApplyComponentXml\(xmlDoc, data, xmlPath\)/)
 assert.ok(next.indexOf('const [mioCloudHydrationDone')<next.indexOf("saveMioStateKey('caseMioDraftingSessionV278'"))
 assert.throws(()=>transformDraftingComponents(code.replace('function draftingResolveCaseStyle','function movedCaseStyle')))
 assert.throws(()=>transformDraftingComponents(next))
})
