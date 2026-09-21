import {defineConfig} from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({plugins:[react(),{name:'process-test-store',configureServer(server){let records=[];server.middlewares.use('/test-store',(req,res)=>{res.setHeader('content-type','application/json');if(req.method==='POST'){let body='';req.on('data',chunk=>{body+=chunk});req.on('end',()=>{try{records=JSON.parse(body);res.end(JSON.stringify(records))}catch{res.statusCode=400;res.end('{}')}})}else res.end(JSON.stringify(records))})}}],server:{host:'127.0.0.1',port:4175,strictPort:true}})
