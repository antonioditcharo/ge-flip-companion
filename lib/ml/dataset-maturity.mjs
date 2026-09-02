const DAY=86400000;
const asMs=r=>Date.parse(r.bucket_at);
const iso=ms=>ms==null?null:new Date(ms).toISOString();
export function auditDataset(rows,options={}){
 const cadenceMinutes=Number(options.cadenceMinutes??5),gapMultiplier=Number(options.gapMultiplier??3),minTrainDays=Number(options.minTrainDays??14),minValidationDays=Number(options.minValidationDays??3),minTestDays=Number(options.minTestDays??3);
 const valid=rows.filter(r=>Number.isFinite(asMs(r))).sort((a,b)=>asMs(a)-asMs(b));if(!valid.length)throw Error('No rows with valid bucket_at values.');
 const stamps=[...new Set(valid.map(asMs))].sort((a,b)=>a-b),first=stamps[0],last=stamps.at(-1),spanMs=last-first,gapThresholdMs=cadenceMinutes*60000*gapMultiplier,gaps=[];
 for(let i=1;i<stamps.length;i++){const d=stamps[i]-stamps[i-1];if(d>gapThresholdMs)gaps.push({after:iso(stamps[i-1]),before:iso(stamps[i]),minutes:d/60000,missingBucketsEstimate:Math.max(0,Math.round(d/(cadenceMinutes*60000))-1)});}
 const bySplit={};for(const name of ['train','validation','test']){const sample=valid.filter(r=>r.split===name),ts=[...new Set(sample.map(asMs))].sort((a,b)=>a-b);bySplit[name]={rows:sample.length,items:new Set(sample.map(r=>String(r.item_id))).size,first:iso(ts[0]),last:iso(ts.at(-1)),spanMinutes:ts.length?(ts.at(-1)-ts[0])/60000:0,uniqueBuckets:ts.length};}
 const requiredDays=minTrainDays+minValidationDays+minTestDays,availableDays=spanMs/DAY,ready=availableDays>=requiredDays&&bySplit.train.spanMinutes>=minTrainDays*1440&&bySplit.validation.spanMinutes>=minValidationDays*1440&&bySplit.test.spanMinutes>=minTestDays*1440;
 const warnings=[];if(availableDays<requiredDays)warnings.push(`Dataset spans ${availableDays.toFixed(2)} days; ${requiredDays} days are required.`);if(gaps.length)warnings.push(`${gaps.length} timestamp gaps exceed ${gapMultiplier}x the expected ${cadenceMinutes}-minute cadence.`);for(const [name,days] of [['train',minTrainDays],['validation',minValidationDays],['test',minTestDays]])if(bySplit[name].spanMinutes<days*1440)warnings.push(`${name} spans ${(bySplit[name].spanMinutes/1440).toFixed(2)} days; target is ${days} days.`);
 return{ready,rows:valid.length,items:new Set(valid.map(r=>String(r.item_id))).size,first:iso(first),last:iso(last),availableDays,requiredDays,cadenceMinutes,gapThresholdMinutes:gapThresholdMs/60000,gaps,bySplit,targets:{trainDays:minTrainDays,validationDays:minValidationDays,testDays:minTestDays},warnings};
}
export function assignDurationSplits(rows,options={}){
 const validationDays=Number(options.validationDays??3),testDays=Number(options.testDays??3),embargoMinutes=Number(options.embargoMinutes??240),valid=rows.filter(r=>Number.isFinite(asMs(r))).sort((a,b)=>asMs(a)-asMs(b));if(!valid.length)throw Error('No rows with valid bucket_at values.');const end=asMs(valid.at(-1)),testStart=end-testDays*DAY,validationEnd=testStart-embargoMinutes*60000,validationStart=validationEnd-validationDays*DAY,trainEnd=validationStart-embargoMinutes*60000;
 const assigned=[],dropped=[];for(const row of valid){const t=asMs(row);let split=null;if(t<=trainEnd)split='train';else if(t>=validationStart&&t<=validationEnd)split='validation';else if(t>=testStart)split='test';if(split)assigned.push({...row,split});else dropped.push(row);}
 return{rows:assigned,dropped,boundaries:{trainEnd:iso(trainEnd),validationStart:iso(validationStart),validationEnd:iso(validationEnd),testStart:iso(testStart),testEnd:iso(end),embargoMinutes}};
}
