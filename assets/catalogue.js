export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const authors = entry => (entry.auteur || '').split(/,\s*|\s+et\s+/).map(name=>name.trim()).filter(Boolean);
export function metadata(e,prefix='') {
 const link=(key,value,label)=>`<a href="${prefix}poemes.html?${key}=${encodeURIComponent(value)}">${escape(label)}</a>`;
 const parts=[];
 if(e.auteur)parts.push('Auteur : '+escape(e.auteur));
 if(e.date)parts.push('Date : '+link('mois',e.date.slice(0,7),new Intl.DateTimeFormat('fr-FR',{dateStyle:'long',timeZone:'UTC'}).format(new Date(e.date))));
 if(e.lieu)parts.push('Lieu : '+link('lieu',e.lieu,e.lieu));
 return parts.length?`<p class="poem-metadata">${parts.join(' · ')}</p>`:'';
}
export function selectPoems(entries,params) {
 const norm=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('fr');
 const query=norm(params.get('s'));
 const matches=(value,filter)=>!filter||(filter==='__non_precise__'?!value:value===filter);
 const author=params.get('auteur');
 const result=entries.filter(e=>(!author||(author==='__non_precise__'?!authors(e).length:authors(e).includes(author)))&&(!params.get('theme')||e.themes.includes(params.get('theme')))&&matches(e.lieu,params.get('lieu'))&&matches(e.date?.slice(0,7),params.get('mois'))&&norm([e.titre,e.texte,e.auteur,e.lieu].join(' ')).includes(query));
 const byTitle=(a,b)=>a.titre.localeCompare(b.titre,'fr');
 const mode=params.get('tri')||'recent';
 return result.sort((a,b)=>mode==='titre'?byTitle(a,b):mode==='lieu'?(a[mode]||'\uffff').localeCompare(b[mode]||'\uffff','fr')||byTitle(a,b):!a.date&&!b.date?byTitle(a,b):!a.date?1:!b.date?-1:(mode==='ancien'?a.date.localeCompare(b.date):b.date.localeCompare(a.date))||byTitle(a,b));
}
