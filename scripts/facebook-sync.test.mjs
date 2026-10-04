import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {importPosts,fetchPagePosts,classify,contentCandidates} from './facebook-sync.mjs';

const config={pageId:'61595168813342',defaultAuthor:'Djamel Metref',poemMarker:'#poeme',newsMarker:'#actualite'};
const poem="Un matin\n\nLe vent se lève.\nLa terre écoute.\nEncore un mot.\n\nDjamel Metref\nAt Yenni le 2 octobre 2026\n";
const post=(id,message,extra={})=>({id:config.pageId+'_'+id,message,created_time:'2026-10-02T12:00:00Z',from:{id:config.pageId},...extra});
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'recueil-facebook-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  await fs.mkdir(path.join(root,'content/textes'),{recursive:true});
  await fs.writeFile(path.join(root,'content/textes/existing.txt'),'Ancien titre\n\nUn autre texte.');
  await fs.writeFile(path.join(root,'content/poemes.json'),JSON.stringify([{id:'existing',titre:'Ancien titre',fichier:'textes/existing.txt',publie:true}]));
  await fs.writeFile(path.join(root,'content/actualites.json'),'[]');
  return root;
}
const read=(root,name)=>fs.readFile(path.join(root,'content',name),'utf8').then(JSON.parse);

test('poem text, written date and source identity survive import; retries do not duplicate',async t=>{
  const root=await fixture(t);const posts=[post('101',poem)];
  assert.equal((await importPosts({root,config,posts})).imported,1);
  const entries=await read(root,'poemes.json');const entry=entries.at(-1);
  assert.equal(entry.date,'2026-10-02');assert.equal(entry.facebookPostId,posts[0].id);
  assert.equal(await fs.readFile(path.join(root,'content',entry.fichier),'utf8'),poem);
  assert.equal((await importPosts({root,config,posts})).imported,0);
  assert.equal((await read(root,'poemes.json')).length,2);
});
test('earlier export wrappers are duplicates; same title with different text is retained',async t=>{
  const root=await fixture(t);
  const exported='Ancien titre\n\nAncien titre\n\nUn autre texte.\n\nLire sur le site : https://lesmotsdunmontagnard.github.io/poemes/existing.html\nIllustration : Crédit';
  const withoutLink=exported.replace('https://lesmotsdunmontagnard.github.io/poemes/existing.html','');
  const result=await importPosts({root,config,posts:[post('102',exported),post('202',withoutLink),post('103','Ancien titre\n\nUn texte nouveau.\n#poeme')]});
  assert.equal(result.duplicates,2);assert.equal(result.imported,1);
  assert.equal((await read(root,'poemes.json')).length,2);
});
test('unknown posts, conflicting markers and edits wait for review; comments/foreign posts are skipped',async t=>{
  const root=await fixture(t);
  await importPosts({root,config,posts:[post('104',poem)]});
  const result=await importPosts({root,config,posts:[post('104',poem+'Une modification.'),post('105','Bonjour !'),post('106','#poeme\n#actualite\nUn texte'),post('107',poem,{from:{id:'999'}})]});
  assert.equal(result.review,3);assert.equal(result.ignored,1);
  const entries=await read(root,'poemes.json');assert.equal(entries.length,2);
  assert.equal(await fs.readFile(path.join(root,'content',entries.at(-1).fichier),'utf8'),poem);
});
test('news albums import every photo, retain caption and do not invent a written date',async t=>{
  const root=await fixture(t);const message='Une lecture\n\nRencontre littéraire.\n#actualite\nPhotos : Nadya';
  const attachments={data:[{type:'album',subattachments:{data:[{type:'photo',description:'Photo : Nadya',media:{image:{src:'https://a.fbcdn.net/1'}}},{type:'photo',media:{image:{src:'https://a.fbcdn.net/2'}}}]}}]};
  const result=await importPosts({root,config,posts:[post('108',message,{attachments})],download:async()=>({bytes:Buffer.from('fixture'),extension:'jpg'})});
  assert.equal(result.imported,1);const entry=(await read(root,'actualites.json'))[0];
  assert.equal(entry.images.length,2);assert.equal(entry.images[0].legende,'Photo : Nadya');assert.equal(entry.date,'');
  assert.equal(await fs.readFile(path.join(root,'content',entry.fichier),'utf8'),message);
});
test('failed media never produces an incomplete published poem',async t=>{
  const root=await fixture(t);const before=await fs.readFile(path.join(root,'content/poemes.json'),'utf8');
  const attachments={data:[{type:'photo',media:{image:{src:'https://a.fbcdn.net/failed'}}}]};
  const result=await importPosts({root,config,posts:[post('109',poem,{attachments})],download:async()=>{throw Error('unavailable');}});
  assert.equal(result.review,1);assert.equal(result.imported,0);
  assert.equal(await fs.readFile(path.join(root,'content/poemes.json'),'utf8'),before);
});
test('complete pagination uses header authentication, and rejects missing cursors or API failure',async()=>{
  let calls=0;
  const options={pageId:config.pageId,version:'v99.0',token:'SECRET',since:'2026-10-02T00:00:00Z'};
  const posts=await fetchPagePosts({...options,fetchImpl:async(url,init)=>{
    calls++;assert.ok(url.pathname.endsWith('/posts'));assert.ok(!url.toString().includes('SECRET'));assert.equal(init.headers.Authorization,'Bearer SECRET');
    return {ok:true,json:async()=>calls===1?{data:[post('110',poem)],paging:{next:'ignored',cursors:{after:'cursor'}}}:{data:[post('111',poem)]}};
  }});assert.equal(posts.length,2);assert.equal(calls,2);
  await assert.rejects(fetchPagePosts({...options,fetchImpl:async()=>({ok:true,json:async()=>({data:[],paging:{next:'ignored'}})})}),/Incomplete/);
  await assert.rejects(fetchPagePosts({...options,fetchImpl:async()=>({ok:false,status:401})}),/HTTP 401/);
});
test('classification uses markers or signature, not uncertain title guesses',()=>{
  assert.equal(classify(poem,config),'poem');assert.equal(classify('Une annonce\n#actualité',config),'news');
  assert.equal(classify('Une photo de couverture',config),'review');
  assert.ok(contentCandidates('T\n\nT\ntexte\n\nLire sur le site : https://lesmotsdunmontagnard.github.io/poemes/t.html').includes('T texte'));
});
