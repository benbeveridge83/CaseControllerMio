import test from 'node:test'
import assert from 'node:assert/strict'
import {createMioCalendarEventChannel} from '../src/mioCalendarEventChannel.js'

function channelStub() {
  const peers = []
  class Channel {
    constructor(name){this.name=name;this.closed=false;this.unrefCount=0;peers.push(this)}
    unref(){this.unrefCount++}
    postMessage(data){for(const peer of peers)if(peer!==this&&!peer.closed&&peer.onmessage)peer.onmessage({data})}
    close(){this.closed=true}
  }
  return {Channel,peers}
}

test('a calendar change notification reaches every subscribed view exactly once', () => {
  const {Channel,peers}=channelStub()
  const seen=[]
  const first=createMioCalendarEventChannel({Channel,channelName:'test-calendar'})
  const second=createMioCalendarEventChannel({Channel,channelName:'test-calendar'})
  const stop=second.subscribe(()=>seen.push('second'))
  first.subscribe(()=>seen.push('first'))
  assert.equal(peers.filter((peer)=>peer.unrefCount===1).length,2,'an idle tab must not keep the process alive')
  assert.equal(first.notify(),true)
  assert.deepEqual(seen,['second'],'the sending tab never notifies itself')
  stop()
  assert.equal(first.notify(),true)
  assert.deepEqual(seen,['second'],'an unsubscribed view is never notified')
  first.close();second.close()
})

test('messages are invalidation hints only and never carry case data', () => {
  const {Channel}=channelStub()
  const raw=new Channel('stub')
  const received=[]
  raw.onmessage=({data})=>received.push(data)
  const channel=createMioCalendarEventChannel({Channel,channelName:'test-payload'})
  channel.notify()
  assert.deepEqual(received,[{type:'calendar-changed'}])
  assert.equal(JSON.stringify(received[0]).includes('caseMio'),false)
  channel.close()
})

test('a listener that throws cannot stop the remaining views', () => {
  const {Channel}=channelStub()
  const seen=[]
  const source=createMioCalendarEventChannel({Channel,channelName:'test-failure'})
  const target=createMioCalendarEventChannel({Channel,channelName:'test-failure'})
  target.subscribe(()=>{throw new Error('stale view')})
  target.subscribe(()=>seen.push('healthy'))
  source.notify()
  assert.deepEqual(seen,['healthy'])
  source.close();target.close()
})

test('a browser without BroadcastChannel still loads and never fails a save', () => {
  const channel=createMioCalendarEventChannel({Channel:null})
  assert.equal(channel.notify(),false)
  assert.equal(typeof channel.subscribe(()=>{}),'function')
  channel.close()
})

test('closed channels stop delivering', () => {
  const {Channel}=channelStub()
  const seen=[]
  const source=createMioCalendarEventChannel({Channel,channelName:'test-closed'})
  const target=createMioCalendarEventChannel({Channel,channelName:'test-closed'})
  target.subscribe(()=>seen.push('target'))
  target.close()
  source.notify()
  assert.deepEqual(seen,[])
  source.close()
  assert.equal(source.notify(),false)
})
