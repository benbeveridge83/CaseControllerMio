export function openPortalDownload(result){
 if(result.url){window.open(result.url,'_blank','noopener,noreferrer');return}
 if(!result.file_base64)throw new Error('The file download could not be prepared.')
 const bytes=Uint8Array.from(atob(result.file_base64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:result.content_type})),a=document.createElement('a');a.href=url;a.download=result.filename||'Discovery-document';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000)
}
