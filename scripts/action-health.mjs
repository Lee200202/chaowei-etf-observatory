// Classify runner failures separately from source/build failures. Never retry code failures blindly.
export function infrastructureFailure(annotations, jobs) {
  const messages = annotations.map(a => a.message || '').join('\n');
  return /hosted runner lost communication|runner.*(?:offline|disconnected)|runner shutdown/i.test(messages)
    && !jobs.some(j => j.steps?.some(s => s.conclusion === 'failure' && !/Set up job|checkout|setup-node/i.test(s.name)));
}
export function shouldRetryInfrastructure(run, infra) {
  return infra && run.run_attempt === 1 && run.head_branch === 'main' && run.conclusion === 'failure';
}

export async function collectActionHealth({ github, context, core }) {
  const fs = await import('node:fs/promises');
  const run = context.payload.workflow_run;
  const repo = context.repo;
  const jobs = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
    ...repo, run_id: run.id, filter: 'latest', per_page: 100
  });
  const annotations = [];
  for (const job of jobs) {
    const id = Number(job.check_run_url?.split('/').at(-1));
    if (id) annotations.push(...await github.paginate(github.rest.checks.listAnnotations, {...repo, check_run_id: id, per_page: 100}));
  }
  const failedSteps = jobs.flatMap(j => (j.steps || []).filter(s => s.conclusion === 'failure').map(s => ({job:j.name, step:s.name})));
  const infra = infrastructureFailure(annotations, jobs);
  const result = {checkedAt:new Date().toISOString(), workflow:run.name, runId:run.id,
    attempt:run.run_attempt, url:run.html_url, conclusion:run.conclusion,
    classification:infra?'runner-infrastructure':run.conclusion==='success'?'completed':'source-build-or-deploy',
    failedSteps, annotations, jobs, retryRequested:false};
  await fs.mkdir('action-health', {recursive:true});
  if (run.conclusion === 'failure') {
    try {
      const logs = await github.rest.actions.downloadWorkflowRunLogs({...repo, run_id:run.id});
      await fs.writeFile('action-health/run-logs.zip', Buffer.from(logs.data));
    } catch (err) { result.logsUnavailable = String(err.message); }
  }
  if (shouldRetryInfrastructure(run, infra)) {
    await github.rest.actions.reRunWorkflow({...repo, run_id:run.id});
    result.retryRequested = true;
  }
  await fs.writeFile('action-health/report.json', JSON.stringify(result,null,2));
  await core.summary.addHeading('排程執行診斷').addLink(run.name,run.html_url)
    .addTable([['結果','分類','自動重跑'],[run.conclusion,result.classification,result.retryRequested?'一次':'否']])
    .addRaw('\n失敗步驟與 GitHub 診斷詳見 report.json；日誌不存在也會記錄原因。\n').write();
}
