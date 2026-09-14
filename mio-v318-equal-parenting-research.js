const MARKER='/* MIO_EQUAL_PARENTING_RESEARCH_V318 */'
const NAV_ANCHOR="{canOpenPage('google_ads') && ("
const RENDER_ANCHOR="{page === 'withdrawals' && canOpenPage('withdrawals') && renderWithdrawalsPage()}"

function count(source,needle){return source.split(needle).length-1}

export function applyEqualParentingResearch(source){
 if(source.includes(MARKER))return source
 const navCount=count(source,NAV_ANCHOR),renderCount=count(source,RENDER_ANCHOR)
 if(navCount!==1||renderCount!==1)throw new Error(`Equal Parenting Research integration anchors changed (${navCount}/${renderCount}); refusing a partial installation.`)
 const nav=`{session?.user?.id && (\n          <a href="#equal_parenting_research" onClick={(e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button !== 0) return; e.preventDefault(); setPage('equal_parenting_research') }} style={{ display: 'block', marginBottom: 10, fontWeight: page === 'equal_parenting_research' ? 900 : undefined }}>Equal Parenting Research</a>\n        )}\n        ${NAV_ANCHOR}`
 const render=`{page === 'equal_parenting_research' && <MioResearchWorkspace session={session} supabase={supabase} enabled={true} />}\n        ${RENDER_ANCHOR}`
 let code=source.replace(NAV_ANCHOR,nav).replace(RENDER_ANCHOR,render)
 code=`${MARKER}\nimport MioResearchWorkspace from './MioResearchWorkspace.jsx'\n`+code
 return code
}

export default function equalParentingResearch(){
 return{name:'mio-v318-equal-parenting-research',enforce:'pre',transform(source,id){const path=id.split('?')[0].replaceAll('\\','/');if(!path.endsWith('/src/App.jsx'))return null;return{code:applyEqualParentingResearch(source),map:null}}}
}
