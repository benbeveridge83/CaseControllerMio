import {useSyncExternalStore} from 'react'
import {mioCloudStore} from '../mioCloudRuntime.js'
import ProcessBuilder from './ProcessBuilder.jsx'
const KEY='caseMioProcessDefinitionsV1'
export default function ProcessBuilderSettings({templates=[],ownerId}){
  useSyncExternalStore(mioCloudStore.subscribe,mioCloudStore.getVersion)
  const status=mioCloudStore.status()
  if(status.owner!==ownerId||status.phase!=='ready')return <p>Loading process definitions from your account…</p>
  let definitions
  try{definitions=JSON.parse(mioCloudStore.storage.getItem(KEY)||'[]');if(!Array.isArray(definitions)||definitions.some(d=>!d?.blocks||!d?.edges||!d?.fields))throw Error()}
  catch{return <p role="alert">Saved process definitions could not be read. No data has been overwritten. Reload or restore the saved version before editing.</p>}
  return <ProcessBuilder key={ownerId} initialDefinitions={definitions} templates={templates} onSave={async next=>{
    if(mioCloudStore.status().owner!==ownerId)throw Error('Account changed. Reload before saving.')
    await mioCloudStore.saveNow(KEY,JSON.stringify(next),{throwOnError:true})
    if(mioCloudStore.status().owner!==ownerId)throw Error('Account changed while saving.')
    return true
  }}/>
}
