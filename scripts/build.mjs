import fs from 'node:fs';
import {detectSignature} from './detect.mjs';
import {metadata,selectPoems,authors} from '../assets/catalogue.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// A child span prevents HTML's special removal of the first newline in <pre>.
export const poemText = value => '<span>'+escape(value).replace(/\r/g,'&#13;').replace(/\n/g,'&#10;')+'</span>';
const read = name => fs.readFileSync(path.join(root, 'content', name), 'utf8');
const safeFile = (base, name) => {
  if (typeof name !== 'string' || !name || name.includes('\\')) throw new Error('Chemin de fichier invalide.');
  const result = path.resolve(base, name);
  if (!result.startsWith(base + path.sep)) throw new Error('Le fichier doit rester dans son dossier.');
  return result;
};
export function loadEntries(name) {
  const records = JSON.parse(read(name));
  if (!Array.isArray(records)) throw new Error(`${name} doit contenir une liste JSON.`);
  const ids = new Set();
  return records.map(entry => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) || ids.has(entry.id)) throw new Error(`Identifiant invalide ou répété dans ${name}.`);
    ids.add(entry.id);
    if (typeof entry.titre !== 'string' || !entry.titre.trim()) throw new Error(`Titre manquant : ${entry.id}`);
    if (entry.themes && (!Array.isArray(entry.themes) || entry.themes.some(t => typeof t !== 'string'))) throw new Error(`Thèmes invalides : ${entry.id}`);
    if (entry.date && (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || isNaN(Date.parse(entry.date)))) throw new Error(`Date invalide : ${entry.id}`);
    if (entry.image && (!entry.image.startsWith('assets/') || !fs.existsSync(safeFile(root, entry.image)))) throw new Error(`Image absente : ${entry.id}`);
    if(entry.images!==undefined){
      if(!Array.isArray(entry.images))throw new Error('La galerie doit être une liste.');
      for(const photo of entry.images)if(typeof photo.image!=='string'||!photo.image.startsWith('assets/')||!fs.existsSync(safeFile(root,photo.image)))throw new Error('Image de galerie absente : '+entry.id);
    }
    if(entry.sources!==undefined){
      if(!Array.isArray(entry.sources))throw new Error('Sources invalides.');
      for(const source of entry.sources)if(typeof source.titre!=='string'||!/^https:\/\//.test(source.url))throw new Error('Lien source invalide.');
    }
    const texte = fs.readFileSync(safeFile(path.join(root,'content'),entry.fichier),'utf8');
    const detected=detectSignature(texte);
    return {...entry, auteur:entry.auteur??detected.auteur, lieu:entry.lieu??detected.lieu, date:entry.date??detected.date, texte, themes:entry.themes || []};
  }).filter(e => e.publie === true);
}

export function build({demo=false}={}) {
  const config = JSON.parse(read('site.json'));
  let poems = loadEntries('poemes.json'), news = loadEntries('actualites.json').sort((a,b)=>!a.date&&!b.date?0:!a.date?1:!b.date?-1:b.date.localeCompare(a.date));
  if (demo) {
    poems = Array.from({length:9},(_,i)=>({id:`emplacement-${i+1}`,titre:`Titre du poème ${String(i+1).padStart(2,'0')}`,themes:[['Montagnes','Oliviers','Chemins','Livres'][i%4]],texte:'[Emplacement du texte intégral du poème]\n[Emplacement du vers suivant]\n\n[Emplacement de la strophe suivante]\n[Le texte original sera collé ici, sans modification.]',image:i===0?'assets/illustration-exemple.png':'',descriptionImage:'Illustration d’exemple générée : olivier, chemin de pierre et montagnes.'}));
    config.poemeALHonneur = poems[0].id;
  }
  poems=selectPoems(poems,new URLSearchParams());
  const out=path.join(root,demo?'demo':'public');
  if(path.dirname(out)!==root) throw new Error('Dossier de sortie non autorisé.');
  // Only remove our fixed generated output, never the source content.
  fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
  fs.cpSync(path.join(root,'assets'),path.join(out,'assets'),{recursive:true});
  fs.writeFileSync(path.join(out,'.nojekyll'),'');
  const about=read('a-propos.txt');
  const hasAbout=config.afficherAPropos===true&&about.trim().length>0;
  const featured=poems.find(e=>e.id===config.poemeALHonneur);
  const date=e=>e.date?`<p class="wp-block-post-date"><time datetime="${escape(e.date)}">${escape(new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(e.date)))}</time></p>`:'';
  const row=(e,type='poemes',prefix='')=>`<li>${type==='poemes'?`<p class="wp-block-post-terms">${e.themes.map(t=>`<a href="${prefix}poemes.html?theme=${encodeURIComponent(t)}">${escape(t)}</a>`).join(' · ')}</p>`:date(e)}<h2 class="wp-block-post-title"><a href="${prefix}${type}/${e.id}.html">${escape(e.titre)}</a></h2>${type==='poemes'?metadata(e,prefix):''}<a class="wp-block-read-more" href="${prefix}${type}/${e.id}.html">${type==='poemes'?'Lire le poème':'Lire l’actualité'} →</a></li>`;
  const shell=(title,body,{prefix='',active='',mainClass='lmdm-main'}={})=>`<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} — ${escape(config.nom)}</title><link rel="icon" href="${prefix}assets/logo.png"><link rel="stylesheet" href="${prefix}assets/site.css?v=20260918-2"><script type="module" src="${prefix}assets/site.js?v=20260921-author"></script><script defer src="${prefix}assets/copy-link.js"></script></head><body><a class="skip-link" href="#contenu">Aller au contenu</a>${demo?'<div class="preview-note">Aperçu local · Titres et textes de démonstration clairement signalés. Aucun poème réel.</div>':''}<header class="lmdm-header"><a class="lmdm-brand" href="${prefix}index.html"><span class="lmdm-logo"><img src="${prefix}assets/logo.png" width="64" height="64" alt=""></span><span class="wp-block-site-title">${escape(config.nom)}</span></a><button class="preview-menu" type="button" aria-expanded="false" aria-controls="navigation" hidden>Menu</button><nav id="navigation" aria-label="Navigation principale">${[['Accueil','index.html','home'],['Les poèmes','poemes.html','poemes'],['Actualités','actualites.html','actualites'],...(hasAbout?[['À propos','a-propos.html','about']]:[])].map(([label,url,key])=>`<a href="${prefix}${url}"${key===active?' aria-current="page"':''}>${label}</a>`).join('')}</nav></header><main class="${mainClass}" id="contenu">${body}</main><footer class="lmdm-footer"><p>${escape(config.nom)}</p><p class="lmdm-footer-mark">Le recueil</p></footer><button class="back-to-top" type="button" aria-label="Revenir en haut" title="Revenir en haut" hidden><span aria-hidden="true">↑</span></button></body></html>`;
  const write=(file,html)=>{const target=path.join(out,file);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,html);};
  const image=(e,prefix='')=>e.image?`<figure class="wp-block-post-featured-image lmdm-book-image"><img src="${prefix}${escape(e.image)}" alt="${escape(e.descriptionImage||'')}" decoding="async">${e.creditImage?`<figcaption class="image-credit">${escape(e.creditImage)}</figcaption>`:""}</figure>`:'';
  if (config.imageAccueil && (!config.imageAccueil.startsWith('assets/')||!fs.existsSync(safeFile(root,config.imageAccueil)))) throw new Error('Image d’accueil introuvable.');
  write('index.html',shell('Accueil',`<section class="lmdm-hero"><p class="lmdm-eyebrow">Le recueil · Poésie</p><div class="lmdm-hero-grid"><div><h1>${escape(config.nom)}</h1>${config.introduction?`<p class="plain-text">${escape(config.introduction)}</p>`:''}<a class="wp-element-button" href="poemes.html">Découvrir les poèmes <span aria-hidden="true">↗</span></a></div>${config.imageAccueil?`<figure class="lmdm-hero-media"><img src="${escape(config.imageAccueil)}" alt="${escape(config.descriptionImageAccueil)}">${config.creditImageAccueil?`<figcaption>${escape(config.creditImageAccueil)}</figcaption>`:""}</figure>`:''}</div></section>${featured?`<section class="lmdm-section"><p class="lmdm-eyebrow">Poème à l’honneur</p><div class="lmdm-featured"><h2><a href="poemes/${featured.id}.html">${escape(featured.titre)}</a></h2><pre class="wp-block-preformatted">${poemText(featured.texte)}</pre><a href="poemes/${featured.id}.html">Ouvrir le poème →</a></div></section>`:''}<section class="lmdm-section"><h2>Au fil des poèmes</h2>${poems.length?`<ul class="lmdm-poem-list">${poems.slice(0,4).map(e=>row(e)).join('')}</ul>`:'<p class="lmdm-empty">Les poèmes seront bientôt disponibles.</p>'}</section>`,{active:'home',mainClass:''}));
  const themes=[...new Set(poems.flatMap(e=>e.themes))].sort((a,b)=>a.localeCompare(b,'fr'));
  const options=(values)=>values.map(([value,label])=>`<option value="${escape(value)}">${escape(label)}</option>`).join('');
  const unique=key=>[...new Set(poems.map(e=>e[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr')).map(v=>[v,v]);
  const months=[...new Set(poems.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().map(v=>[v,new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(v+'-01'))]);
  const field=(name,label,values,unknown=false)=>`<label>${label}<select name="${name}"><option value="">Tous</option>${options(values)}${unknown?'<option value="__non_precise__">Non précisé</option>':''}</select></label>`;
  const authorOptions=[...new Set(poems.flatMap(authors))].sort((a,b)=>a.localeCompare(b,'fr')).map(a=>[a,a]);
  const filters=`<div class="poem-filters">${field('theme','Sujet',themes.map(t=>[t,t]))}${field('auteur','Auteur',authorOptions,true)}${field('lieu','Lieu d’écriture',unique('lieu'),true)}${field('mois','Date · mois',months,true)}<label>Classer par<select name="tri">${options([['recent','Date : plus récents'],['ancien','Date : plus anciens'],['titre','Titre : A à Z'],['lieu','Lieu d’écriture']])}</select></label></div><div class="filter-actions"><button type="submit">Appliquer les filtres</button><a href="poemes.html">Tout réinitialiser</a></div>`;
  const index = JSON.stringify(poems.map(e=>({id:e.id,titre:e.titre,themes:e.themes,texte:e.texte,auteur:e.auteur,lieu:e.lieu,date:e.date}))).replace(/</g,'\\u003c');
  const pageCount=Math.max(1,Math.ceil(poems.length/8));
  for(let page=1;page<=pageCount;page++) {
    const file=page===1?'poemes.html':`poemes-${page}.html`;
    const paging=pageCount>1?`<nav class="wp-block-query-pagination" aria-label="Pagination des poèmes">${Array.from({length:pageCount},(_,i)=>i+1).map(n=>n===page?`<span class="page-numbers current" aria-current="page">${n}</span>`:`<a href="${n===1?'poemes.html':`poemes-${n}.html`}">${n}</a>`).join('')}</nav>`:'';
    write(file,shell('Les poèmes',`<h1>Les poèmes</h1><div class="lmdm-collection-tools" data-search-tools hidden><form class="wp-block-search" action="poemes.html"><label class="wp-block-search__label" for="search">Rechercher dans les poèmes</label><div class="wp-block-search__inside-wrapper"><input class="wp-block-search__input" id="search" name="s" type="search" placeholder="Un titre, un mot…"><button class="wp-block-search__button">Rechercher</button></div>${filters}</form>${themes.length?`<p class="lmdm-eyebrow">Par thème</p><ul class="wp-block-categories-list"><li><a href="poemes.html">Tous</a></li>${themes.map(t=>`<li><a href="poemes.html?theme=${encodeURIComponent(t)}">${escape(t)}</a></li>`).join('')}</ul>`:''}</div><noscript><p>Activez JavaScript pour rechercher ou filtrer. Tous les poèmes restent accessibles ci-dessous.</p></noscript><div id="results"><ul class="lmdm-poem-list">${poems.slice((page-1)*8,page*8).map(e=>row(e)).join('')}</ul>${poems.length?'':'<p class="lmdm-empty">Aucun poème à afficher.</p>'}${paging}</div><p id="search-status" class="screen-reader-text" role="status"></p><script id="poems-index" type="application/json">${index}</script>`,{active:'poemes'}));
  }
  const newsPages=Math.max(1,Math.ceil(news.length/8));
  for(let page=1;page<=newsPages;page++) write(page===1?'actualites.html':`actualites-${page}.html`,shell('Actualités',`<h1>Actualités</h1>${news.length?`<ul class="lmdm-poem-list">${news.slice((page-1)*8,page*8).map(e=>row(e,'actualites')).join('')}</ul>`:'<p class="lmdm-empty">Aucune actualité publiée pour le moment.</p>'}${newsPages>1?`<nav class="wp-block-query-pagination" aria-label="Pagination des actualités">${Array.from({length:newsPages},(_,i)=>i+1).map(n=>n===page?`<span aria-current="page" class="page-numbers current">${n}</span>`:`<a href="${n===1?'actualites.html':`actualites-${n}.html`}">${n}</a>`).join('')}</nav>`:''}`,{active:'actualites'}));
  for(const [type,entries] of [['poemes',poems],['actualites',news]]) for(const e of entries) {
    const isPoem=type==='poemes';
    const gallery=!isPoem&&e.images?.length?'<section class="news-gallery" aria-label="Photographies et documents">'+e.images.map(photo=>`<figure><a href="../${escape(photo.image)}" target="_blank" rel="noopener" aria-label="${escape('Agrandir : '+photo.legende+' (nouvel onglet)')}"><img src="../${escape(photo.image)}" alt="${escape(photo.description||'')}" loading="lazy" decoding="async"></a><figcaption>${escape(photo.legende||'')} · <a href="../${escape(photo.image)}" target="_blank" rel="noopener">Agrandir<span class="screen-reader-text"> (nouvel onglet)</span></a></figcaption></figure>`).join('')+'</section>':'';
    const newsBody=e.documentComplet?`<div class="wp-block-post-content"><p class="news-summary">${escape(e.resume||'')}</p><details class="news-archive"><summary>Consulter le procès-verbal complet</summary><div class="plain-text news-archive-text">${escape(e.texte)}</div></details></div>`:`<div class="wp-block-post-content"><div class="plain-text">${escape(e.texte)}</div></div>`;
    const content=`<a class="lmdm-back" href="../${type}.html">← ${isPoem?'Tous les poèmes':'Toutes les actualités'}</a><h1>${escape(e.titre)}</h1>${isPoem?metadata(e,'../'):date(e)}${isPoem?`<p class="wp-block-post-terms">${e.themes.map(t=>`<a href="../poemes.html?theme=${encodeURIComponent(t)}">${escape(t)}</a>`).join(' · ')}</p>`:''}${!isPoem&&(e.sousTitre||e.introduction)?`<div class="news-introduction">${e.sousTitre?`<h2>${escape(e.sousTitre)}</h2>`:""}${e.introduction?`<p class="plain-text">${escape(e.introduction)}</p>`:""}</div>`:""}${gallery}${isPoem?`<div class="wp-block-post-content"><pre class="wp-block-preformatted">${poemText(e.texte)}</pre></div>`:newsBody}${!isPoem&&e.sources?.length?`<nav class="news-sources" aria-label="Sources officielles"><h2>Documents officiels</h2><ul>${e.sources.map(source=>`<li><a href="${escape(source.url)}">${escape(source.titre)}</a></li>`).join('')}</ul></nav>`:""}<div class="lmdm-share"><button class="lmdm-copy" data-copy-link hidden>Copier le lien ${isPoem?'du poème':'de l’actualité'}</button><span class="lmdm-copy-status" role="status"></span><noscript>Pour partager, copiez l’adresse de la page.</noscript></div>`;
    write(`${type}/${e.id}.html`,shell(e.titre,isPoem?`<article class="lmdm-book">${image(e,'../')}<div class="lmdm-book-page">${content}</div></article>`:`<article class="lmdm-reading">${e.image?`<figure class="wp-block-post-featured-image"><img src="../${escape(e.image)}" alt="${escape(e.descriptionImage)}"></figure>`:''}${content}</article>`,{prefix:'../',active:type,mainClass:isPoem?'lmdm-book-main':'lmdm-main'}));
  }
  if(hasAbout) {
    // Limited formatting for the About page only; poem rendering stays verbatim.
    const inline=text=>escape(text).replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>');
    const body=about.trim().split(/\r?\n\s*\r?\n/).map(block=>block==='---'?'<hr>':block.startsWith('## ')?'<h2>'+inline(block.slice(3))+'</h2>':'<p>'+inline(block).replace(/\r?\n/g,'<br>')+'</p>').join('');
    const portrait=config.imageAPropos?`<figure class="lmdm-about-portrait"><img src="${escape(config.imageAPropos)}" alt="${escape(config.descriptionImageAPropos||'')}" width="720" height="722" decoding="async">${config.creditImageAPropos?`<figcaption>${escape(config.creditImageAPropos)}</figcaption>`:''}</figure>`:'';
    const illustratedBody=portrait?body.replace('<p>',portrait+'<p>'):body;
    write('a-propos.html',shell('À propos',`<article class="lmdm-about"><h1>À propos</h1>${illustratedBody}</article>`,{active:'about'}));
  }
  write('404.html','<!doctype html><html lang="fr"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Page introuvable</title><body><h1>Page introuvable</h1><p>Cette page n’existe pas. Utilisez le bouton Retour de votre navigateur pour retrouver le recueil.</p></body></html>');
  return out;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) console.log('Site généré : '+build({demo:process.argv.includes('--demo')}));
