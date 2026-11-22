import {createEmailTokenStore} from '../email/tokenStore.js'
import {usableEmailToken} from '../email/connection.js'
import {createMicrosoftTokenStore} from '../paralegal/microsoft/tokenStore.js'
import {refreshAccessToken,normalizeTokenResponse} from '../paralegal/microsoft/oauth.js'
import {graphRequest} from '../paralegal/microsoft/graph.js'
import {PORTAL_SENDER,PORTAL_ORIGIN,fail} from './security.js'
export async function sendPortalEmail({staffId,email,link,reset=false,graphToken}){
 let accessToken=graphToken
 if(!accessToken){
  const connected=await usableEmailToken(createEmailTokenStore(),staffId,PORTAL_SENDER)
  accessToken=connected?.accessToken
  if(!accessToken){
   const store=createMicrosoftTokenStore();let t=await store.load(staffId)
   if(t&&(!t.expiresAt||Date.parse(t.expiresAt)<Date.now()+60000)){const r=await refreshAccessToken({clientId:process.env.MICROSOFT_CLIENT_ID,clientSecret:process.env.MICROSOFT_CLIENT_SECRET,tenant:process.env.MICROSOFT_TENANT,refreshToken:t.refreshToken});t={...normalizeTokenResponse(r),refreshToken:r.refresh_token||t.refreshToken};await store.save(staffId,t)}
   accessToken=t?.accessToken
  }
 }
 if(!accessToken)fail('Connect office email in Client Portal, then resend.',503)
 if(!link.startsWith(PORTAL_ORIGIN+'/'))fail('Invalid portal email link.',500)
 const content=reset?'A password reset was requested for your Beveridge Law Firm client portal. Open this link to choose a new password:\n\n'+link+'\n\nThe link expires in one hour. If you did not request this, you may ignore it.':'You are invited to the Beveridge Law Firm client portal. Your username is '+email+'. Open this link to create your password, or sign in with your existing portal account:\n\n'+link+'\n\nThe portal provides your fee agreement, assigned intake forms and invoices. This invitation expires in seven days.'
 await graphRequest({accessToken,path:'/users/'+encodeURIComponent(PORTAL_SENDER)+'/sendMail',method:'POST',body:{message:{subject:reset?'Reset your client portal password':'Your Beveridge Law Firm client portal invitation',from:{emailAddress:{address:PORTAL_SENDER}},toRecipients:[{emailAddress:{address:email}}],body:{contentType:'Text',content}},saveToSentItems:true}})
}
