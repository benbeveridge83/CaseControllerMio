import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {applyAdsWorkspace} from '../mio-v317-ads-workspace.js'
const source=fs.readFileSync(new URL('../src/App.jsx',import.meta.url),'utf8')
test('exactly two panes replaced, history added and plugin is idempotent',()=>{const r=applyAdsWorkspace(source);assert.equal((r.match(/<MioAdsWorkspace mode=/g)||[]).length,2);assert.equal((r.match(/<WorkspaceHistory api=/g)||[]).length,1);assert.equal(applyAdsWorkspace(r),r);assert.ok(r.includes("googleAdsTab === 'campaigns'"))})
test('missing UI anchor fails build instead of shipping partially',()=>assert.throws(()=>applyAdsWorkspace('missing'),/anchors/))
test('legacy DOM enhancer removed while Formspree alerts retained',()=>{const s=fs.readFileSync(new URL('../src/main.jsx',import.meta.url),'utf8');assert.doesNotMatch(s,/MioGoogleAdsSearchTermStatus/);assert.match(s,/MioLeadAlerts/)})
