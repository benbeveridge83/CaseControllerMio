import {readFileSync,writeFileSync} from 'node:fs'

const path='src/App.jsx'
let source=readFileSync(path,'utf8')
if (source.includes("import ParalegalPanel from './paralegal/ParalegalPanel.jsx'")) {
  console.log('Paralegal panel is already integrated in App.jsx')
  process.exit(0)
}
const importNeedle="import React, { Fragment, useEffect, useMemo, useRef, useState } from 'react'\n"
const functionNeedle="  function checklistWorkspaceContextForEvent(event = {}) {\n"
const renderNeedle="            <div style={{ display:'flex', gap:6, marginBottom:12, borderBottom:'1px solid #cbd5e1' }}><button type=\"button\" onClick={()=>setNeedToSetPageTab('current')}"
for (const needle of [importNeedle,functionNeedle,renderNeedle]) {
  if (!source.includes(needle)) throw new Error('App.jsx integration anchor was not found; refusing to modify the file.')
}
const snapshotFunction=`  function needToSetParalegalSnapshot() {\n    return filteredChecklistEvents('need_date').map((event) => {\n      const matter = checklistMatterForEvent(event) || {}\n      const status = currentNeedToSetStatus(event)\n      const record = settingCenterRecord(event)\n      return {\n        id: checklistNeedToSetRowId(event),\n        matterId: matter.id || event.matter_id || '',\n        matterName: checklistMatterLabel(event),\n        clientName: matterClientName(matter),\n        category: checklistEventCategoryLabel(event),\n        stage: settingCenterStageLabel(record.stage),\n        waitingOn: record.waiting_on || 'You',\n        currentStep: status.stepName,\n        latestUpdate: record.latest_update || '',\n        nextAction: settingCenterStageLabel(record.stage),\n        ageDays: status.rowDays,\n        hasNewEmail: needToSetEventHasNewEmail(event)\n      }\n    })\n  }\n\n`
source=source.replace(importNeedle,importNeedle+"import ParalegalPanel from './paralegal/ParalegalPanel.jsx'\n")
source=source.replace(functionNeedle,snapshotFunction+functionNeedle)
source=source.replace(renderNeedle,"            <ParalegalPanel getSnapshot={needToSetParalegalSnapshot} />\n"+renderNeedle)
writeFileSync(path,source)
console.log('Integrated Paralegal panel into Need to Set.')
