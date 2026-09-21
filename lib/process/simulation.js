// Deliberately no provider imports. This model cannot send, save files, file, or bill.
import {clone,validateDefinition} from './model.js'
function activate(s){
  let changed=true
  while(changed){changed=false
    for(const b of s.definition.blocks){
      const state=s.states[b.id];if(state.status!=='not_started')continue
      const dependencies=s.definition.edges.filter(e=>e.target===b.id).map(e=>s.states[e.source].status==='complete')
      if(b.activation!=='row_created'&&!(dependencies.length&&(b.join==='any'?dependencies.some(Boolean):dependencies.every(Boolean))))continue
      state.status=b.config.review?'review':'ready';changed=true
      if(b.type==='email'&&!b.config.review){state.sent=true;state.status=b.config.waitForReply?'waiting':b.completion==='field'?'reply_received':'complete'}
    }
  }
  return s
}
export function startSimulation(definition){
  const errors=validateDefinition(definition);if(errors.length)throw Error(errors.join('; '))
  if(!definition.blocks.length)throw Error('Add a block before testing')
  return activate({definition:clone(definition),states:Object.fromEntries(definition.blocks.map(b=>[b.id,{status:'not_started',sent:false}])),outputs:{},history:[]})
}
export function advanceSimulation(current,id,action,value=''){
  const s=clone(current),b=s.definition.blocks.find(x=>x.id===id),state=s.states[id]
  if(!b||['not_started','complete'].includes(state.status))throw Error('Choose an active block')
  if(action==='send'){
    if(b.type!=='email')throw Error('Only email blocks can send')
    if(state.sent)throw Error('Email already sent in this simulation')
    state.sent=true;state.status=b.config.waitForReply?'waiting':b.completion==='field'?'reply_received':'complete'
  }else if(action==='reply'){
    if(!state.sent||state.status!=='waiting')throw Error('Send the email before receiving a reply')
    state.status='reply_received'
  }else if(action==='complete'){
    if(b.type==='email'&&!state.sent)throw Error('Send the email before completing the block')
    if(b.type==='email'&&b.config.waitForReply&&state.status==='waiting')throw Error('Receive a reply first')
    if(b.completion==='field'&&!String(value).trim())throw Error('Enter a result before completing this block')
    s.outputs[id]={[b.output.key]:String(value).trim()||'Simulated '+b.output.label};state.status='complete'
  }else throw Error('Unknown simulation action')
  s.history.push({blockId:id,action});return activate(s)
}
export function simulationStatus(s){
  const active=s.definition.blocks.filter(b=>!['not_started','complete'].includes(s.states[b.id].status))
  const b=active.find(b=>s.states[b.id].status!=='waiting')||active[0]
  if(!b)return {category:'complete',message:'Process complete',pendingCount:0,unread:false}
  const state=s.states[b.id],status=state.status
  return {category:status==='waiting'?'others':'me',blockId:b.id,step:b.stepNumber,name:b.name,pendingCount:active.length,unread:active.some(x=>s.states[x.id].status==='reply_received'),message:b.messages[status==='waiting'?'waiting':status==='reply_received'?'reply':status==='review'?'review':'input']}
}
