import { useEffect,useMemo,useState,useRef,useCallback } from 'react'
import { emailClient } from '../email/emailClient.js'
import { loadCategories } from '../email/categoryCache.js'
import { keywordCategories,normalizeCategories } from '../../lib/email/categories.js'
import { buildMatterIndex,matchMessageToMatters } from '../../lib/email/matching.js'
import { messageKey } from './model.js'

export function useDashboardMail(userId,matters){
 const [raw,setRaw]=useState([]),[cache,setCache]=useState(()=>loadCategories(userId)),[error,setError]=useState(''),[loading,setLoading]=useState(false)
 const [reviewed,setReviewed]=useState(()=>{try{return JSON.parse(localStorage.getItem(`mio-dashboard-reviewed:${userId}`)||'{}')}catch{return {}}})
 const busy=useRef(false),alive=useRef(true)
 const refresh=useCallback(async()=>{if(busy.current)return;busy.current=true;setLoading(true);try{const result=await emailClient.messages();if(alive.current){setRaw(result.messages||[]);setError('');setCache(loadCategories(userId))}}catch(e){if(alive.current)setError(e.message)}finally{busy.current=false;if(alive.current)setLoading(false)}},[userId])
 useEffect(()=>{alive.current=true;refresh();const timer=setInterval(refresh,60000);const focus=()=>{if(!document.hidden)refresh()};const categories=()=>setCache(loadCategories(userId));window.addEventListener('focus',focus);window.addEventListener('mio-email-categories',categories);return()=>{alive.current=false;clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('mio-email-categories',categories)}},[refresh,userId])
 const index=useMemo(()=>buildMatterIndex(matters),[matters])
 const messages=useMemo(()=>raw.map(message=>{
  const cached=cache[messageKey(message)],fallback=keywordCategories(message.subject,message.bodyPreview)
  const categories=normalizeCategories([...(cached?.categories||fallback),...(message.isDraft?['drafts']:[]),...fallback.filter(c=>['drafts','service'].includes(c))])
  let matches=matchMessageToMatters(message,matters,index)
  const text=`${message.subject||''} ${message.bodyPreview||''}`.toLowerCase()
  const causeMatches=matters.filter(m=>String(m.cause_number||'').length>=5&&text.includes(String(m.cause_number).toLowerCase()))
  if(causeMatches.length===1)matches=[{matterId:String(causeMatches[0].id)}]
  const key=messageKey(message),fingerprint=`${message.receivedDateTime}|${message.bodyPreview}`
  return {...message,categories,matches,unread:!message.isDraft&&!message.isRead&&reviewed[key]!==fingerprint}
 }),[raw,cache,index,matters,reviewed])
 function markReviewed(message){const key=messageKey(message);setReviewed(current=>{const next={...current,[key]:`${message.receivedDateTime}|${message.bodyPreview}`};try{localStorage.setItem(`mio-dashboard-reviewed:${userId}`,JSON.stringify(next))}catch{/* in-memory review still works */}return next})}
 return {messages,error,loading,refresh,markReviewed}
}
