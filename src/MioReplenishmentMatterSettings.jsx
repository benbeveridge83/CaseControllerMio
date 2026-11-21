import React,{useEffect,useState} from 'react';
import {supabase} from './supabaseClient.js';
import {loadReplenishmentSettings,saveReplenishmentSettings} from './mioReplenishmentSettings.js';

const label={fontSize:12,color:'#64748b'};
export default function MioReplenishmentMatterSettings({matters=[]}) {
 const [state,setState]=useState({loading:true,error:'',settings:{},userId:''});
 const [filter,setFilter]=useState('');
 const [saving,setSaving]=useState({});
 useEffect(()=>{
  let alive=true;
  async function load(){
   try{
    const {data:{user},error}=await supabase.auth.getUser();
    if(error)throw error;
    if(!user)throw new Error('Sign in to manage replenishment settings.');
    const settings=await loadReplenishmentSettings(supabase,user.id);
    if(alive)setState({loading:false,error:'',settings,userId:user.id});
   }catch(error){if(alive)setState(prev=>({...prev,loading:false,error:error.message||String(error)}));}
  }
  load();return()=>{alive=false};
 },[]);
 const update=async (id,patch)=>{
  setSaving(prev=>({...prev,[id]:true}));
  try {
   const saved=await saveReplenishmentSettings(supabase,state.userId,id,patch);
   setState(prev=>({...prev,error:'',settings:{...prev.settings,[id]:saved}}));
  }catch(error){setState(prev=>({...prev,error:'Could not save '+id+': '+(error.message||String(error))}));}
  finally{setSaving(prev=>({...prev,[id]:false}));}
 };
 const filtered=(matters||[]).filter(m=>String(m.name||'').toLowerCase().includes(filter.toLowerCase())).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
 return <section aria-label="Trust replenishment matter settings" style={{padding:16,background:'#fff',border:'1px solid #cbd5e1',borderRadius:10,margin:'14px 0'}}>
  <h3 style={{margin:'0 0 6px'}}>Trust replenishment settings</h3>
  <p style={{fontSize:13}}>These preferences persist. Appointed matters stay excluded by the shared Appointed designation; this panel does not change appointment status. A primary matter designation does not authorize sharing trust funds between separate client ledgers.</p>
  {state.error&&<p role="alert" style={{color:'#b91c1c'}}>{state.error}</p>}
  {state.loading?<p>Loading preferences…</p>:<>
   <label>Find matter <input value={filter} onChange={e=>setFilter(e.target.value)} placeholder="Search matter" style={{marginLeft:8}}/></label>
   <div style={{overflowX:'auto',maxHeight:450,overflowY:'auto',marginTop:12}}>
    <table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}>
     <thead><tr>{['Matter','Replenishment enabled','Primary matter','Related matters','Minimum trust ($)','Target trust ($)','Withdrawal review'].map(x=><th key={x} style={{textAlign:'left',padding:8,borderBottom:'1px solid #cbd5e1'}}>{x}</th>)}</tr></thead>
     <tbody>{filtered.map(m=>{
      const current=state.settings[m.id]||{},disabled=!!saving[m.id],min=current.minimum_trust,target=current.target_trust;
      return <tr key={m.id}><td style={{padding:8,borderBottom:'1px solid #e2e8f0'}}><strong>{m.name||m.id}</strong>{m.is_active===false&&<span style={{color:'#64748b'}}> (closed)</span>}</td>
      <td style={{padding:8}}><input type="checkbox" aria-label={`Enable replenishment for ${m.name}`} checked={current.replenishment_enabled!==false} disabled={disabled} onChange={e=>update(m.id,{replenishment_enabled:e.target.checked})}/></td>
      <td style={{padding:8}}><input type="checkbox" aria-label={`Primary replenishment for ${m.name}`} checked={current.primary_replenishment_matter!==false} disabled={disabled} onChange={e=>update(m.id,{primary_replenishment_matter:e.target.checked})}/></td>
      <td style={{padding:8}}>
       <details><summary style={{cursor:'pointer'}}>Related ({(current.covered_matter_ids||[]).length})</summary>
        {(matters||[]).filter(other=>other.id!==m.id&&other.client_id&&m.client_id&&String(other.client_id)===String(m.client_id)).map(other=><label key={other.id} style={{display:'flex',gap:5,alignItems:'center',minWidth:150,marginTop:5,fontSize:12}}>
         <input type="checkbox" checked={(current.covered_matter_ids||[]).includes(other.id)} disabled={disabled} onChange={e=>{
           const ids=new Set(current.covered_matter_ids||[]);
           if(e.target.checked)ids.add(other.id);else ids.delete(other.id);
           update(m.id,{covered_matter_ids:[...ids]});
         }}/> {other.name}
        </label>)}
        <small style={label}>Only matters belonging to this same client can be linked. Linked matters share payment-email grouping, not trust-ledger balances.</small>
       </details>
      </td>
      <td style={{padding:8}}><input type="number" min="0" step=".01" aria-label={`Minimum trust for ${m.name}`} key={m.id+'-min-'+String(min)} defaultValue={min??''} disabled={disabled} style={{width:105}} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==Number(min))update(m.id,{minimum_trust:Number(e.target.value)})}}/></td>
      <td style={{padding:8}}><input type="number" min="0" step=".01" aria-label={`Target trust for ${m.name}`} key={m.id+'-target-'+String(target)} defaultValue={target??''} disabled={disabled} style={{width:105}} onBlur={e=>{if(e.target.value!==''&&Number(e.target.value)!==Number(target))update(m.id,{target_trust:Number(e.target.value)})}}/></td>
      <td style={{padding:8}}><input type="checkbox" aria-label={`Withdrawal review for ${m.name}`} checked={current.withdrawal_flagged===true} disabled={disabled} onChange={e=>update(m.id,{withdrawal_flagged:e.target.checked})}/></td>
      </tr>
     })}</tbody>
    </table>
   </div>
   <p style={label}>Blank amounts keep the existing matter finance defaults. Savings are immediate; reopen replenishment review after editing amounts.</p>
  </>}
 </section>;
}
