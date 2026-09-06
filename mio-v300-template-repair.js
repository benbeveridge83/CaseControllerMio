// Source fragments are read literally. Regex backslashes never pass through a cooked template string.
import fs from 'node:fs'
const fragment=fs.readFileSync(new URL('./src/mioTemplateEditor.fragment.jsx',import.meta.url),'utf8')
function once(code,from,to){if(code.split(from).length!==2)throw new Error('V300 integration anchor changed: '+from.slice(0,100));return code.replace(from,()=>to)}
export default function mioV300TemplateRepair(){
 return {name:'mio-v300-template-repair',enforce:'pre',transform(source,id){
  const path=id.split('?')[0].replaceAll('\\','/')
  let code=source
  if(path.endsWith('/src/mioDraftingComponents.js')){
   code="import { applySensitiveNoticeSafe as mioSensitiveNoticeV300 } from './mioCaptionTable.js'\n"+code
   const start=code.indexOf('function applySensitiveNotice(doc, body, setup) {'),end=code.indexOf('\n// Only explicit instance changes',start)
   const close=code.indexOf('\n}\n',start)
   if(start<0||close<start||end<close)throw new Error('V300 notice function moved')
   code=code.slice(0,start)+'function applySensitiveNotice(doc, body, setup) { return mioSensitiveNoticeV300(doc,body,setup) }'+code.slice(close+2)
   return {code,map:null}
  }
  if(!path.endsWith('/src/App.jsx'))return null
  code="import { TemplateParagraph as MioTemplateParagraphV300 } from './MioTemplateFieldPreview.jsx'\nimport { blockKey as mioBlockKeyV300, fieldKey as mioFieldKeyV300, validFieldSource as mioValidFieldSourceV300, activeFileBindings as mioActiveBindingsV300, locateBinding as mioLocateBindingV300, paragraphFields as mioParagraphFieldsV300, bindingSignature as mioBindingSignatureV300, captureTemplateSelection as mioCaptureSelectionV300, replaceInParagraph as mioReplacePreviewTextV300 } from './mioTemplateFields.js'\nimport { expandCaptionMarkers as mioExpandCaptionV300, wordText as mioWordTextV300, replaceWordRange as mioReplaceWordRangeV300 } from './mioCaptionTable.js'\n"+code
  code=once(code,"const MIO_APP_VERSION = 'Mio V295 (stable drafting field anchors)'","const MIO_APP_VERSION = 'Mio V300 (verified template fields)'")
  const state="  const [draftingSourcePickerTarget, setDraftingSourcePickerTarget] = useState({ kind: 'binding', field_id: '', value: 'manual' })"
  code=once(code,state,state+"\n  const [mioFieldSelectorV300,setMioFieldSelectorV300]=useState(false)\n  const [mioTemplateSaveV300,setMioTemplateSaveV300]=useState('')\n  const mioQuickSelectionV300=useRef(null),mioJustSelectedV300=useRef(false),mioTemplateSaveSerialV300=useRef(0),mioTemplatesRefV300=useRef(draftingTemplates)\n  mioTemplatesRefV300.current=draftingTemplates")
  code=once(code,'  function draftingStudioCommitBinding(rawBinding, options = {}) {','  function draftingStudioCommitBindingLegacyV300(rawBinding, options = {}) {')
  code=once(code,'  function draftingV276ChooseSource(value) {','  function draftingV276ChooseSourceLegacyV300(value) {')
  code=once(code,'  function renderDraftingVisualBuilder() {',fragment+'\n  function renderDraftingVisualBuilder() {')
  const sourceStart=code.indexOf('source: DRAFTING_FIELD_SOURCE_OPTIONS.some('),sourceEnd=code.indexOf('\n',sourceStart)
  if(sourceStart<0||!code.slice(sourceStart,sourceEnd).includes('field.source'))throw new Error('V300 source normalization moved')
  code=code.slice(0,sourceStart)+"source: mioValidFieldSourceV300(field.source) ? field.source : 'manual',"+code.slice(sourceEnd)
  code=once(code,'{renderDraftingStudioHighlightedText(paragraph, template)}','{mioTemplatePreviewV300(paragraph, template)}')
  code=once(code,'contentEditable={draftingWordEditorEnabled && !paragraph.hidden}','contentEditable={draftingWordEditorEnabled && !paragraph.hidden && !mioTemplateControlsV300(paragraph,template)}')
  code=once(code,"if (!draftingWordEditorEnabled) return; const nextText", "if (!draftingWordEditorEnabled || mioTemplateControlsV300(paragraph,template)) return; const nextText")
  code=once(code,'onMouseUp={(event) => draftingStudioCaptureSelection(event, paragraph.index)}','onMouseUp={(event) => mioCaptureFieldV300(event, paragraph.index)}')
  code=once(code,'onClick={(event) => draftingStudioV284SelectParagraph(event, paragraph.index)}','onClick={(event) => mioSelectParagraphV300(event, paragraph.index)}')
  code=once(code,'{draftingStudioV275Toolbar()}{draftingStudioV281BlockPanel()}','{mioTemplateToolbarV300()}{draftingStudioV275Toolbar()}{draftingStudioV281BlockPanel()}')
  code=once(code,'onClick={draftingEditingBindingId ? mioSaveBindingEditV293 : draftingStudioAddBindingFromSelection}','onClick={draftingEditingBindingId ? mioSaveFieldEditV300 : draftingStudioAddBindingFromSelection}')
  code=once(code,'onClick={() => mioEditBindingV293(binding)}','onClick={() => mioEditFieldV300(binding)}')
  const visual=code.indexOf('  function renderDraftingVisualBuilder() {')
  const outline=code.indexOf('>{section.name}</button>',visual)
  if(outline<0)throw new Error('V300 outline moved')
  code=code.slice(0,outline)+code.slice(outline).replace('>{section.name}</button>','>{mioOutlineFieldLabelV300(section,template)}</button>')
  const at=code.indexOf('    const safeTemplates ='),start=code.lastIndexOf('  useEffect(() => {',at),tail='  }, [draftingTemplates])',end=code.indexOf(tail,at)
  if(at<0||start<0||end<at||end-at>700||!code.slice(at,end).includes('caseMioDraftingTemplates'))throw new Error('V300 template save effect moved')
  code=code.slice(0,start)+'  useEffect(() => { void mioPersistTemplatesV300() }, [draftingTemplates,mioCloudHydrationDone])'+code.slice(end+tail.length)
  code=once(code,'    draftingApplyVisualBindings(xmlDoc, data, template, templateFile, xmlPath)','    const remainingBindingsV300 = mioApplyScalarBindingsV300(xmlDoc,data,template,templateFile,xmlPath)\n    draftingApplyVisualBindings(xmlDoc, data, remainingBindingsV300, templateFile, xmlPath)\n    if (xmlPath === \'word/document.xml\') mioExpandCaptionV300(xmlDoc,data,draftingProfile)')
  return {code,map:null}
 }}
}
