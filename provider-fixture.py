#!/usr/bin/python3
import os,sys,time,json,signal
log=sys.argv[1];mode=sys.argv[2]
def event(kind,**kw):
 with open(log,'a') as f:f.write(json.dumps(dict(kind=kind,time=time.monotonic(),pid=os.getpid(),ppid=os.getppid(),**kw))+'\n')
def stop(signum,frame):
 event('signal',signal=signum);sys.exit(128+signum)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
r=json.loads(sys.stdin.read());event('request',ids=r.get('ids'),protocolVersion=r.get('protocolVersion'))
if mode=='error':sys.exit(7)
if mode=='pending':
 while True:time.sleep(.1)
print(json.dumps({'protocolVersion':1,'values':{i:'SYNTHETIC_TEST_ONLY' for i in r['ids']}}))
event('response')
