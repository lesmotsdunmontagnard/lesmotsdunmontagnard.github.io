# Facebook → Les mots d’un montagnard

Préparé pour la Page Facebook (profil `61595168813342`, ID API validé `1314805048387857`). La connexion est désactivée tant que l’autorisation Meta n’est pas terminée. Aucun mot de passe ni jeton ne doit être enregistré dans le dépôt.

## Publier un nouveau texte

Un poème signé **Djamel Metref**, avec une ligne finale de lieu et de date comme `At Yenni le 2 octobre 2026`, peut être reconnu automatiquement. Pour les autres poèmes, ajoutez une ligne contenant uniquement `#poeme`. Pour une nouvelle littéraire, ajoutez une ligne contenant uniquement `#actualite`. La première ligne non vide, hors marqueur, sert de titre. Le texte intégral reste intact, y compris les crédits et les marqueurs. Ne mentionnez qu’un des deux marqueurs.

Les publications qui ne correspondent pas à ces règles attendent une vérification dans `content/facebook-sync-state.json` ; elles ne deviennent pas des pages publiques. Les mises à jour sans texte, les commentaires et les publications d’autres personnes ne sont pas importés. Les vidéos ne sont pas transférées. Les photos jointes sont téléchargées, y compris les albums, sans inventer de crédit.

Le système compare les textes et les identités Facebook, pas seulement les titres. Les anciens poèmes copiés depuis le site sont ignorés : leur titre ajouté et le pied de publication « Lire sur le site » sont reconnus. Les modifications ultérieures d’une publication déjà importée demandent une vérification ; aucune page existante n’est écrasée ou supprimée automatiquement.

La date écrite dans le poème reste distincte de son horodatage Facebook. Une date absente n’est pas inventée. Une photo inaccessible met le texte en attente, pour éviter de publier une copie incomplète.

## Terminer la connexion

1. Terminer l’inscription Meta for Developers et créer une application autorisée à lire les publications de cette Page. Vérifier les permissions et les conditions d’accès pour cette application, notamment `pages_read_engagement`. La documentation officielle [Publications](https://developers.facebook.com/documentation/pages-api/posts), consultée le 2 octobre 2026, décrit la lecture des publications. Le test réel du 4 octobre 2026 valide `/page_id/posts` en `v26.0`, avec un jeton de Page et les permissions `pages_show_list` / `pages_read_engagement`; cet endpoint limite la lecture aux publications de la Page. Le connecteur attend un jeton de Page, pas un mot de passe Facebook.
2. Enregistrer le jeton exclusivement dans le secret GitHub Actions `FACEBOOK_PAGE_ACCESS_TOKEN` du dépôt original `lesmotsdunmontagnard/lesmotsdunmontagnard.github.io`. Enregistrer la version validée (forme `vNN.0`) dans la variable `META_GRAPH_VERSION`. Ne pas coller le jeton dans une conversation, un fichier source ou un rapport.
3. Avec l’API autorisée, vérifier un appel de lecture et l’appartenance du jeton à la Page. Tester les données réelles en copie temporaire avant activation. Les tests hors ligne ne prouvent pas que Meta accorde l’accès.
4. Passer `enabled` à `true` dans `content/facebook-sync.json`, publier cette seule modification, puis lancer manuellement **Facebook vers le recueil** et vérifier son résultat. Confirmer l’absence de doublons et la publication réelle d’un nouveau texte connu.

Après activation, GitHub Actions vérifie environ chaque heure (les horaires peuvent être retardés par GitHub) et publie seulement après validation du recueil. Le workflow comprend sa propre publication GitHub Pages, car un commit produit par son jeton automatique ne déclenche pas le workflow ordinaire de push.

Pour suspendre la connexion, mettre `enabled` à `false`. Si un jeton expire ou si Meta refuse l’accès, le workflow échoue sans avancer le point de lecture. Renouveler le secret et relancer. Les doublons sont toujours vérifiés.

## Vérifications

`node --test scripts/facebook-sync.test.mjs`

`node scripts/test.mjs`

`node scripts/build.mjs`

L’importeur lit seulement les catalogues et textes publics du recueil, et écrit dans les dossiers publics prévus. Les documents privés à côté du dépôt ne font jamais partie de cette connexion. La sauvegarde locale des anciens poèmes Facebook et la file de transfert site → Facebook sont des opérations distinctes.
