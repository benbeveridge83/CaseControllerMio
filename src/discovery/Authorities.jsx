import { SOURCE_BY_ID } from './model.js'

export default function Authorities({ ids = [] }) {
  return <div className="disco-authorities">{[...new Set(ids)].map(id => {
    const source = SOURCE_BY_ID[id]
    return source && <div className="disco-authority" key={id}><a href={source.url} target="_blank" rel="noreferrer">{source.label}{source.pinpoint ? `, ${source.pinpoint}` : ''} ↗</a> <span>({source.proposition})</span></div>
  })}</div>
}
