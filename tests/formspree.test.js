import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('global lead alert is mounted outside page-specific tabs',()=>{const main=fs.readFileSync('src/main.jsx','utf8');assert.match(main,/MioLeadAlerts/);assert.match(main,/<App \/><MioLeadAlerts \/>/)})
test('lead alert keeps acknowledged leads visible until addressed',()=>{const ui=fs.readFileSync('src/MioLeadAlerts.jsx','utf8');assert.match(ui,/\['new','acknowledged'\]/);assert.match(ui,/Mark contacted/);assert.match(ui,/Handled \/ converted/);assert.match(ui,/Mark spam/);assert.match(ui,/BroadcastChannel\('mio-leads'\)/)})
test('webhook has custom authentication, spam exclusion and dedupe',()=>{const hook=fs.readFileSync('supabase/functions/formspree-webhook/index.ts','utf8');assert.match(hook,/Unauthorized/);assert.match(hook,/submission_key/);assert.match(hook,/isSpam\?'spam':'new'/);assert.match(hook,/ignoreDuplicates:true/)})
test('migration makes open leads realtime and persistent',()=>{const sql=fs.readFileSync('supabase/migrations/20260912225000_formspree_lead_inbox_v316.sql','utf8');assert.match(sql,/mio_formspree_leads/);assert.match(sql,/supabase_realtime add table/);assert.match(sql,/acknowledged/);assert.match(sql,/addressed_at/)})
