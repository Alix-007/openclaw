#!/usr/bin/env python3
"""Frozen V3: adds strict quiet read-abort output to V2 transport/exit oracles."""
import argparse, errno, fcntl, hashlib, http.server, json, os, pathlib, pty, re, select, signal, socket, struct, subprocess, termios, threading, time
p=argparse.ArgumentParser();p.add_argument('--repo',required=True);p.add_argument('--output',required=True);p.add_argument('--node',required=True);p.add_argument('--expect-head',required=True);p.add_argument('--expect',choices=['red','green'],required=True);a=p.parse_args()
r=pathlib.Path(a.repo).resolve();out=pathlib.Path(a.output).resolve();out.mkdir(exist_ok=False,parents=True)
def sha(v):return hashlib.sha256(v).hexdigest()
def git(*args):return subprocess.check_output(['git',*args],cwd=r,text=True).strip()
def processes(group):
 return [dict(zip(['pid','ppid','pgid','stat'],f)) for line in subprocess.check_output(['ps','-eo','pid=,ppid=,pgid=,stat='],text=True).splitlines() if len(f:=line.split())==4 and int(f[2])==group]
def binding():
 stamp=json.loads((r/'dist/build-info.json').read_text());stamp2=json.loads((r/'dist/.buildstamp').read_text());head=git('rev-parse','HEAD');dirty=git('status','--porcelain','--untracked-files=no')
 paths=['openclaw.mjs','node-runtime-recovery.mjs','gateway-shutdown-budget.mjs','dist/entry.js','dist/index.js','dist/build-info.json','dist/.buildstamp','extensions/memory-core/src/cli-status.runtime.ts','extensions/memory-core/src/cli-runtime-common.ts','extensions/memory-core/src/memory/manager-provider-lifecycle.ts','extensions/memory-core/src/memory/manager-embedding-ops.ts','extensions/memory-core/src/memory/paused-deadline.ts','packages/memory-host-sdk/src/host/search-manager.types.ts']
 return {'head':head,'tracked_status':dirty,'build_info':stamp,'build_stamp':stamp2,'sha256':{x:sha((r/x).read_bytes()) for x in paths},'pass':head==a.expect_head and not dirty and stamp['commit']==head and stamp2['head']==head and stamp2['inputsClean']}
receipt={'collector_sha256':sha(pathlib.Path(__file__).read_bytes()),'expect':a.expect,'binding_before':binding(),'cases':[],'scope':'Normal memory status --deep CLI through Memory Core and bundled OpenAI plugin to synthetic compatible loopback HTTP. Real OS PTY/pipe/socket and actual product HTTP transport; no actual OpenAI/Ollama provider service, semantic-quality, inference, Gateway, or indexing claim.','isolation':'Allowlisted environment, task-owned HOME/USERPROFILE/XDG/tmp/config/state/workspace. Not an OS filesystem/network sandbox. Product/dependency reads expected.','fixture_cleanup':'Retained; owned children and server sockets waited/closed.','output_contract_source':'https://github.com/openclaw/openclaw/pull/197110#issuecomment-6790934424; accepted readUnlessAborted pattern suppresses both rejected and resolved reads after abort, before JSON/global failure output','v2_oracle_gap':'V2 rejected success status array only; graceful exit plus generic cli_error JSON/banner could pass. V3 preserves all V2 exit/socket/control assertions and adds strict post-interrupt stdout/stderr silence. Frozen V1/V2 remain unchanged.','result':'RUNNING'}
def save():(out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
assert receipt['binding_before']['pass'],'HEAD/build/clean mismatch'
try:
 for label,mode in [('response-200-control','200'),('response-401-control','401'),('pending-sigint','SIGINT'),('pending-sigterm','SIGTERM')]:
  case=out/label;case.mkdir();events=[];arrived=threading.Event();closed=threading.Event();stop=threading.Event();beg=time.monotonic();pending=mode.startswith('SIG')
  class Handler(http.server.BaseHTTPRequestHandler):
   protocol_version='HTTP/1.1'
   def log_message(self,*args):pass
   def do_POST(self):
    raw=self.rfile.read(int(self.headers.get('content-length','0')));body=json.loads(raw);events.append({'event':'request','at':time.monotonic(),'method':self.command,'path':self.path,'body':body,'body_sha256':sha(raw),'synthetic_auth_matches':self.headers.get('authorization')=='Bearer task-only-memory-deep-fixture'});arrived.set()
    if pending:
     self.connection.settimeout(.1)
     while not stop.is_set():
      try:
       ready,_,_=select.select([self.connection],[],[],.1)
       if ready and self.connection.recv(1,socket.MSG_PEEK)==b'':events.append({'event':'peer-closed','at':time.monotonic()});closed.set();return
      except (OSError,ValueError):events.append({'event':'peer-closed','at':time.monotonic()});closed.set();return
     return
    inp=body['input'];inp=inp if isinstance(inp,list) else [inp]
    payload={'object':'list','model':body['model'],'data':[{'object':'embedding','index':i,'embedding':[.25,.5,.75]} for i,_ in enumerate(inp)]} if mode=='200' else {'error':{'message':'synthetic fixture authorization rejection','type':'invalid_request_error','code':'invalid_authentication'}}
    response=json.dumps(payload).encode();self.send_response(int(mode));self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(response)));self.end_headers();self.wfile.write(response);self.wfile.flush();events.append({'event':'response','at':time.monotonic(),'status':int(mode),'body_sha256':sha(response)})
  server=http.server.ThreadingHTTPServer(('127.0.0.1',0),Handler);server.daemon_threads=True;t=threading.Thread(target=server.serve_forever,daemon=True);t.start()
  for name in ['home','xdg-config','xdg-cache','xdg-data','xdg-state','tmp','state','workspace']:(case/name).mkdir()
  corpus=case/'workspace/MEMORY.md';corpus.write_text('# Isolated memory\nOrdinary synthetic diagnostic corpus.\n');corpus_sha=sha(corpus.read_bytes())
  cfg={'gateway':{'mode':'local','controlUi':{'enabled':False}},'agents':{'entries':{'main':{'workspace':str(case/'workspace')}}},'plugins':{'allow':['memory-core','openai'],'entries':{'memory-core':{'enabled':True},'openai':{'enabled':True}}},'memory':{'search':{'provider':'openai','fallback':'none','model':'text-embedding-3-small','outputDimensionality':3,'remote':{'baseUrl':f'http://127.0.0.1:{server.server_port}/v1/','apiKey':'task-only-memory-deep-fixture'}}}}
  cp=case/'openclaw.json';cp.write_text(json.dumps(cfg,indent=2)+'\n');cp.chmod(0o600);cfg_sha=sha(cp.read_bytes())
  env={'PATH':str(pathlib.Path(a.node).parent)+':/usr/bin:/bin','HOME':str(case/'home'),'USERPROFILE':str(case/'home'),'XDG_CONFIG_HOME':str(case/'xdg-config'),'XDG_CACHE_HOME':str(case/'xdg-cache'),'XDG_DATA_HOME':str(case/'xdg-data'),'XDG_STATE_HOME':str(case/'xdg-state'),'TMPDIR':str(case/'tmp'),'TMP':str(case/'tmp'),'TEMP':str(case/'tmp'),'OPENCLAW_CONFIG_PATH':str(cp),'OPENCLAW_STATE_DIR':str(case/'state'),'LANG':'C.UTF-8','LC_ALL':'C.UTF-8','NO_COLOR':'1','TERM':'xterm-256color'}
  cmd=[a.node,str(r/'openclaw.mjs'),'memory','status','--deep','--agent','main','--json'];pid,master=pty.fork()
  if pid==0:
   fcntl.ioctl(0,termios.TIOCSWINSZ,struct.pack('HHHH',24,100,0,0));fd=os.open(case/'diagnostics.log',os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600);os.dup2(fd,2);os.close(fd);os.chdir(case);os.execve(a.node,cmd,env)
  data=bytearray();sent=None;status=None;exited=None;eof=False;watchdog=False;at_interrupt=[];error=None;terminal_bytes_at_interrupt=0
  try:
   while time.monotonic()-beg<50:
    if pending and sent is None and arrived.is_set():
     sent=time.monotonic();terminal_bytes_at_interrupt=len(data);at_interrupt=processes(pid)
     if mode=='SIGINT':os.write(master,b'\x03')
     else:os.killpg(pid,signal.SIGTERM)
    ready,_,_=select.select([master],[],[],.03)
    if ready:
     try:
      chunk=os.read(master,65536)
      if chunk:data.extend(chunk)
      else:eof=True
     except OSError as e:
      if e.errno!=errno.EIO:raise
      eof=True
    if status is None:
     got,v=os.waitpid(pid,os.WNOHANG)
     if got:status=v;exited=time.monotonic()
    if status is not None and eof:break
   if status is None:watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);exited=time.monotonic()
   closed.wait(.15)
  except Exception as e:
   error=repr(e)
   if status is None:watchdog=True;os.killpg(pid,signal.SIGKILL);_,status=os.waitpid(pid,0);exited=time.monotonic()
  finally:
   cleanup_started=time.monotonic();before_cleanup=processes(pid);os.close(master);stop.set();server.shutdown();server.server_close();t.join(timeout=2)
  diagnostics=(case/'diagnostics.log').read_text();text=data.decode(errors='replace');plain=re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',text);payload=None
  for m in re.finditer(r'[\[{]',plain):
   try:
    v,end=json.JSONDecoder().raw_decode(plain[m.start():])
    if isinstance(v,list) and v and isinstance(v[0],dict) and 'agentId' in v[0] or isinstance(v,dict) and 'ok' in v:payload=v;break
   except ValueError:pass
  success_json=isinstance(payload,list) and bool(payload) and 'embeddingProbe' in payload[0]
  closes=[x for x in events if x['event']=='peer-closed' and x['at']<cleanup_started]
  interrupt_notice='Command interrupted by '+mode+'. Waiting for cleanup before exiting.'
  diagnostics_after_ack=diagnostics.split(interrupt_notice,1)[1] if pending and interrupt_notice in diagnostics else None
  strip_terminal=lambda value:re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]','',value).replace('^C','').replace('\x03','').strip()
  stdout_after_interrupt=strip_terminal(data[terminal_bytes_at_interrupt:].decode(errors='replace')) if pending else None
  quiet_after_ack=pending and payload is None and stdout_after_interrupt=='' and diagnostics_after_ack is not None and strip_terminal(diagnostics_after_ack)==''
  row={'label':label,'mode':mode,'argv':cmd,'environment':env,'config_sha256_before':cfg_sha,'config_sha256_after':sha(cp.read_bytes()),'config_unchanged':cfg_sha==sha(cp.read_bytes()),'corpus_unchanged':corpus_sha==sha(corpus.read_bytes()),'pid':pid,'process_group':pid,'owned_processes_at_interrupt':at_interrupt,'owned_processes_before_harness_cleanup':before_cleanup,'request_seen':arrived.is_set(),'signal_sent':sent is not None,'interrupt_acknowledged':pending and ('Command interrupted by '+mode+'.') in diagnostics,'exit_code':os.waitstatus_to_exitcode(status),'elapsed_seconds':exited-beg,'interrupt_to_exit_ms':(exited-sent)*1000 if sent else None,'interrupt_to_http_close_ms':(closes[0]['at']-sent)*1000 if sent and closes else None,'http_closed_before_harness_cleanup':bool(closes),'harness_watchdog_kill':watchdog,'pty_eof_drained':eof,'success_status_json_published':success_json,'json_payload':payload,'events':events,'error':error,'terminal_sha256':sha(data),'diagnostics_sha256':sha(diagnostics.encode()),'terminal_bytes_at_interrupt':terminal_bytes_at_interrupt if pending else None,'stdout_after_interrupt_normalized':stdout_after_interrupt,'diagnostics_after_ack':diagnostics_after_ack,'quiet_after_ack':quiet_after_ack if pending else None}
  (case/'terminal.raw').write_bytes(data);(case/'http-events.json').write_text(json.dumps(events,indent=2)+'\n');receipt['cases'].append(row);save()
  assert not error and not watchdog and not before_cleanup and row['config_unchanged'] and row['corpus_unchanged'],json.dumps(row)
  requests=[e for e in events if e['event']=='request'];assert len(requests)==1 and requests[0]['path']=='/v1/embeddings' and requests[0]['body']['input']==['ping'] and requests[0]['synthetic_auth_matches'],json.dumps(row)
  if not pending:
   assert row['exit_code']==0 and success_json,json.dumps(row)
   probe=payload[0]['embeddingProbe'];assert probe['ok']==(mode=='200'),json.dumps(row)
   if mode=='401':assert 'synthetic fixture authorization rejection' in probe['error'],json.dumps(row)
   row['result']='LEGAL_RESPONSE_CONTROL'
  else:
   assert row['signal_sent'] and row['interrupt_acknowledged'] and not success_json,json.dumps(row)
   assert quiet_after_ack,json.dumps(row)
   green=row['exit_code']==(130 if mode=='SIGINT' else 143) and row['interrupt_to_exit_ms']<1500 and row['http_closed_before_harness_cleanup'] and row['interrupt_to_http_close_ms']<1500
   if a.expect=='green':assert green,json.dumps(row)
   else:assert not green and row['exit_code'] in [-9,137] and row['interrupt_to_exit_ms']>=1500,json.dumps(row)
   row['result']='GREEN_CANCELLED_AND_JOINED' if a.expect=='green' else 'RED_ACKNOWLEDGED_BUT_LAUNCHER_SIGKILL'
  save()
 receipt['binding_after']=binding();assert receipt['binding_after']['pass'];receipt['result']='RED_WITH_LEGAL_CONTROLS' if a.expect=='red' else 'GREEN';receipt['pass']=True
except Exception as e:receipt['result']='BLOCKED_OR_UNEXPECTED';receipt['error']=repr(e);receipt['pass']=False;raise
finally:save()
print(json.dumps({'result':receipt['result'],'cases':[{k:c.get(k) for k in ['label','result','exit_code','interrupt_to_exit_ms','interrupt_to_http_close_ms','harness_watchdog_kill']} for c in receipt['cases']]}))
