import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {detectSignature} from './detect.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
export const normalize=s=>s.normalize('NFC').replace(/[’‘]/g,"'").replace(/\s+/g,' ').trim();
const folded=s=>normalize(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const json=async file=>JSON.parse((await fs.readFile(file,'utf8')).replace(/^\uFEFF/,''));
async function writeJson(file,value){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,JSON.stringify(value,null,2)+'\n','utf8');}
function inside(root,file){const target=path.resolve(root,file);if(!target.startsWith(root+path.sep))throw Error('Unsafe content path');return target;}
function facebookUrl(url){try {const u=new URL(url);return u.protocol==='https:'&&['facebook.com','www.facebook.com'].includes(u.hostname);}catch{return false;}}

// Compare content, not titles. Our earlier Facebook export adds a title and footer.
export function contentCandidates(message){
  const clean=message.replace(/\n+Lire sur le site\s*:\s*https:\/\/lesmotsdunmontagnard\.github\.io\/poemes\/[^\s]+[\s\S]*$/u,'');
  const first=clean.indexOf('\n');
  return [normalize(message),normalize(clean),...(first<0?[]:[normalize(clean.slice(first+1))])];
}
export function classify(message,config){
  const lines=message.split(/\r?\n/).map(l=>l.trim());
  const poem=lines.some(l=>folded(l)===folded(config.poemMarker));
  const news=lines.some(l=>folded(l)===folded(config.newsMarker));
  if(poem&&news)return 'review';
  if(news)return 'news';
  if(poem)return 'poem';
  const signature=detectSignature(message);
  if(signature.auteur&&folded(signature.auteur)===folded(config.defaultAuthor)&&lines.filter(Boolean).length>=6)return 'poem';
  return 'review';
}
function title(message,config){return message.split(/\r?\n/).map(l=>l.trim()).find(l=>l&&![folded(config.poemMarker),folded(config.newsMarker)].includes(folded(l)))?.slice(0,200)||'Publication';}
function mediaItems(post){
  const found=[];
  const walk=items=>{for(const a of items||[]){if(a.type==='photo'&&a.media?.image?.src)found.push({url:a.media.image.src,description:a.description||''});if(a.subattachments?.data)walk(a.subattachments.data);}};
  walk(post.attachments?.data);
  return [...new Map(found.map(p=>[p.url,p])).values()];
}
export async function downloadImage(url){
  const u=new URL(url);
  if(u.protocol!=='https:'||!/(^|\.)(fbcdn\.net|fbsbx\.com)$/.test(u.hostname))throw Error('Image outside Meta CDN; review required');
  const res=await fetch(u,{redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!res.ok)throw Error('Image download failed');
  const types={'image/jpeg':'jpg','image/png':'png','image/webp':'webp'};
  const extension=types[res.headers.get('content-type')?.split(';')[0]];
  if(!extension)throw Error('Unsupported photo format');
  if(Number(res.headers.get('content-length'))>20*1024*1024)throw Error('Image too large');
  const reader=res.body.getReader();const chunks=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>20*1024*1024)throw Error('Image too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel();}
  const bytes=Buffer.concat(chunks);
  const valid=extension==='jpg'?bytes[0]===255&&bytes[1]===216:extension==='png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WEBP';
  if(!valid)throw Error('Invalid image bytes');
  return {bytes,extension};
}

export async function fetchPagePosts({pageId,version,token,since,fetchImpl=fetch}){
  if(!/^\d+$/.test(pageId)||!/^v\d+\.0$/.test(version))throw Error('Valid Page ID and META_GRAPH_VERSION required');
  const fields='id,message,created_time,permalink_url,from{id},attachments{type,description,media,subattachments{type,description,media}}';
  let after;const result=[];const seen=new Set();
  for(let page=0;page<100;page++){
    const url=new URL(`https://graph.facebook.com/${version}/${pageId}/feed`);
    url.searchParams.set('fields',fields);url.searchParams.set('limit','100');url.searchParams.set('since',String(Math.floor(new Date(since).getTime()/1000)));if(after)url.searchParams.set('after',after);
    const res=await fetchImpl(url,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(30000)});
    if(!res.ok)throw Error(`Meta Page request failed (HTTP ${res.status}); check authorization. No checkpoint advanced.`);
    const body=await res.json();if(body.error||!Array.isArray(body.data))throw Error('Meta response invalid; no checkpoint advanced');
    result.push(...body.data);
    if(!body.paging?.next)return result;
    after=body.paging?.cursors?.after;
    if(!after||seen.has(after))throw Error('Incomplete Meta pagination; no checkpoint advanced');
    seen.add(after);
  }
  throw Error('Meta pagination limit reached; no checkpoint advanced');
}

export async function importPosts({root=ROOT,config,posts,download=downloadImage,checkedAt=new Date().toISOString()}){
  const statePath=path.join(root,'content/facebook-sync-state.json');
  let state;try{state=await json(statePath);}catch(e){if(e.code!=='ENOENT')throw e;state={pageId:config.pageId,posts:{}};}
  if(state.pageId!==config.pageId)throw Error('Sync state belongs to a different Page');
  const poems=await json(path.join(root,'content/poemes.json'));
  const news=await json(path.join(root,'content/actualites.json'));
  const bodies=new Set();const identities=new Set();
  for(const entry of [...poems,...news]){
    bodies.add(normalize(await fs.readFile(inside(path.join(root,'content'),entry.fichier),'utf8')));
    if(entry.sourceFacebook)identities.add(entry.sourceFacebook);
    if(entry.facebookPostId)identities.add(entry.facebookPostId);
  }
  const summary={imported:0,duplicates:0,review:0,ignored:0};
  for(const post of [...posts].sort((a,b)=>a.created_time.localeCompare(b.created_time))){
    if(!new RegExp(`^${config.pageId}_\\d+$`).test(post.id)||post.from?.id!==config.pageId){summary.ignored++;continue;}
    if(!post.message?.trim()){summary.ignored++;continue;}
    if(!Number.isFinite(Date.parse(post.created_time)))throw Error('Invalid Facebook timestamp');
    const digest=hash(post.message);const previous=state.posts[post.id];
    if(previous?.hash===digest)continue;
    const source=facebookUrl(post.permalink_url)?post.permalink_url:`https://www.facebook.com/${post.id}`;
    const review=reason=>{state.posts[post.id]={hash:digest,status:'review',reason,source,text:post.message,facebookPublishedAt:post.created_time};summary.review++;};
    if(previous?.status==='imported'||previous?.status==='duplicate'){review('Edited existing post; preserve website text until reviewed');continue;}
    if(identities.has(post.id)||identities.has(source)||contentCandidates(post.message).some(t=>bodies.has(t))){state.posts[post.id]={hash:digest,status:'duplicate',source};summary.duplicates++;continue;}
    const kind=classify(post.message,config);
    if(kind==='review'){review('Unclassified post: use a standalone #poeme or #actualite marker');continue;}
    // Keep platform media URLs out of the persistent state (they expire and can contain signatures).
    const id=`facebook-page-${post.id.replace('_','-')}`;
    const images=[];const files=[];
    try{for(const [i,photo] of mediaItems(post).entries()){
      const asset=await download(photo.url);
      const relative=`assets/${kind==='poem'?'poemes':'actualites'}/facebook-page/${id}-${i+1}.${asset.extension}`;
      files.push({file:inside(root,relative),bytes:asset.bytes});
      images.push({image:relative,description:photo.description||`Illustration de « ${title(post.message,config)} »`,legende:photo.description||''});
    }}catch{review('Photo could not be imported; no partial poem published');continue;}
    const detected=detectSignature(post.message);
    const entry={id,titre:title(post.message,config),fichier:`textes/${id}.txt`,date:detected.date,publie:true,sourceFacebook:source,facebookPostId:post.id,facebookPublishedAt:post.created_time};
    if(kind==='poem')Object.assign(entry,{auteur:detected.auteur||config.defaultAuthor,lieu:detected.lieu,themes:[],image:images[0]?.image||'',descriptionImage:images[0]?.description||'',creditImage:'',...(images.length>1?{images:images.slice(1)}:{})});
    else Object.assign(entry,{introduction:post.message.split(/\r?\n\s*\r?\n/)[0],images});
    for(const file of files){await fs.mkdir(path.dirname(file.file),{recursive:true});await fs.writeFile(file.file,file.bytes);}
    await fs.mkdir(path.join(root,'content/textes'),{recursive:true});
    await fs.writeFile(inside(path.join(root,'content'),entry.fichier),post.message,'utf8');
    (kind==='poem'?poems:news).push(entry);
    bodies.add(normalize(post.message));identities.add(post.id);
    state.posts[post.id]={hash:digest,status:'imported',source,entryId:id,kind,facebookPublishedAt:post.created_time};summary.imported++;
  }
  if(summary.imported){
    await writeJson(path.join(root,'content/poemes.json'),poems);
    await writeJson(path.join(root,'content/actualites.json'),news);
  }
  state.lastSuccessfulCheck=checkedAt;
  await writeJson(statePath,state);
  return summary;
}

async function main(){
  const config=await json(path.join(ROOT,'content/facebook-sync.json'));
  if(!config.enabled){console.log('Facebook sync is disabled pending Page authorization.');return;}
  const token=process.env.FACEBOOK_PAGE_ACCESS_TOKEN;const version=process.env.META_GRAPH_VERSION;
  if(!token||!version)throw Error('Set FACEBOOK_PAGE_ACCESS_TOKEN secret and META_GRAPH_VERSION variable');
  const checkedAt=new Date().toISOString();
  let since=config.startFrom;
  try{const state=await json(path.join(ROOT,'content/facebook-sync-state.json'));if(state.lastSuccessfulCheck)since=new Date(Math.max(Date.parse(since),Date.parse(state.lastSuccessfulCheck)-14*86400000)).toISOString();}catch(e){if(e.code!=='ENOENT')throw e;}
  if(!Number.isFinite(Date.parse(since)))throw Error('Invalid start date');
  const posts=await fetchPagePosts({pageId:config.pageId,version,token,since});
  console.log(JSON.stringify(await importPosts({config,posts,checkedAt})));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(e=>{console.error(e.message);process.exitCode=1;});
