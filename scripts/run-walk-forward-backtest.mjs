import { mkdir,writeFile } from "node:fs/promises";import { loadCsv,number } from "../lib/ml/csv.mjs";import { regressionMetrics,strategyMetrics } from "../lib/ml/metrics.mjs";
const args=new Map(process.argv.slice(2).map(v=>{const[k,x="true"]=v.replace(/^--/,"").split("=");return[k,x]}));const file=args.get("file")??"data/ml/ge-flip-5m-foundation-v1.csv";const target=args.get("target")??"target_return_240m";const minTrain=Number(args.get("min-train")??"500");const testSize=Number(args.get("test-size")??"200");const step=Number(args.get("step")??String(testSize));const costBps=Number(args.get("cost-bps")??"20");const threshold=Number(args.get("threshold")??"0");const all=(await loadCsv(file)).filter(r=>r.split!=="embargo").sort((a,b)=>new Date(a.bucket_at)-new Date(b.bucket_at)||Number(a.item_id)-Number(b.item_id));if(all.length<minTrain+testSize)throw new Error(`Need at least ${minTrain+testSize} rows, found ${all.length}.`);const folds=[];
const timestamp=r=>new Date(r.bucket_at).getTime();
const boundaryAfterTimestamp=index=>{
  if(index<=0)return 0;
  if(index>=all.length)return all.length;
  const time=timestamp(all[index-1]);
  while(index<all.length&&timestamp(all[index])===time)index++;
  return index;
};
const seenBoundaries=new Set();
for(let requestedEnd=minTrain;requestedEnd+testSize<=all.length;requestedEnd+=step){
  const trainEnd=boundaryAfterTimestamp(requestedEnd);
  const testEnd=boundaryAfterTimestamp(trainEnd+testSize);
  if(trainEnd>=all.length||testEnd<=trainEnd)break;
  const boundaryKey=`${trainEnd}:${testEnd}`;
  if(seenBoundaries.has(boundaryKey))continue;
  seenBoundaries.add(boundaryKey);
  const train=all.slice(0,trainEnd),test=all.slice(trainEnd,testEnd);
  const means=new Map();for(const r of train){const y=number(r[target]);if(y==null)continue;const a=means.get(r.item_id)??[0,0];a[0]+=y;a[1]++;means.set(r.item_id,a);}const global=train.reduce((s,r)=>s+(number(r[target])??0),0)/train.length;const predictions=test.map(r=>{const a=means.get(r.item_id);return a?a[0]/a[1]:global;});const actual=test.map(r=>number(r[target]));const trainLast=timestamp(train.at(-1)),testFirst=timestamp(test[0]);if(trainLast>=testFirst)throw new Error(`Temporal overlap detected: ${train.at(-1).bucket_at} >= ${test[0].bucket_at}`);folds.push({fold:folds.length+1,trainRows:train.length,testRows:test.length,trainEnd:train.at(-1).bucket_at,testStart:test[0].bucket_at,testEnd:test.at(-1).bucket_at,...regressionMetrics(actual,predictions),strategy:strategyMetrics(test.map(r=>({...r,target_return_240m:r[target]})),predictions,{threshold,costBps})});}
const weighted=(key)=>{const valid=folds.filter(f=>Number.isFinite(f[key])&&f.testRows>0);const weight=valid.reduce((s,f)=>s+f.testRows,0);return weight?valid.reduce((s,f)=>s+f[key]*f.testRows,0)/weight:null};const report={source:file,target,minTrain,testSize,step,costBps,threshold,generatedAt:new Date().toISOString(),folds,summary:{folds:folds.length,rows:folds.reduce((s,f)=>s+f.rows,0),mae:weighted("mae"),rmse:weighted("rmse"),directionalAccuracy:weighted("directionalAccuracy"),trades:folds.reduce((s,f)=>s+f.strategy.trades,0),netLogReturn:folds.reduce((s,f)=>s+f.strategy.netLogReturn,0)}};await mkdir("data/ml/reports",{recursive:true});const path=`data/ml/reports/walk-forward-${Date.now()}.json`;await writeFile(path,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));console.log(`Saved ${path}`);
