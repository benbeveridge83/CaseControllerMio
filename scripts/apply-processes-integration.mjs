import fs from 'node:fs';
const file='vite.config.js';let text=fs.readFileSync(file,'utf8');
if(!text.includes("from './mio-v314-processes.js'")){
 const anchor="import pncDailyTrust from './mio-v313-pnc-daily-trust.js'";
 if(text.split(anchor).length!==2)throw Error('Unexpected Vite import anchor');
 text=text.replace(anchor,anchor+"\nimport mioProcesses from './mio-v314-processes.js'");
 const plugins='pncDailyTrust(), react()';
 if(text.split(plugins).length!==2)throw Error('Unexpected Vite plugin order');
 text=text.replace(plugins,'pncDailyTrust(), mioProcesses(), react()');
 fs.writeFileSync(file,text);
}
if(!text.includes('pncDailyTrust(), mioProcesses(), react()'))throw Error('V314 plugin must run after existing transformations and before React.');
console.log('V314 integration registered.');
