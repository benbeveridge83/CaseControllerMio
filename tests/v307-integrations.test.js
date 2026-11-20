import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('V307 workflow and document-source integration is wired into the build',()=>{
 const vite=fs.readFileSync(new URL('../vite.config.js',import.meta.url),'utf8')
 const plugin=fs.readFileSync(new URL('../mio-v307-dropbox-draft-sources.js',import.meta.url),'utf8')
 const sourceUi=fs.readFileSync(new URL('../src/MioMatterDocumentSources.jsx',import.meta.url),'utf8')
 const proxy=fs.readFileSync(new URL('../api/dropbox-sign.js',import.meta.url),'utf8')
 assert.match(vite,/mioV307DropboxDraftSources/)
 assert.match(plugin,/caseMioMatterDraftFolders/)
 assert.match(plugin,/document_source/)
 assert.match(plugin,/signature_provider/)
 assert.match(plugin,/\/api\/dropbox-sign/)
 assert.match(sourceUi,/OneDrive Draft folder/)
 assert.match(sourceUi,/OneDrive E-file folder/)
 assert.match(sourceUi,/Matter Documents/)
 assert.match(proxy,/DROPBOX_SIGN_API_KEY/)
 assert.match(proxy,/signature_request\/send/)
})
