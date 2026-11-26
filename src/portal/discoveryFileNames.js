// Shared by the portal and server: descriptive names never change file types.
const invalid=message=>Object.assign(new Error(message),{status:400})
export function fileExtension(name){const match=String(name||'').match(/\.([a-z0-9]+)$/i);return match?match[0]:''}
export function fileStem(name){const ext=fileExtension(name);return ext?String(name).slice(0,-ext.length):String(name||'')}
export function descriptiveFilename(name,original){
 const value=String(name||'').trim(),ext=fileExtension(original)
 if(!ext||!value||value.length>180||/[\x00-\x1f/\\]/.test(value))throw invalid('Enter a descriptive file name without slashes, up to 180 characters.')
 // The editor accepts a name without its extension, or the same extension.
 const stem=value.toLowerCase().endsWith(ext.toLowerCase())?value.slice(0,-ext.length).trim():value
 if(!stem||stem==='.'||stem==='..'||(stem+ext).length>180)throw invalid('Enter a descriptive file name, such as Tax return – 2025.')
 return stem+ext
}
export function descriptiveFolder(value){const name=String(value||'').trim();if(!name||name.length>180||/[\x00-\x1f/\\]/.test(name)||['.','..'].includes(name))throw invalid('Enter a folder name, such as Tax returns – 2023 to 2025.');return name}
export function safeRelativePath(value){const path=String(value||'');if(path.length>1000||/[\x00-\x1f\\]/.test(path)||path.split('/').some(p=>!p||p==='.'||p==='..'))throw invalid('This folder path is invalid. Choose the files directly instead.');return path}
