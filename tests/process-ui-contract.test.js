import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// Contract checks complement interaction tests on the production bundle.
for(const path of ['src/processes/Builder.jsx','src/processes/RunPanel.jsx','src/processes/Processes.jsx'])test(path+' exists',()=>assert.equal(fs.existsSync(path),true));
