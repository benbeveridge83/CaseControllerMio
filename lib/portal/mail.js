import {createClient} from '@supabase/supabase-js'
import {PUBLIC_SUPABASE_URL} from '../../src/mioSupabasePublic.js'
import {buildAuthorizationUrl,refreshAccessToken} from '../paralegal/microsoft/oauth.js'
import {signOAuthState} from '../paralegal/microsoft/state.js'
import {graphRequest} from '../paralegal/microsoft/graph.js'
import {PORTAL_SENDER,PORTAL_ORIGIN,fail,portalMailCanSend,emailKey} from './security.js'
const mailError=(message,code,status=503)=>Object.assign(new Error(message),{code,status})
export function portalMailFailure(error){
 if(String(error?.code||'').startsWith('PORTAL_MAIL_'))return error
 const code=String(error?.body?.error?.code||error?.code||'')
 if(code==='invalid_client'||/AADSTS7000215|AADSTS7000222/.test(String(error?.message||'')))return mailError('Mio’s Microsoft application secret is invalid or expired. Update MICROSOFT_CLIENT_SECRET in Vercel with the secret Value from the Microsoft app registration, then redeploy. Reconnecting alone will not fix this.','PORTAL_MAIL_CONFIG')
 if(code==='ErrorSendAsDenied'||code==='ErrorAccessDenied'||error?.statusCode===403)return mailError('Microsoft did not allow sending as '+PORTAL_SENDER+'. Ask your Microsoft 365 administrator to grant your signed-in account Send As permission for that mailbox, then resend.','PORTAL_MAIL_SEND_AS')
 if(error?.statusCode===401||['invalid_grant','interaction_required','MS_AUTH_NO_REFRESH'].includes(code))return mailError('Your Microsoft email connection needs to be renewed. Click Reconnect office email and sign in with your firm account, then resend.','PORTAL_MAIL_RECONNECT')
 return mailError('Microsoft could not accept the email from '+PORTAL_SENDER+'. Reconnect office email and try again.','PORTAL_MAIL_UPSTREAM',502)
}
export function portalMailAuthorization(user,env=process.env){
 const state=signOAuthState({userId:user.id,accountEmail:PORTAL_SENDER,portal:true,expiresAt:Date.now()+600000},env.MICROSOFT_OAUTH_STATE_SECRET)
 const url=new URL(buildAuthorizationUrl({clientId:env.MICROSOFT_CLIENT_ID,redirectUri:env.MICROSOFT_REDIRECT_URI,tenant:env.MICROSOFT_TENANT||'organizations',scopes:['openid','profile','email','offline_access','User.Read','Mail.Send','Mail.Send.Shared'],state,loginHint:user.email}))
 url.searchParams.set('prompt','select_account')
 return url.toString()
}
export function portalMailStatus(token){return {connected:portalMailCanSend(token)&&!!(token?.refresh_token||token?.access_token&&Date.parse(token?.expires_at)>Date.now()),sender:PORTAL_SENDER,sender_login:token?.sender_login||'',reason:!token?'not_connected':!portalMailCanSend(token)?'sending_permission_missing':!(token.refresh_token||token.access_token&&Date.parse(token.expires_at)>Date.now())?'sign_in_required':''}}
export function createPortalMailer({db:providedDb,env=process.env,refresh=refreshAccessToken,graph=graphRequest}={}){
 function database(){if(providedDb)return providedDb;if(!env.SUPABASE_SERVICE_ROLE_KEY)throw mailError('Portal email server configuration is missing.','PORTAL_MAIL_CONFIG');return createClient(env.SUPABASE_URL||PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})}
 async function load(staffId){const {data,error}=await database().from('mio_portal_mail_tokens').select('*').eq('user_id',staffId).maybeSingle();if(error)throw error;return data}
 async function saveToken(userId,token,senderLogin){
  const login=emailKey(senderLogin)
  if(!login.endsWith('@beveridgelawfirm.com'))throw mailError('Choose your Beveridge Law Firm Microsoft work account when connecting office email.','PORTAL_MAIL_WRONG_ACCOUNT')
  if(!token.access_token||!portalMailCanSend({scopes:token.scope,sender_login:login}))throw mailError('Microsoft did not grant office-email sending permission. Reconnect and allow Mail.Send.Shared.','PORTAL_MAIL_SCOPE')
  const prior=token.refresh_token?null:await load(userId)
  const {error}=await database().from('mio_portal_mail_tokens').upsert({user_id:userId,sender_login:login,access_token:token.access_token,refresh_token:token.refresh_token||prior?.refresh_token||null,scopes:token.scope||'',expires_at:new Date(Date.now()+Number(token.expires_in||3600)*1000).toISOString()});if(error)throw error
 }
 async function officeToken(staffId){
  const token=await load(staffId);if(!token)return null
  if(!portalMailCanSend(token))throw mailError('Reconnect office email and allow shared-mailbox sending permission.','PORTAL_MAIL_SCOPE')
  if(!(Date.parse(token.expires_at)>Date.now()+60000)){
   try{const next=await refresh({clientId:env.MICROSOFT_CLIENT_ID,clientSecret:env.MICROSOFT_CLIENT_SECRET,tenant:env.MICROSOFT_TENANT,refreshToken:token.refresh_token});next.refresh_token||=token.refresh_token;next.scope||=token.scopes;await saveToken(staffId,next,token.sender_login);return next.access_token}catch(error){throw portalMailFailure(error)}
  }
  return token.access_token
 }
 async function sendEmail({staffId,email,link,reset=false,intakeTitle,graphToken}){
  if(!link.startsWith(PORTAL_ORIGIN+'/'))fail('Invalid portal email link.',500)
  const accessToken=await officeToken(staffId)||graphToken
  if(!accessToken)throw mailError('Office email is not connected. Click Connect office email, sign in with your firm Microsoft account, and then resend the invitation. Emails will still come from '+PORTAL_SENDER+'.','PORTAL_MAIL_NOT_CONNECTED')
  const content=intakeTitle?'Please complete your assigned intake form, '+intakeTitle+', in your Beveridge Law Firm client portal. Sign in using '+email+' and open Intake:\n\n'+link+'\n\nIf you have not created your password, use your separate portal invitation email first. Your answers will be reviewed by the firm before they are added to your case file.':reset?'A password reset was requested for your Beveridge Law Firm client portal. Open this link to choose a new password:\n\n'+link+'\n\nThis link expires in one hour. If you did not request this, you may ignore it.':'You are invited to the Beveridge Law Firm client portal. Your username is '+email+'. Open this link to create your password, or sign in with your existing portal account:\n\n'+link+'\n\nUse the portal to respond to assigned discovery, complete forms, and work with your attorney. This invitation expires in seven days.'
  try{
   // Sending through the signed-in mailbox needs Send As, without requiring
   // the additional Full Access permission of /users/shared-mailbox/sendMail.
   const result=await graph({accessToken,path:'/me/sendMail',method:'POST',body:{message:{subject:intakeTitle?'Please complete your client intake form':reset?'Reset your client portal password':'Your Beveridge Law Firm client portal invitation',from:{emailAddress:{address:PORTAL_SENDER}},toRecipients:[{emailAddress:{address:email}}],body:{contentType:'Text',content}},saveToSentItems:true}})
   if(result.status!==202)throw mailError('Microsoft did not confirm accepting the email. Refresh the connection before resending.','PORTAL_MAIL_UNCONFIRMED',502)
   return {accepted:true,sender:PORTAL_SENDER}
  }catch(error){throw portalMailFailure(error)}
 }
 return {saveToken,sendEmail}
}
export const savePortalMailToken=(...args)=>createPortalMailer().saveToken(...args)
export const sendPortalEmail=(...args)=>createPortalMailer().sendEmail(...args)
