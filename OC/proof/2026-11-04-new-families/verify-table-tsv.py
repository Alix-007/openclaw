from pathlib import Path
import csv,io,json,sys
r=Path(__file__).resolve().parent
expected=[['Label','Value','Empty'],['Alpha\nBeta','One',''],['Quote "here"\nnext','Comma, kept',''],['A\tB','End',''],['Quote "only"','Plain','']]
results=[]
for version,folder in [('base','proof-table-copy-base-publish'),('head','proof-table-copy-head')]:
 receipt=json.loads((r/folder/'receipt.json').read_text());assert receipt['result']=='PASS'
 cases=[]
 for scene in receipt['cases']:
  rows=list(csv.reader(io.StringIO(scene['clipboard']),delimiter='\t'))
  if scene['label']=='ordinary-control':assert rows==[['Name','Value'],['Alpha','One'],['Bold','code']]
  elif version=='head':assert rows==expected
  else:
   assert rows[1][0]=='AlphaBeta';assert len(rows[3])==4
  cases.append({'label':scene['label'],'rows':rows,'columnCounts':[len(row)for row in rows]})
 results.append({'version':version,'sourceHead':receipt['sha'],'cases':cases})
out={'result':'PASS','parser':'Python standard-library csv.reader, delimiter=TAB, default quote escaping','observations':results}
(r/'table-copy-tsv-readback.json').write_text(json.dumps(out,indent=2)+'\n')
print('PASS: independent parser reads all fixed copied tables as 5 rows x 3 cells; baseline loses line breaks and splits the embedded tab into a fourth cell. Ordinary controls stay 3 x 2.')
