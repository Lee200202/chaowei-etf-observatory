import {mkdir,writeFile,appendFile} from 'node:fs/promises';
const steps=JSON.parse(process.env.STEPS_JSON || '{}');
const failed=Object.entries(steps).filter(([,v])=>v.outcome==='failure').map(([step,v])=>({step,outcome:v.outcome,conclusion:v.conclusion}));
await mkdir('action-health',{recursive:true});
await writeFile('action-health/refresh-outcomes.json',JSON.stringify({checkedAt:new Date().toISOString(),failed,steps},null,2));
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,
  '\n## 資料更新步驟檢查\n'+(failed.length?failed.map(r=>'- '+r.step+' 失敗；沿用舊資料，請查該步驟日誌。').join('\n'):'目前已執行步驟無失敗。')+'\n');
if(failed.length)console.log('::warning::資料更新有失敗項目：'+failed.map(r=>r.step).join(', '));
