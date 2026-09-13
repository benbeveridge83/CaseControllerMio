import React from 'react'
import {createRoot} from 'react-dom/client'
import MioResearchWorkspace from '../src/MioResearchWorkspace.jsx'

const publications=[
 {id:'1',slug:'favorable',title:'Favorable study',authors_text:'A',publication_year:2025,finding_direction:'favors_shared',source_type:'original_empirical',impact_score:88,evidence_strength_score:80,equal_parenting_relevance_score:90,historical_field_importance_score:60,editorial_status:'draft',topics:[],score_notes:{},overall_findings_summary:'Positive association.',studies:[{id:'s1',publication_id:'1',study_label:'Analysis',extraction_status:'verified',exact_or_near_50_50:true,causal_claim_strength:'low'}],access_links:[{id:'a1',publication_id:'1',link_type:'canonical',url:'https://example.test/1',access_status:'open',is_public:true,redistribution_permitted:false,is_preferred:true}]},
 {id:'2',slug:'neutral',title:'Neutral study',authors_text:'B',publication_year:2024,finding_direction:'neutral',source_type:'longitudinal',impact_score:72,evidence_strength_score:75,editorial_status:'needs_review',topics:[],score_notes:{},studies:[],access_links:[]},
 {id:'3',slug:'mixed',title:'Mixed study',authors_text:'C',publication_year:2023,finding_direction:'mixed',source_type:'systematic_review',impact_score:null,evidence_strength_score:70,editorial_status:'published',topics:[],score_notes:{},studies:[],access_links:[]},
 {id:'4',slug:'conditional',title:'Conditional study',authors_text:'D',publication_year:2022,finding_direction:'conditional_concern',source_type:'original_empirical',impact_score:61,evidence_strength_score:60,editorial_status:'draft',topics:[],score_notes:{},studies:[],access_links:[]},
 {id:'5',slug:'unfavorable',title:'Unfavorable study',authors_text:'E',publication_year:2021,finding_direction:'disfavors_shared',source_type:'natural_experiment',impact_score:77,evidence_strength_score:82,equal_parenting_relevance_score:86,historical_field_importance_score:55,editorial_status:'archived',topics:[],score_notes:{},overall_findings_summary:'',studies:[],access_links:[]}
]
const children={research_studies:[],research_access_links:[],research_metrics:[],research_review_memberships:[]}
for(const p of publications){children.research_studies.push(...(p.studies||[]));children.research_access_links.push(...(p.access_links||[]))}
const publicRow=p=>({...p,studies:children.research_studies.filter(x=>x.publication_id===p.id),access_links:children.research_access_links.filter(x=>x.publication_id===p.id)})
let seq=20
function execute(table,state){
 let data=table==='research_publications'?publications:children[table]
 for(const [k,v] of state.filters)data=data.filter(x=>String(x[k]??'')===String(v))
 if(state.action==='delete'){const target=table==='research_publications'?publications:children[table];for(let i=target.length-1;i>=0;i--)if(state.filters.every(([k,v])=>String(target[i][k]??'')===String(v)))target.splice(i,1);return{data:[],error:null}}
 if(state.action==='insert'){const target=children[table];const rows=state.payload.map(x=>({...x,id:x.id||`id${++seq}`}));target.push(...rows);data=rows}
 if(state.action==='upsert'){const row={...state.payload};let existing=publications.find(x=>x.id===row.id)||(row.slug&&publications.find(x=>x.slug===row.slug));if(existing)Object.assign(existing,row);else{row.id=row.id||`p${++seq}`;publications.push(row);existing=row}data=existing}
 if(state.action==='update'){for(const row of data)Object.assign(row,state.payload)}
 if(table==='research_publications'&&Array.isArray(data))data=data.map(publicRow);else if(table==='research_publications'&&data)data=publicRow(data)
 if(state.single&&Array.isArray(data))data=data[0]||null
 return{data,error:null}
}
const supabase={from(table){const state={action:'select',payload:null,filters:[],single:false};const q={select(){return q},order(key,{ascending=true}={}){state.order=[key,ascending];const r=execute(table,state);if(Array.isArray(r.data))r.data.sort((a,b)=>ascending?String(a[key]??'').localeCompare(String(b[key]??''),undefined,{numeric:true}):String(b[key]??'').localeCompare(String(a[key]??''),undefined,{numeric:true}));return Promise.resolve(r)},eq(k,v){state.filters.push([k,v]);return q},single(){state.single=true;return Promise.resolve(execute(table,state))},upsert(payload){state.action='upsert';state.payload=payload;return q},update(payload){state.action='update';state.payload=payload;return q},delete(){state.action='delete';return q},insert(payload){state.action='insert';state.payload=Array.isArray(payload)?payload:[payload];return q},then(resolve,reject){return Promise.resolve(execute(table,state)).then(resolve,reject)}};return q}}
window.__researchStore={publications,children}
createRoot(document.getElementById('root')).render(<MioResearchWorkspace session={{user:{id:'u1'}}} supabase={supabase} enabled />)
