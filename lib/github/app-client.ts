import "server-only";
import { createSign } from "node:crypto";
import { env, hasGitHubConfig } from "@/lib/config/env";
import { ApiError } from "@/lib/api/errors";

const API = "https://api.github.com";
const base64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");
export function appJwt() {
  if (!hasGitHubConfig) throw new ApiError("GitHub App authentication is not configured.",503,"GITHUB_JWT_FAILED");
  const appId=Number(env.GITHUB_APP_ID),privateKey=env.GITHUB_APP_PRIVATE_KEY!.replace(/\\n/g,"\n").trim();
  if(!Number.isInteger(appId)||appId<=0||!/^-----BEGIN (?:RSA )?PRIVATE KEY-----[\s\S]+-----END (?:RSA )?PRIVATE KEY-----$/.test(privateKey))throw new ApiError("GitHub App credentials are invalid.",503,"GITHUB_JWT_FAILED");
  try{
    const now=Math.floor(Date.now()/1000),header=base64url(JSON.stringify({alg:"RS256",typ:"JWT"})),payload=base64url(JSON.stringify({iat:now-60,exp:now+540,iss:String(appId)})),signer=createSign("RSA-SHA256");
    signer.update(`${header}.${payload}`);
    return `${header}.${payload}.${signer.sign(privateKey,"base64url")}`;
  }catch{
    throw new ApiError("GitHub App JWT generation failed.",503,"GITHUB_JWT_FAILED");
  }
}
export async function githubRequest<T>(path:string,token:string,options:RequestInit={}) { const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15_000); try { const response=await fetch(`${API}${path}`,{...options,headers:{Accept:"application/vnd.github+json",Authorization:`Bearer ${token}`,"X-GitHub-Api-Version":"2022-11-28",...(options.headers??{})},signal:controller.signal,cache:"no-store"}); if(!response.ok)throw new ApiError(`GitHub request failed with HTTP ${response.status}.`,response.status===429?429:502,response.status===429?"RATE_LIMITED":"OPERATION_FAILED",response.headers.get("x-github-request-id")??undefined); if(response.status===204||response.headers.get("content-length")==="0")return undefined as T;return await response.json() as T; } finally { clearTimeout(timer); } }
const request=githubRequest;
function githubOperationError(error:unknown,code:"GITHUB_JWT_FAILED"|"INSTALLATION_LOOKUP_FAILED"|"INSTALLATION_TOKEN_FAILED"|"REPOSITORY_LOOKUP_FAILED",message:string):never{
  if(error instanceof ApiError&&(error.code==="GITHUB_JWT_FAILED"||error.code==="RATE_LIMITED"||error.code==="NOT_CONFIGURED"))throw error;
  throw new ApiError(message,error instanceof ApiError&&error.status===429?429:502,code,error instanceof ApiError?error.referenceId:undefined);
}
export async function installationToken(installationId:number){try{return (await request<{token:string}>(`/app/installations/${installationId}/access_tokens`,appJwt(),{method:"POST"})).token;}catch(error){return githubOperationError(error,"INSTALLATION_TOKEN_FAILED","GitHub installation authentication failed.");}}

export interface GitHubInstallation { id:number; app_id?:number; app_slug?:string; account:{id:number;login:string;type:"User"|"Organization"|"Enterprise"|"Bot"}; repository_selection:"all"|"selected"; permissions:Record<string,string>; events:string[]; suspended_at?:string|null }
export interface GitHubRepository { id:number; name:string; full_name:string; private:boolean; visibility?:"public"|"private"|"internal"; default_branch:string; owner:{login:string} }
export interface AuthenticatedGitHubApp { id:number;slug:string;name:string;owner:{login:string} }
export async function getAuthenticatedApp(){try{return await request<AuthenticatedGitHubApp>("/app",appJwt());}catch(error){return githubOperationError(error,"GITHUB_JWT_FAILED","GitHub App authentication failed.");}}
export async function listAppInstallations(){try{const items:GitHubInstallation[]=[];for(let page=1;page<=100;page++){const batch=await request<GitHubInstallation[]>(`/app/installations?per_page=100&page=${page}`,appJwt());items.push(...batch);if(batch.length<100)break;}return items;}catch(error){return githubOperationError(error,"INSTALLATION_LOOKUP_FAILED","GitHub App installations could not be loaded.");}}
export async function listUserInstallations(token:string){try{const items:GitHubInstallation[]=[];for(let page=1;page<=100;page++){const batch=(await request<{installations:GitHubInstallation[]}>(`/user/installations?per_page=100&page=${page}`,token)).installations;items.push(...batch);if(batch.length<100)break;}return items;}catch(error){return githubOperationError(error,"INSTALLATION_LOOKUP_FAILED","GitHub user installations could not be loaded.");}}
export async function getInstallation(installationId:number){try{return await request<GitHubInstallation>(`/app/installations/${installationId}`,appJwt());}catch(error){return githubOperationError(error,"INSTALLATION_LOOKUP_FAILED","GitHub installation lookup failed.");}}
export function deleteInstallation(installationId:number){return request<void>(`/app/installations/${installationId}`,appJwt(),{method:"DELETE"});}
export async function listInstallationRepositories(installationId:number){try{const token=await installationToken(installationId),items:GitHubRepository[]=[];for(let page=1;page<=100;page++){const batch=(await request<{repositories:GitHubRepository[]}>(`/installation/repositories?per_page=100&page=${page}`,token)).repositories;items.push(...batch);if(batch.length<100)break;}return items;}catch(error){if(error instanceof ApiError&&(error.code==="GITHUB_JWT_FAILED"||error.code==="INSTALLATION_TOKEN_FAILED"||error.code==="RATE_LIMITED"))throw error;return githubOperationError(error,"REPOSITORY_LOOKUP_FAILED","Accessible GitHub repositories could not be loaded.");}}

export interface RepositoryConnection { installation_id:number; repository_owner:string; repository_name:string; default_branch:string }
export async function inspectRepository(connection:RepositoryConnection,preferred:string[]=[]){const token=await installationToken(connection.installation_id),repo=`${connection.repository_owner}/${connection.repository_name}`,ref=await request<{object:{sha:string}}>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(connection.default_branch)}`,token),tree=await request<{tree:Array<{path:string;type:string;sha:string}>}>(`/repos/${repo}/git/trees/${ref.object.sha}?recursive=1`,token); const paths=tree.tree.filter((item)=>item.type==="blob"&&/^(app|src|components|lib|pages)\/.+\.(ts|tsx|js|jsx|mjs|html)$/.test(item.path)).map((item)=>item.path),contentPaths=paths.filter(path=>/(?:^|\/)(?:content|site-data|page-data|pages-data|seo-data|seo-content)(?:\.|\/)/i.test(path)),pagePaths=paths.filter(path=>!/(?:^|\/)(?:api|admin|dashboard|seo-admin)(?:\/|$)/i.test(path)&&/(?:^|\/)(?:page|index)\.(?:ts|tsx|js|jsx|mjs|html)$/i.test(path)),technicalPaths=paths.filter(path=>/(?:^|\/)(?:sitemap|robots|schema)(?:\.|\/)/i.test(path)),selected=[...new Set([...preferred.filter((path)=>paths.includes(path)),...contentPaths,...pagePaths,...technicalPaths])].slice(0,30),files=[]; for(const path of selected){const value=await request<{sha:string;content:string;encoding:string}>(`/repos/${repo}/contents/${encodeURIComponent(path).replace(/%2F/g,"/")}?ref=${ref.object.sha}`,token); files.push({path,sha:value.sha,content:value.encoding==="base64"?Buffer.from(value.content.replace(/\n/g,""),"base64").toString("utf8"):value.content});} return{baseCommitSha:ref.object.sha,defaultBranch:connection.default_branch,files,availableSourcePaths:paths};}
export async function verifyFreshness(connection:RepositoryConnection,baseSha:string,files:Array<{path:string;sha:string|null}>){const token=await installationToken(connection.installation_id),repo=`${connection.repository_owner}/${connection.repository_name}`,ref=await request<{object:{sha:string}}>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(connection.default_branch)}`,token),changed:string[]=[]; for(const file of files){if(!file.sha)continue;const current=await request<{sha:string}>(`/repos/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g,"/")}?ref=${ref.object.sha}`,token);if(current.sha!==file.sha)changed.push(file.path);}return{fresh:ref.object.sha===baseSha&&!changed.length,currentBaseSha:ref.object.sha,changedFiles:changed};}

async function assertExactBranchCommit(repo:string,token:string,input:{baseSha:string;commitSha:string;files:Array<{path:string;content:string}>}){
  const commit=await request<{parents:Array<{sha:string}>}>(`/repos/${repo}/git/commits/${input.commitSha}`,token);
  if(commit.parents.length!==1||commit.parents[0]?.sha!==input.baseSha)throw new ApiError("The existing HD SEO branch no longer has the approved base commit.",409,"INVALID_STATE");
  const comparison=await request<{files?:Array<{filename:string}>}>(`/repos/${repo}/compare/${input.baseSha}...${input.commitSha}`,token),expected=[...new Set(input.files.map(file=>file.path))].sort(),actual=[...new Set((comparison.files??[]).map(file=>file.filename))].sort();
  if(expected.length!==actual.length||expected.some((path,index)=>path!==actual[index]))throw new ApiError("The existing HD SEO branch contains files outside the exact approved change.",409,"INVALID_STATE");
  for(const file of input.files){
    const value=await request<{content:string;encoding:string}>(`/repos/${repo}/contents/${encodeURIComponent(file.path).replace(/%2F/g,"/")}?ref=${input.commitSha}`,token),content=value.encoding==="base64"?Buffer.from(value.content.replace(/\n/g,""),"base64").toString("utf8"):value.content;
    if(content!==file.content)throw new ApiError(`The existing HD SEO branch content for ${file.path} no longer matches the exact approved change.`,409,"INVALID_STATE");
  }
}

export async function createAtomicDraftPullRequest(connection:RepositoryConnection,input:{branch:string;baseSha:string;files:Array<{path:string;content:string}>;title:string;body:string}){
  const token=await installationToken(connection.installation_id),repo=`${connection.repository_owner}/${connection.repository_name}`,head=`${connection.repository_owner}:${input.branch}`,existing=await request<Array<{number:number;html_url:string;draft:boolean;base:{ref:string};head:{sha:string}}>>(`/repos/${repo}/pulls?state=all&head=${encodeURIComponent(head)}&per_page=10`,token);
  if(existing[0]){
    if(!existing[0].draft||existing[0].base.ref!==connection.default_branch)throw new ApiError("The existing HD SEO pull request changed state and requires manual reconciliation.",409,"INVALID_STATE");
    await assertExactBranchCommit(repo,token,{baseSha:input.baseSha,commitSha:existing[0].head.sha,files:input.files});
    return{number:existing[0].number,html_url:existing[0].html_url,commitSha:existing[0].head.sha};
  }
  let existingRef:{object:{sha:string}}|null=null;
  try{existingRef=await request<{object:{sha:string}}>(`/repos/${repo}/git/ref/heads/${encodeURIComponent(input.branch)}`,token);}catch{/* A missing branch is created atomically below. */}
  if(existingRef){
    await assertExactBranchCommit(repo,token,{baseSha:input.baseSha,commitSha:existingRef.object.sha,files:input.files});
    const pull=await request<{number:number;html_url:string}>(`/repos/${repo}/pulls`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:input.title,head:input.branch,base:connection.default_branch,body:input.body,draft:true})});
    return{...pull,commitSha:existingRef.object.sha};
  }
  const blobs=[];
  for(const file of input.files){const blob=await request<{sha:string}>(`/repos/${repo}/git/blobs`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({content:file.content,encoding:"utf-8"})});blobs.push({path:file.path,mode:"100644",type:"blob",sha:blob.sha});}
  const base=await request<{tree:{sha:string}}>(`/repos/${repo}/git/commits/${input.baseSha}`,token),tree=await request<{sha:string}>(`/repos/${repo}/git/trees`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({base_tree:base.tree.sha,tree:blobs})}),commit=await request<{sha:string}>(`/repos/${repo}/git/commits`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:input.title,tree:tree.sha,parents:[input.baseSha]})});
  await request(`/repos/${repo}/git/refs`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({ref:`refs/heads/${input.branch}`,sha:commit.sha})});
  const pull=await request<{number:number;html_url:string}>(`/repos/${repo}/pulls`,token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({title:input.title,head:input.branch,base:connection.default_branch,body:input.body,draft:true})});
  return{...pull,commitSha:commit.sha};
}

export async function mergeApprovedPullRequest(connection:RepositoryConnection,input:{pullRequestNumber:number;expectedHeadSha:string}){
  const token=await installationToken(connection.installation_id),repo=`${connection.repository_owner}/${connection.repository_name}`;
  let pull=await request<{node_id:string;state:string;draft:boolean;merged:boolean;mergeable:boolean|null;merge_commit_sha:string|null;head:{sha:string};base:{ref:string}}>(`/repos/${repo}/pulls/${input.pullRequestNumber}`,token);
  if(pull.head.sha!==input.expectedHeadSha)throw new ApiError("The pull request changed after preview approval. Run a fresh preview before release.",409,"INVALID_STATE");
  if(pull.base.ref!==connection.default_branch)throw new ApiError("The pull request no longer targets the approved production branch.",409,"INVALID_STATE");
  if(pull.merged)return{merged:true,sha:pull.merge_commit_sha??pull.head.sha,alreadyMerged:true};
  if(pull.state!=="open")throw new ApiError("The approved pull request is no longer open.",409,"INVALID_STATE");
  if(pull.draft){
    const ready=await request<{data?:{markPullRequestReadyForReview?:{pullRequest?:{isDraft:boolean}}};errors?:Array<{message:string}>}>("/graphql",token,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({query:"mutation Ready($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }",variables:{id:pull.node_id}})});
    if(ready.errors?.length||ready.data?.markPullRequestReadyForReview?.pullRequest?.isDraft!==false)throw new ApiError("GitHub did not accept the approved pull request for release.",502,"OPERATION_FAILED");
    pull=await request(`/repos/${repo}/pulls/${input.pullRequestNumber}`,token);
    if(pull.head.sha!==input.expectedHeadSha)throw new ApiError("The pull request changed while it was being prepared for release.",409,"INVALID_STATE");
  }
  if(pull.mergeable===false)throw new ApiError("GitHub reports merge conflicts. HD SEO will not bypass branch protection.",409,"CONFLICT");
  const merged=await request<{sha:string;merged:boolean;message:string}>(`/repos/${repo}/pulls/${input.pullRequestNumber}/merge`,token,{method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({sha:input.expectedHeadSha,merge_method:"squash"})});
  if(!merged.merged)throw new ApiError(merged.message||"GitHub did not merge the approved pull request.",409,"CONFLICT");
  return{merged:true,sha:merged.sha,alreadyMerged:false};
}
