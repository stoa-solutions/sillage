const http = require('node:http');
http.createServer(async (req,res) => {
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(501);res.end();return;}
  let body=req.body;
  if(!body){let raw='';for await(const chunk of req)raw+=chunk;try{body=JSON.parse(raw);}catch{res.writeHead(400);res.end();return;}}
  if(!Array.isArray(body.messages)||!Array.isArray(body.tools)||!body.model){res.writeHead(400);res.end(JSON.stringify({error:{message:'Invalid completion request'}}));return;}
  const prompt=body.messages.filter(x=>x.role==='user').at(-1)?.content || '';
  if(prompt.includes('SIMULATE_503')){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{message:'Provider unavailable'}}));return;}
  let message;
  const output=body.messages.filter(x=>x.role==='tool').at(-1);
  if(!output){message={role:'assistant',content:null,tool_calls:[{id:'search-1',type:'function',function:{name:'library_search',arguments:JSON.stringify({query:'jazz',maxDurationSeconds:1200})}}]};}
  else {
    const tracks=JSON.parse(output.content).tracks || [];
    const ids=prompt.includes('SIMULATE_HALLUCINATION')?['invented123']:tracks.slice(0,3).map(x=>x.id);
    message={role:'assistant',content:JSON.stringify({reply:'On commence doucement, avec du jazz de ta bibliothèque.',trackIds:ids,action:ids.length?'replace':'keep'})};
  }
  res.writeHead(200,{'Content-Type':'application/json'});
  res.end(JSON.stringify({id:'chatcmpl-fixture',object:'chat.completion',model:body.model,choices:[{index:0,message,finish_reason:message.tool_calls?'tool_calls':'stop'}]}));
}).listen(process.env.PORT);
