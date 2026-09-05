// Mio V284: structural selection/deletion for Word templates.
// This lets users remove whole caption tables/blocks and multi-paragraph ranges instead of only clearing text.
function replaceOnce(code, from, to, label) {
  const first = code.indexOf(from)
  if (first < 0 || code.indexOf(from, first + from.length) >= 0) throw new Error('V284 integration anchor changed: ' + label)
  return code.replace(from, to)
}

export default function mioV284DraftingStructuralDelete() {
  return {
    name: 'mio-v284-drafting-structural-delete',
    enforce: 'pre',
    transform(source, id) {
      const path = id.split('?')[0].replaceAll('\\', '/')
      if (!path.endsWith('/src/App.jsx')) return null
      let code = source

      code = replaceOnce(code, "const MIO_APP_VERSION = 'Mio V283 (withdrawal clarity)'", "const MIO_APP_VERSION = 'Mio V284 (structural template editor)'", 'version')

      const state = "  const [draftingWordBlockInsert, setDraftingWordBlockInsert] = useState({ key: 'caption', alignment: 'center', start_percent: 0, position: 'after' })"
      code = replaceOnce(code, state, state + "\n  const [draftingWordRangeSelection, setDraftingWordRangeSelection] = useState({ anchor: -1, start: -1, end: -1 })", 'range state')

      const toolbar = '  function draftingStudioV275Toolbar() {'
      const helpers = `  function draftingStudioV284SelectionBounds() {
    const start = Number(draftingWordRangeSelection?.start)
    const end = Number(draftingWordRangeSelection?.end)
    if (start >= 0 && end >= 0) return { start: Math.min(start, end), end: Math.max(start, end) }
    const index = draftingStudioV275SelectedParagraphIndex()
    return index >= 0 ? { start: index, end: index } : { start: -1, end: -1 }
  }

  function draftingStudioV284SelectionCount() {
    const range = draftingStudioV284SelectionBounds()
    return range.start < 0 ? 0 : range.end - range.start + 1
  }

  function draftingStudioV284SelectParagraph(event, index) {
    const anchor = Number(draftingWordRangeSelection?.anchor)
    if (event?.shiftKey && anchor >= 0) {
      setDraftingWordRangeSelection({ anchor, start: Math.min(anchor, index), end: Math.max(anchor, index) })
    } else {
      setDraftingWordRangeSelection({ anchor: index, start: index, end: index })
    }
    setDraftingWordEditorParagraphIndex(index)
  }

  function draftingStudioV284ParagraphSelected(index) {
    const range = draftingStudioV284SelectionBounds()
    return range.start >= 0 && index >= range.start && index <= range.end
  }

  function draftingStudioV284ClearSelection() {
    setDraftingWordRangeSelection({ anchor: -1, start: -1, end: -1 })
    setDraftingWordEditorParagraphIndex(-1)
  }

  function draftingStudioV284Ancestor(node, localName, ns) {
    let current = node?.parentNode || null
    while (current) {
      if (current.namespaceURI === ns && current.localName === localName) return current
      current = current.parentNode
    }
    return null
  }

  function draftingStudioV284ContainingStructureLabel(index) {
    const doc = draftingStudioDocument
    if (!doc || index < 0) return ''
    const block = (doc.blocks || []).find((item) => item.type === 'table' && (item.rows || []).some((row) => (row.cells || []).some((cell) => (cell.paragraph_indices || []).includes(index))))
    return block ? 'Word table / caption block' : 'paragraph block'
  }

  async function draftingStudioV284DeleteRange() {
    const range = draftingStudioV284SelectionBounds()
    if (range.start < 0) return alert('Click a paragraph first. Shift-click another paragraph to select a range.')
    const count = range.end - range.start + 1
    if (!window.confirm(count === 1 ? 'Delete this entire Word paragraph, including its spacing?' : 'Delete these ' + count + ' Word paragraphs, including their blank lines and spacing?')) return
    await draftingStudioV275MutateCurrentDocx(({ xmlDoc, paragraphs, ns }) => {
      const selected = []
      for (let index = range.start; index <= range.end; index += 1) if (paragraphs[index]) selected.push(paragraphs[index])
      selected.slice().reverse().forEach((paragraph) => {
        const parent = paragraph.parentNode
        if (parent) parent.removeChild(paragraph)
      })
      // An empty Word table cell still needs one paragraph to remain valid.
      const cells = new Set(selected.map((paragraph) => draftingStudioV284Ancestor(paragraph, 'tc', ns)).filter(Boolean))
      cells.forEach((cell) => {
        const hasParagraph = Array.from(cell.getElementsByTagNameNS(ns, 'p')).length > 0
        if (!hasParagraph) cell.appendChild(xmlDoc.createElementNS(ns, 'w:p'))
      })
    }, count === 1 ? 'Deleted paragraph and spacing' : 'Deleted ' + count + ' paragraphs and spacing')
    draftingStudioV284ClearSelection()
  }

  async function draftingStudioV284DeleteContainingBlock() {
    const index = draftingStudioV275SelectedParagraphIndex()
    if (index < 0) return alert('Click anywhere inside the caption/table/block you want to remove first.')
    const label = draftingStudioV284ContainingStructureLabel(index)
    if (!window.confirm('Delete the entire ' + label + '? This removes the structure itself, not just its text.')) return
    await draftingStudioV275MutateCurrentDocx(({ paragraphs, ns }) => {
      const paragraph = paragraphs[index]
      if (!paragraph) throw new Error('Mio could not find the selected paragraph.')
      const table = draftingStudioV284Ancestor(paragraph, 'tbl', ns)
      if (table?.parentNode) {
        table.parentNode.removeChild(table)
        return
      }
      if (paragraph.parentNode) paragraph.parentNode.removeChild(paragraph)
    }, 'Deleted entire ' + label)
    draftingStudioV284ClearSelection()
  }

`
      if (!code.includes(toolbar)) throw new Error('V284 integration anchor changed: toolbar')
      code = code.replace(toolbar, helpers + toolbar)

      code = replaceOnce(
        code,
        'onClick={() => setDraftingWordEditorParagraphIndex(paragraph.index)}',
        'onClick={(event) => draftingStudioV284SelectParagraph(event, paragraph.index)}',
        'paragraph click handler'
      )
      code = replaceOnce(
        code,
        "boxShadow: draftingWordEditorParagraphIndex === paragraph.index ? 'inset 0 0 0 1px #2563eb' : style.boxShadow",
        "boxShadow: draftingStudioV284ParagraphSelected(paragraph.index) ? 'inset 0 0 0 2px #2563eb' : style.boxShadow, background: draftingStudioV284ParagraphSelected(paragraph.index) ? '#dbeafe' : style.background",
        'selection highlight'
      )

      code = replaceOnce(
        code,
        "<span style={{ fontSize: 11, color: '#64748b' }}>{selected >= 0 ? 'Paragraph ' + (selected + 1) + ' selected' : 'Click a paragraph to edit'}</span>",
        "<span style={{ fontSize: 11, color: '#64748b' }}>{draftingStudioV284SelectionCount() > 1 ? draftingStudioV284SelectionCount() + ' paragraphs selected' : selected >= 0 ? 'Paragraph ' + (selected + 1) + ' selected' : 'Click a paragraph to edit'} — Shift-click another paragraph to select a range.</span>",
        'selection status'
      )
      code = replaceOnce(
        code,
        '<button type="button" onClick={draftingStudioV275DeleteParagraph} style={{ color: \'#991b1b\' }}>Delete paragraph</button>',
        `<button type="button" onClick={draftingStudioV284DeleteRange} style={{ color: '#991b1b' }}>{draftingStudioV284SelectionCount() > 1 ? 'Delete selected paragraphs (' + draftingStudioV284SelectionCount() + ')' : 'Delete paragraph + spacing'}</button><button type="button" onClick={draftingStudioV284DeleteContainingBlock} disabled={selected < 0} style={{ color: '#991b1b', fontWeight: 900 }}>Delete whole table / block</button>`,
        'structural delete controls'
      )

      return { code, map: null }
    }
  }
}
