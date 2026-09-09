function once(code,from,to,label){if(code.split(from).length!==2)throw new Error('V312 Discovery anchor changed: '+label);return code.replace(from,()=>to)}
export default function discoveryCompact(){return{name:'mio-v312-discovery',enforce:'pre',transform(source,id){
 if(!id.split('?')[0].replaceAll('\\','/').endsWith('/src/App.jsx'))return null
 let code="import './mioDiscoveryCompact.css'\n"+source
 code=once(code,"    const key = discoverySort.key || 'response_due'\n    return [...rows].sort((a, b) => {",`    const key = discoverySort.key || 'response_due'
    const dateKey=key==='days_until_response_due'?'response_due':key
    const dateColumns=['trial','thirtyBeforeTrial','request_served','sent_to_c','response_due','mediation_document_exchange']
    return [...rows].sort((a, b) => {
      if(dateColumns.includes(dateKey)){
        const missingA=!a[dateKey]||!Number.isFinite(Date.parse(a[dateKey])),missingB=!b[dateKey]||!Number.isFinite(Date.parse(b[dateKey]))
        if(missingA!==missingB)return missingA?1:-1
        if(missingA&&missingB)return 0
      }`,'undated rows last both directions')
 code=once(code,'<div style={{ width: 2200, height: 1 }} />','<div style={{ width: \'100%\', minWidth: 1260, height: 1 }} />','responsive scrollbar')
 code=once(code,'<table cellPadding="7" style={{ borderCollapse: \'collapse\', width: \'max-content\', minWidth: 2200 }}>','<table cellPadding="5" className="mio-discovery-compact">','responsive table')
 code=once(code,'<DiscoverySortableHeader sortKey="documentTitle">Request document</DiscoverySortableHeader>','<DiscoverySortableHeader sortKey="documentTitle">Doc</DiscoverySortableHeader>','compact header')
 code=once(code,`                      <td style={{ minWidth: 260 }}>
                        {row.document ? (
                          <button type="button" onClick={() => openDocumentEditWindow(row.document)} style={{ textAlign: 'left' }} title="Open edit document window">{row.documentTitle}</button>
                        ) : (
                          <span title="Recovered from saved Discovery Table row; no linked document record was found.">{row.documentTitle}</span>
                        )}
                      </td>`,`                      <td>
                        <button type="button" className="mio-doc-link" disabled={!row.document} onClick={() => openDocumentEditWindow(row.document)} title={row.documentTitle+(row.document?' - Open edit document':' - No linked document; recovered tracking row')}>Doc</button>
                      </td>`,'Doc opens document editor')
 return{code,map:null}
}}}
