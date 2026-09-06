import assert from 'node:assert/strict'
import fs from 'node:fs'
import JSZip from 'jszip'

export async function runWordExportCheck({context,open,getPage,states,matterId,errors,dialogs}) {
  await context.close()
  const values={cause_number:'NEW-001',client_address_override:'202 Replacement Avenue',client_name:'Replacement Client',client_phone:'555-0200',client_email:'new@example.invalid',petitioner_name:'Petitioner Test',respondent_name:'Respondent Test',children:[{name:'Child Alpha'},{name:'Child Beta'}],children_names:'Child Alpha; Child Beta',court_name:'300th Judicial District Court',county:'Brazoria',case_style_id:'@divorce',attorney_signature_block:'/s/ Test Attorney\nTest Firm'}
  states.set('caseMioDraftingSessionV278',{key:'caseMioDraftingSessionV278',raw_value:JSON.stringify({matter_id:matterId,template_id:'template-safe',selected_file_names:['word-a'],field_values:values}),updated_at:new Date().toISOString()})
  await open('drafting')
  const page=getPage()
  // Optional document settings are collapsed; wait for the actual export action instead.
  const generate=page.getByRole('button',{name:/^Generate \d+ Word Document/})
  await generate.waitFor({timeout:30000})
  await page.evaluate(()=>{window.__docxResults=[]})
  await generate.click()
  await page.waitForFunction(()=>window.__docxResults?.length>0,undefined,{timeout:45000})
  const result=Buffer.from(await page.evaluate(()=>window.__docxResults.at(-1)),'base64')
  const output=await JSZip.loadAsync(result),generated=await output.file('word/document.xml').async('string')
  fs.writeFileSync('test-results/mio-synthetic-generated.docx',result)
  fs.writeFileSync('test-results/mio-synthetic-generated.xml',generated)
  const ns='http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const check=await page.evaluate(({xml,ns})=>{
    const d=new DOMParser().parseFromString(xml,'application/xml'),tables=[...d.getElementsByTagNameNS(ns,'tbl')]
    return {invalid:d.getElementsByTagName('parsererror').length,tables:tables.map(t=>[...t.getElementsByTagNameNS(ns,'tc')].map(c=>c.textContent)),text:[...d.getElementsByTagNameNS(ns,'t')].map(t=>t.textContent).join(' '),notices:[...d.getElementsByTagNameNS(ns,'p')].filter(p=>p.textContent.replace(/\s/g,'').includes('NOTICE:THISDOCUMENTCONTAINSSENSITIVEDATA')).length}
  },{xml:generated,ns})
  assert.equal(check.invalid,0)
  assert.equal(check.tables[0].length,3)
  assert.match(check.tables[0][1],/\u00a7/)
  assert.match(check.tables[0][2],/300TH JUDICIAL DISTRICT/)
  assert.match(check.tables[0][2],/BRAZORIA COUNTY, TEXAS/)
  assert.equal(check.notices,1)
  assert.match(check.tables[0][0],/PETITIONER TEST/)
  assert.match(check.tables[0][0],/RESPONDENT TEST/)
  assert.match(check.tables[0][0],/Child Alpha/)
  assert.match(check.tables[0][0],/Child Beta/)
  assert.match(check.text,/202 Replacement Avenue/)
  assert.doesNotMatch(check.text,/101 Sample|OLD-001|old@example.invalid|\[\[MIO_BLOCK:/)
  assert.match(generated,/w:val="both"/)
  assert.equal(check.tables.at(-1).length,2)
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[])
  assert.deepEqual(await page.evaluate(()=>window.__appDiskWrites),[])
  console.log('PASS: real generated DOCX contains updated field values and a three-column caption with parties, children, section marks, court and county; original paragraph/table formatting preserved; one notice; no browser errors')
}
