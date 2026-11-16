import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { validateReport,selectCandidates } from '../src/patents/patentModel.js'
import { applyPatentMount } from '../mio-patent-review-mount.js'
const candidate=(id,patent)=>({id,title:id,patent,originality:2,time:4,stage:'Example',type:'Utility',summary:'Example',combination:'Example',overlap:'Example',distinction:'Example',legal:'Example',measure:'Example',questions:['Question?'],evidence:['Source note'],sourceIds:['one'],notes:'',status:'Investigate'})
const fixture=()=>({schemaVersion:1,title:'Test',reviewDate:'2026-11-01',scope:'Synthetic',method:'Example',patentSearchNotes:'Example',candidates:[candidate('one',2),candidate('two',3)],sources:{one:{title:'Source',url:'https://www.uspto.gov/'}},legalGuide:[],nextSteps:[]})
test('imports valid research; rejects invalid scores, duplicate IDs, unsafe links and dangling sources',()=>{
 assert.equal(validateReport(fixture()).candidates.length,2)
 for(const change of [r=>r.candidates[0].patent=6,r=>r.candidates[1].id='one',r=>r.sources.one.url='javascript:alert(1)',r=>r.candidates[0].sourceIds=['missing'],r=>r.candidates[0].notes={},r=>r.candidates[0].answers={0:'false'}]){const r=fixture();change(r);assert.throws(()=>validateReport(r))}
})
test('rank stays stable when sorting and filtering',()=>{const r=fixture();assert.equal(selectCandidates(r,'','patent')[0].rank,2);assert.equal(selectCandidates(r,'one').length,1);assert.equal(selectCandidates(r,'','rank','Shortlist').length,0)})
test('mount guards both navigation and direct route and fails on anchor drift',()=>{const source=fs.readFileSync('src/App.jsx','utf8'),s=applyPatentMount(source);assert.equal(s.split("canOpenPage('patent_review') && isFirmStaffMember()").length,3);assert.match(s,/key=\{session.user.id\}/);assert.throws(()=>applyPatentMount(s));assert.throws(()=>applyPatentMount('changed source'))})
test('interactive detail saves notes and checkboxes and remount restores them',async()=>{
 const {JSDOM}=await import('jsdom'),{createServer}=await import('vite')
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'})
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.HTMLElement=dom.window.HTMLElement;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const values=new Map([['caseMioPatentReviewV1',JSON.stringify(fixture())]])
 globalThis.__patentTestStore={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)}
 const server=await createServer({configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},plugins:[{name:'test-cloud',enforce:'pre',load(id){if(id.endsWith('/src/mioCloudRuntime.js'))return 'export const mioStorage=globalThis.__patentTestStore;export const mioCloudStore={status:()=>({owner:"test-user",phase:"ready",pending:0}),subscribe:()=>()=>{}}'}}]})
 try {
  const {default:Component}=await server.ssrLoadModule('/src/patents/MioPatentReview.jsx');const React=await import('react'),{createRoot}=await import('react-dom/client');let root=createRoot(document.getElementById('root'))
  await React.act(()=>root.render(React.createElement(Component,{userId:'test-user'})))
  assert.equal(document.querySelectorAll('.patent-card').length,2)
  await React.act(()=>document.querySelector('.patent-card').click())
  const area=document.querySelector('textarea')
  await React.act(()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(area,'Counsel follow-up');area.dispatchEvent(new window.Event('input',{bubbles:true}));area.dispatchEvent(new window.Event('change',{bubbles:true}))})
  // React exposes the same onChange callback used by the native input event.
  if(!JSON.parse(values.get('caseMioPatentReviewV1')).candidates[0].notes){const key=Object.keys(area).find(k=>k.startsWith('__reactProps'));await React.act(()=>area[key].onChange({target:{value:'Counsel follow-up'}}))}
  await React.act(()=>document.querySelector('.patent-question input').click())
  const stored=JSON.parse(values.get('caseMioPatentReviewV1'));assert.equal(stored.candidates[0].notes,'Counsel follow-up');assert.equal(stored.candidates[0].answers[0],true)
  await React.act(()=>root.unmount());root=createRoot(document.getElementById('root'));await React.act(()=>root.render(React.createElement(Component,{userId:'test-user'})));await React.act(()=>document.querySelector('.patent-card').click());assert.equal(document.querySelector('textarea').value,'Counsel follow-up');assert.equal(document.querySelector('.patent-question input').checked,true);await React.act(()=>root.unmount())
 }finally{await server.close();dom.window.close();delete globalThis.__patentTestStore}
})
