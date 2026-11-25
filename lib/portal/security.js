import {randomBytes,scrypt as cb,timingSafeEqual,createHash} from 'node:crypto'
import {promisify} from 'node:util'
const scrypt=promisify(cb)
export const PORTAL_SENDER='office@beveridgelawfirm.com'
export const PORTAL_ORIGIN='https://case-controller-mio.vercel.app'
export const clean=v=>String(v??'').trim()
export const emailKey=v=>clean(v).toLowerCase()
export const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status})}
export const tokenHash=t=>createHash('sha256').update(String(t)).digest('hex')
export const newToken=()=>randomBytes(32).toString('hex')
export async function hashPassword(p){if(typeof p!=='string'||p.length<12||p.length>256)fail('Use a password between 12 and 256 characters.');const salt=randomBytes(16).toString('hex');return 'scrypt$'+salt+'$'+(await scrypt(p,salt,64)).toString('hex')}
export async function verifyPassword(p,stored=''){const [kind,salt,hex]=stored.split('$');if(kind!=='scrypt'||!/^[a-f0-9]{32}$/.test(salt||'')||!/^[a-f0-9]{128}$/.test(hex||'')||typeof p!=='string'||p.length>256)return false;return timingSafeEqual(await scrypt(p,salt,64),Buffer.from(hex,'hex'))}
export function validateInvitation(i,email){if(!i||i.used_at||i.revoked_at||!(Date.parse(i.expires_at)>Date.now())||emailKey(i.email)!==emailKey(email))fail('Invalid or expired invitation. Ask the firm for a new link.',403)}
export function requirePortalGrant(g,a,m){if(!g||g.revoked_at||!g.accepted_at||g.matter_id!==m?.id||g.client_id!==m?.client_id||emailKey(g.email)!==emailKey(a?.email)||emailKey(m?.clients?.email)!==emailKey(a?.email))fail('You do not have access to this matter.',403)}
export function invoiceForPortal(i){if(!i||!['outstanding','sent','issued','partial','paid','overdue','unpaid','partially_paid'].includes(emailKey(i.status)))return null;const total=Math.max(0,Number(i.total)||0),paid=Math.min(total,Math.max(0,Number(i.amount_paid)||0));return {id:i.id,invoice_number:i.invoice_number,invoice_type:i.invoice_type,issue_date:i.issue_date,due_date:i.due_date,total,amount_paid:paid,balance:Math.round((total-paid)*100)/100,status:i.status,line_items:i.line_items||[]}}
export function safeProviderUrl(value,provider){const u=new URL(value),domains=provider==='boldsign'?['boldsign.com']:['lawpay.com','affinipay.com'];if(u.protocol!=='https:'||!domains.some(d=>u.hostname===d||u.hostname.endsWith('.'+d)))fail('Provider returned an invalid link.',502);return u.toString()}
export function portalPaymentUrl(page,i,c={}){const inv=invoiceForPortal(i);if(!inv||inv.balance<=0)fail('This invoice has no outstanding balance.',409);const u=new URL(safeProviderUrl(page,'lawpay'));for(const [k,v] of Object.entries({amount:inv.balance.toFixed(2),reference:inv.invoice_number,Invoice:inv.invoice_number,readOnlyFields:'amount,reference,Invoice',email:c.email,name:c.name}))if(v)u.searchParams.set(k,v);return u.toString()}

export function portalMailCanSend(t){const scopes=String(t?.scopes||'').split(/\s+/);return scopes.includes('Mail.Send.Shared')||(emailKey(t?.sender_login)===PORTAL_SENDER&&scopes.includes('Mail.Send'))}
export function pendingInvoicePayments(i,rows=[],requests=[]){const normalized=v=>clean(v).toUpperCase(),related=requests.filter(r=>r.matter_id===i.matter_id&&normalized(r.invoice_number)===normalized(i.invoice_number));return rows.filter(t=>{if(!['PENDING','AUTHORIZED','PROCESSING','SCHEDULED'].includes(normalized(t.status)))return false;const raw=t.raw||{};if(raw.mio_matter_id&&raw.mio_matter_id!==i.matter_id)return false;return related.some(r=>clean(raw.mio_payment_request_id)===String(r.id)||!!r.gateway_transaction_id&&r.gateway_transaction_id===t.gateway_transaction_id||!!r.reference&&normalized(r.reference)===normalized(t.reference))||!!i.payment_request_id&&String(raw.mio_payment_request_id)===String(i.payment_request_id)||[raw.mio_invoice_number,raw.invoice_number,t.reference].some(n=>!!n&&normalized(n)===normalized(i.invoice_number))})}

export function isOwnPortalTestMatter(m,staff){return /^test - ben test matter$/i.test(clean(m?.name))&&m?.case_type==='Test'&&String(m?.notes||'').includes('MIO_CLIENT_PORTAL_TEST_V1')&&emailKey(m?.clients?.email)===emailKey(staff?.email)}
export function requireStaffClientAction(action,m,staff){if(['invoice_pdf','agreement_download','agreement_status'].includes(action))return;if(action==='intake_submit'&&isOwnPortalTestMatter(m,staff))return;fail('This staff view cannot submit, sign or pay for the client.',403)}
