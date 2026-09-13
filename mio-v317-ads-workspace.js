// Checked integration into the existing App. No DOM observers or click timers.
export function applyAdsWorkspace(source){
 if(source.includes('/* MIO_AD_WORKSPACE_V317 */'))return source
 let ads=0,terms=0,history=0
 let code=source.split('\n').map(line=>{
  if(line.includes("{googleAdsReport && googleAdsTab === 'ads' && <section")){ads++;return '        {googleAdsReport && googleAdsTab === \'ads\' && <MioAdsWorkspace mode="ads" report={report} api={workspaceApi} onRefresh={() => loadGoogleAdsReport(googleAdsDays)} writeMode={writeMode} queueMutation={queueGoogleAdsMutation} classify={googleAdsSearchTermIntent} />}'}
  if(line.includes("{googleAdsReport && googleAdsTab === 'search_terms' && <section")){terms++;return '        {googleAdsReport && googleAdsTab === \'search_terms\' && <MioAdsWorkspace mode="search_terms" report={report} api={workspaceApi} onRefresh={() => loadGoogleAdsReport(googleAdsDays)} writeMode={writeMode} queueMutation={queueGoogleAdsMutation} classify={googleAdsSearchTermIntent} />}'}
  if(line.includes("{googleAdsReport && googleAdsTab === 'change_log' && <section")){history++;return '        {googleAdsReport && googleAdsTab === \'change_log\' && <WorkspaceHistory api={workspaceApi} />}\n'+line}
  return line
 }).join('\n')
 if(ads!==1||terms!==1||history!==1)throw new Error(`Ad workspace anchors changed (${ads}/${terms}/${history}); refusing a partial installation.`)
 code=code.replaceAll('Mio V314 (finance review + payment audit)','Mio V317 (ad workspace + bulk review)')
 return "/* MIO_AD_WORKSPACE_V317 */\nimport MioAdsWorkspace, { WorkspaceHistory } from './ads/Workspace.jsx'\nimport { workspaceApi } from './ads/client.js'\n"+code
}
export default function adsWorkspace(){return{name:'mio-v317-ads-workspace',enforce:'pre',transform(source,id){if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return{code:applyAdsWorkspace(source),map:null}}}}
