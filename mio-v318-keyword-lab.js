// Checked source integration: preserve V317 Ads and history, replace the two legacy panes.
export function applyKeywordLab(source){
 if(source.includes('/* MIO_KEYWORD_LAB_V318 */'))return source
 let terms=0,keywords=0
 let code=source.split('\n').map(line=>{
  if(line.includes("googleAdsTab === 'search_terms' && <MioAdsWorkspace")){terms++;return '        {googleAdsReport && googleAdsTab === \'keyword_lab\' && <KeywordLab report={report} api={workspaceApi} writeMode={writeMode} />}'}
  if(line.includes("googleAdsTab === 'keywords' && <section")){keywords++;return ''}
  return line
 }).join('\n')
 const nav="['search_terms', 'Search Terms'], ['keywords', 'Keywords']"
 if(terms!==1||keywords!==1||!code.includes(nav))throw new Error('Keyword Lab anchors changed; refusing partial integration.')
 code=code.replace(nav,"['keyword_lab', 'Keyword Lab']")
 return "/* MIO_KEYWORD_LAB_V318 */\nimport KeywordLab from './ads/KeywordLab.jsx'\n"+code
}
export default function keywordLab(){return{name:'mio-v318-keyword-lab',enforce:'pre',transform(source,id){if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return{code:applyKeywordLab(source),map:null}}}}
