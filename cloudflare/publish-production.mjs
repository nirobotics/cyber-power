// Run only from the original repository's protected-by-event production workflow.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const account='2ca8df5c9754fb7e3f37d08c597535e0';
const worker='cyber-power', ghRepo='nirobotics/cyber-power', host='power.team8214.com';
const prefix=`https://api.cloudflare.com/client/v4/accounts/${account}/workers/scripts/${worker}`;
const uuid=/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/;
const sha=process.env.GITHUB_SHA;
const token=process.env.CLOUDFLARE_API_TOKEN;
const msg=`GitHub main ${sha}`, tag=`gh-${sha}`;
const env={...process.env,WRANGLER_SEND_METRICS:'false',CLOUDFLARE_ACCOUNT_ID:account};
const contents=await readFile(join(root,'cloudflare/.production-assets/index.html'));
const exact={name:worker,account_id:account,compatibility_date:'2026-11-14',workers_dev:false,preview_urls:false,
  observability:{enabled:false},assets:{directory:'./cloudflare/.production-assets',html_handling:'drop-trailing-slash',not_found_handling:'none'}};
assert.equal(process.versions.node,'22.23.4');
assert.deepEqual(JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8')),exact,'PRODUCTION_SCOPE_CONFIG_DRIFT');
assert(process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_EVENT_NAME==='push'&&process.env.GITHUB_REPOSITORY===ghRepo&&process.env.GITHUB_REF==='refs/heads/main'
  &&/^[a-f0-9]{40}$/.test(sha)&&typeof token==='string'&&token.length>30,'PRODUCTION_MAIN_PUSH_AND_SECRET_REQUIRED');
assert(!process.env.CLOUDFLARE_CI_OVERRIDE_WORKER_NAME||process.env.CLOUDFLARE_CI_OVERRIDE_WORKER_NAME===worker,'WRANGLER_WORKER_OVERRIDE');
const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','ignore'],timeout:30000}).trim();
function latestMain(){
  assert.equal(git('rev-parse','HEAD'),sha,'GITHUB_COMMIT_CHECKOUT_DRIFT');
  assert.equal(git('ls-remote','--exit-code','origin','refs/heads/main').split(/\s+/)[0],sha,'SKIP_SUPERSEDED_MAIN_COMMIT');
}
async function api(path,body){
  assert(/^\/(?:deployments|settings|subdomain|schedules|versions(?:\/[a-f0-9-]{36})?)$/.test(path),'EXACT_WORKER_API_PATH');
  assert(body===undefined||path==='/deployments','NO_CONFIG_OR_ROUTE_WRITE');
  let response,json;
  try{response=await fetch(prefix+path,{method:body===undefined?'GET':'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(25000),
    headers:{'Authorization':`Bearer ${token}`,Accept:'application/json',...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    json=await response.json();
  }catch{throw Error(`CF_${body===undefined?'READ':'DEPLOY_OUTCOME_UNKNOWN'}:${path}`);}
  if(!response.ok||json?.success!==true)throw Error(`CF_${body===undefined?'READ':'DEPLOY_OUTCOME_UNKNOWN'}:${path}:HTTP${response.status}:CODES_${(json?.errors??[]).map(x=>x.code).filter(Number.isInteger).join(',')}`);
  return json.result;
}
function checkVersion(version){
  assert(uuid.test(version.id)&&Array.isArray(version.resources?.bindings)&&version.resources.bindings.length===0,'EXPECTED_STATIC_ONLY_VERSION');
  assert((version.resources.script?.handlers??[]).length===0&&!version.resources.script?.etag,'UNEXPECTED_EXECUTABLE_WORKER_SCRIPT');
}
async function unchangedConfig(){
  const [sub,settings,cron]=await Promise.all(['/subdomain','/settings','/schedules'].map(p=>api(p)));
  assert(sub.enabled===false&&sub.previews_enabled===false,'STAGED_URL_OR_WORKERS_DEV_ENABLED');
  assert(settings.bindings?.length===0,'PRODUCTION_RUNTIME_BINDINGS_FOUND');
  assert((cron.schedules??cron).length===0,'PRODUCTION_CRON_FOUND');
}
async function current(){
  const d=(await api('/deployments')).deployments?.[0];
  assert(uuid.test(d?.id)&&d.versions?.length===1&&uuid.test(d.versions[0].version_id)&&d.versions[0].percentage===100,'EXACT_CURRENT_DEPLOYMENT_REQUIRED');
  return d;
}
async function formalSmoke(){
  const opt={headers:{'Accept-Encoding':'identity','Cache-Control':'no-cache'},cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(30000)};
  const requests=await Promise.all(['/',`/__cloudflare_ci_not_found_${sha}/`].map(async p=>fetch('https://'+host+p,opt)));
  const [home,missing]=requests;
  assert(home.status===200&&home.headers.has('cf-ray')&&Buffer.from(await home.arrayBuffer()).equals(contents),'FORMAL_HOME_BYTES_OR_PROVIDER_DRIFT');
  assert(missing.status===404&&missing.headers.has('cf-ray'),'FORMAL_TRUE_404_REQUIRED');
  await missing.body?.cancel();
}
async function main(){
  latestMain();
  const original=await current();
  const oldVersion=original.versions[0].version_id;
  checkVersion(await api('/versions/'+oldVersion));
  await unchangedConfig();
  const stage=await mkdtemp(join(tmpdir(),'cyber-power-version-'));
  try {
    const log=join(stage,'wrangler-output.jsonl');
    const wrangler=join(root,'cloudflare/tools/node_modules/wrangler/bin/wrangler.js');
    let uploadExit=0;
    try{
      execFileSync(process.execPath,[wrangler,'versions','upload','--config','wrangler.jsonc','--tag',tag,'--message',msg],
        {cwd:root,env:{...env,WRANGLER_OUTPUT_FILE_PATH:log},stdio:['ignore','ignore','ignore'],timeout:240000});
    }catch(e){uploadExit=e.status??1;}
    // Do not replay if the request or response was interrupted. Only an exact
    // new version tied to this commit can authorize the promotion step.
    const versionFile=await readFile(log,'utf8').catch(()=>null);
    const ids=(versionFile??'').split('\n').filter(Boolean).map(x=>JSON.parse(x))
      .filter(x=>x.type==='version-upload'&&x.worker_name===worker&&x.worker_name_overridden===false&&uuid.test(x.version_id));
    if(ids.length!==1)throw Error(`UPLOAD_NOT_INDEPENDENTLY_IDENTIFIED_NO_REPLAY:EXIT_${uploadExit}`);
    const id=ids[0].version_id;
    assert.notEqual(id,oldVersion,'EXPECTED_A_FRESH_VERSION_ID');
    const version=await api('/versions/'+id);
    checkVersion(version);
    assert.equal(version.id,id);
    assert.equal(version.annotations?.['workers/tag'],tag,'WRANGLER_VERSION_TAG_DRIFT');
    assert.equal(version.annotations?.['workers/message'],msg,'WRANGLER_SOURCE_SHA_NOT_RECAPTURED');
    await unchangedConfig();
    assert.equal((await current()).id,original.id,'PRODUCTION_CHANGED_DURING_BUILD');
    latestMain();
    let unknown=false;
    try{await api('/deployments',{strategy:'percentage',versions:[{version_id:id,percentage:100}],annotations:{'workers/message':msg}});}
    catch(e){unknown=true;console.error(e.message);}
    // Deployment creation can return before the independently read deployment
    // list catches up. Only poll GET; never issue the write twice.
    const deadline=Date.now()+60000;
    let active, observations=0;
    while(Date.now()<deadline){
      const seen=await current(); observations++;
      if(seen.id!==original.id){
        assert(seen.versions[0].version_id===id&&seen.annotations?.['workers/message']===msg,'UNEXPECTED_NEW_DEPLOYMENT_DURING_READBACK');
        active=seen;break;
      }
      assert.equal(seen.versions[0].version_id,oldVersion,'OLD_DEPLOYMENT_DRIFT_DURING_READBACK');
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
    assert(active,'PUBLISH_UNCONFIRMED_READ_ONLY_NO_REPLAY');
    console.log(JSON.stringify({deployReadback:'confirmed',observations,writeReplays:0}));
    await unchangedConfig();
    await formalSmoke();
    console.log(JSON.stringify({status:'main-push-cloudflare-live',worker,gitSha:sha,version:id,previousVersion:oldVersion,deployment:active.id,percentage:100,unknownResponseConfirmed:unknown,formalSmoke:true}));
  } finally {await rm(stage,{recursive:true,force:true});}
}
try{await main();}catch(e){console.error(String(e.message).slice(0,450));process.exitCode=1;}
