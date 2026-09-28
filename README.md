# Turbo Samouraï Jetpack : prototype V1

Jeu 2D de mouvement basé sur la physique : un personnage qui marche à peine (tongs), deux grappins
indépendants et un jetpack orientable. La vitesse est l'outil principal et la cause de mort principale.

Cette V1 sert à **valider le feel** et à **poser une architecture déterministe** compatible plus tard
avec leaderboard, replays fantômes et netcode rollback. Pas de contenu, pas de progression. Depuis la
branche `Design-V1`, le jeu porte la direction artistique des planches (pixel art calculé en code, trois
thèmes) ; l'ancien grey-box reste disponible pour comparer (voir [Rendu pixel](#rendu-pixel-design-v1)).

## Lancer

```bash
npm install          # .npmrc active legacy-peer-deps (arbre de peer deps de vitest 4 vs npm 10)
npm run dev          # http://localhost:5173
npm test             # 316 tests : déterminisme, rollback, physique, réseau, garde-fou statique, direction artistique
npm run build        # typecheck + build de prod dans dist/
```

Stack : TypeScript, Vite 7, PixiJS 8 (WebGL forcé), Web Audio API native. Aucun asset : sons synthétisés, pixel art calculé en code (le moteur des planches), polices DotGothic16 et Zen Kaku Gothic New (Google Fonts, repli en police système hors ligne).

## Architecture : trois couches étanches

```
src/sim      SIMULATION  pure, déterministe. step(state, inputs, events) -> state (en place)
src/render   RENDU       lit l'état, interpole entre deux ticks, dessine avec Pixi. Ne modifie rien.
src/io       IO          clavier, souris, manette, audio, réglages. Produit des inputs, consomme des événements.
src/ui       UI DOM      menus, HUD, panneau de debug.
src/app      Orchestration : Game (le seul endroit où les couches se touchent) + GameLoop (accumulateur).
```

- **`src/sim/step.ts`** : un tick = 60 Hz fixe. À l'intérieur : `substeps` sous-pas d'intégration, et pour
  chacun `constraintIterations` passes Gauss-Seidel sur les cordes (PBD, contrainte d'inégalité : la corde
  retient, ne pousse jamais). Vitesse dérivée des positions, collisions cercle/tuiles avec mort au-dessus
  du seuil, pics, ennemis, respawn instantané dans le même tick.
- **Mort au mur** : seuil à 2510 px/s sur la composante normale à l'impact (chute libre de ~55 tuiles),
  juste sous la vitesse max de 2600 px/s : seuls les impacts presque à fond tuent.
  En dessous, on rebondit. Les pics tuent quelle que soit la vitesse.
- **Bas de carte** : le vide sous la carte est un gouffre (`tileAt` renvoie du vide sous la dernière
  rangée) : tomber dedans tue (`void`) et renvoie au spawn. Un **tremplin** (`T`) est un plein non
  accrochable : s'y poser par le dessus fixe `vy = -BOUNCE_SPEED` (1500 px/s, ~19 tuiles de montée),
  jamais mortel même en tombant de très haut, et émet l'événement `bounce` (son, étincelles vertes).
- **Grappin** : par défaut on reste accroché tant que le bouton est maintenu, la corde se rétracte
  automatiquement pendant ce maintien, et relâcher lâche (`holdToAttach`). La rétraction s'arrête à
  120 px de l'ancre (`minRopeLength`, ~4 tuiles) : on reste suspendu sous elle, sans s'y coller. La touche reel dédiée reste
  utilisable mais n'ajoute rien dans ce mode. Suspendu, gauche/droite pompe le balancier (`swingForce`). Le toggle `holdToAttach` à 0 rend le comportement de la spec d'origine
  (maintien = reel, relâcher garde la corde, second appui = lâcher) pour comparer.
- **Inputs** (`src/sim/input.ts`) : `{ buttons: u16 bitfield, aim: u16 }`. L'angle de visée est quantifié sur
  16 bits ; la sim ne voit jamais une coordonnée souris. `packInput()` tient dans un u32.
- **Paramètres** (`src/sim/params.ts`) : tous numériques, **dans l'état** (`state.params`). La sim ne dépend
  donc que de `(state, inputs)`. Le panneau de debug écrit dedans en live.
- **Événements** (`src/sim/events.ts`) : la sim pousse des `SimEvent` dans un tableau, c'est tout. L'audio,
  les particules et le HUD les consomment côté IO. En rollback, seuls les ticks simulés pour la première
  fois émettent vers l'audio (`Game.tick`), une re-simulation n'en rejoue aucun.
- **Snapshot** (`src/sim/snapshot.ts`) : sérialisation binaire complète + hash FNV-1a. `cloneState()` pour
  le ring buffer.
- **Ring buffer** (`src/sim/history.ts`) : 180 ticks (3 s) d'états + inputs. `resimulate(from, to, override)`
  rejoue depuis un tick passé avec des inputs éventuellement corrigés : c'est le rollback, testé.
- **Boucle** (`src/app/gameLoop.ts`) : accumulateur, rendu découplé avec alpha d'interpolation. La pause
  gèle l'accumulation sans la corrompre ; à la reprise la première frame a dt = 0, aucun bond. Onglet
  masqué = pause automatique.

## Déterminisme : les règles

1. Dans `src/sim`, seuls `+ - * /` et `Math.sqrt` (correctement arrondis par IEEE 754), plus
   `floor/abs/min/max/imul`. **Interdits** : `Math.sin/cos/tan/atan2/pow/exp/log/hypot/random`, `**`,
   `Date`, `performance`, `Map/Set`, DOM. Le test `test/no-forbidden-math.test.ts` scanne les sources et
   échoue si l'un d'eux apparaît.
2. L'angle 16 bits est converti en vecteur unitaire par réduction de quadrant + polynômes de Taylor
   (`dirFromAngle16`, erreur < 1e-9, testé contre `Math.cos/sin` côté test uniquement).
3. PRNG mulberry32 dans l'état (`state.rng`), seed affichée et modifiable dans le debug.
4. Itération sur des tableaux indexés uniquement, ordre fixe : joueurs, puis grappins 0/1, puis ennemis.
5. Aucune valeur ne dépend du deltaTime réel : le loop ne fait qu'appeler `step` N fois.

Vérification cross-navigateur : bouton **Auto-test 1000 ticks** du panneau de debug. Il rejoue un
scénario scripté et affiche un hash. Le hash de référence est `6e7bd88d` (test `empreinte de référence`,
identique sous Node/V8 et dans Chromium). Lance-le dans Firefox et Safari : il doit être identique. Si tu
modifies la physique, mets à jour `GOLDEN_HASH` dans `test/determinism.test.ts` dans le même commit.

Coût mesuré : ~7 µs par tick pour 2 joueurs (4 sous-pas × 6 itérations) sous Node. Une re-simulation de
60 ticks coûte < 1 ms : large marge pour un rollback réseau.

## Contrôles

| Action | Clavier / souris (défaut) | Manette (mapping standard) |
|---|---|---|
| Grappin gauche (maintenir = accroché + rétraction auto, relâcher = lâcher) | Clic gauche | LB / L1 |
| Grappin droit | Clic droit | RB / R1 |
| Reel : rétracte toutes les cordes accrochées (redondant avec la rétraction auto) | Z (touche physique W) ou flèche haut | Stick gauche vers le haut, croix haut |
| Jetpack (orienté vers le curseur / stick droit) | Espace ou Maj gauche | RT / R2 |
| Marche (ridiculement lente) ; suspendu : pompe le balancier | Q / D (touches physiques A/D, donc Q/D sur AZERTY) | Stick gauche, croix |
| Grab / cut manuel | E | A / ✕ (ou X / □) |
| Pause : continuer, recommencer, quitter au menu | Échap | Start / Options |
| Recommencer (mode course) : repart de zéro, chrono compris, en jeu comme à l'arrivée | R | Select / Share |

Tout est remappable dans **Paramètres › Contrôles** (clavier et manette). Les touches sont identifiées par
`KeyboardEvent.code` (position physique) ; le libellé affiché utilise la disposition réelle quand le
navigateur expose `navigator.keyboard.getLayoutMap()` (Chrome).

Manette : la Gamepad API ne liste une manette qu'après un premier appui, le HUD et les menus affichent
« appuie sur un bouton ». Les manettes non « standard » gardent le mapping par défaut en meilleur effort
et un avertissement invite à remapper. Deadzone radiale de 0.18 avec remise à l'échelle.

Raccourcis debug : **F1** outils de debug (les affiche s'ils sont masqués), **F2** mode caméra, **F3** hitboxes, **F4** vecteurs de vélocité, **F6** trail, **F8** mode de rendu (Jeu, Valeurs, Couche de jeu, Grey-box).

## Multijoueur en ligne (sessions à code)

```bash
npm run server     # relais de sessions, ws://localhost:8787
npm run dev        # le jeu (ajoute -- --host pour jouer depuis une autre machine du réseau)
```

**Menu → Multijoueur en ligne.** Un joueur héberge : le relais lui donne un code de 6 caractères
(alphabet sans O/0 ni I/1). L'autre saisit le code et rejoint. Dès que les deux sont là, la partie
démarre toute seule à 2 joueurs.

- `server/index.mjs` : le relais **ne simule rien**. Il crée un code, apparie deux sockets et relaie
  des enveloppes opaques. Le netcode est entièrement côté client.
- **Rollback** (`src/net/netPlay.ts`) : chacun joue son propre input avec `INPUT_DELAY` = 3 ticks de
  retard (le temps qu'il parte chez l'autre). Si l'input distant du tick T manque, on **prédit** (on
  répète le dernier connu) et on avance. Quand le vrai input arrive et contredit la prédiction, on
  **rollback** : retour à l'état du tick fautif (ring buffer de 180 ticks), re-simulation jusqu'au
  présent avec les bons inputs, historique réécrit au passage. Au-delà de `MAX_PREDICTION` = 10 ticks
  sans nouvelle du pair, on **stalle** au lieu de prédire dans le vide : c'est ce qui resynchronise
  les deux machines au démarrage.
- L'état courant affiché est donc **spéculatif**. Ce qui est garanti identique des deux côtés, c'est
  l'état à un tick dont les deux machines ont tous les inputs confirmés : c'est exactement ce que
  vérifie `test/netcode.test.ts`.
- **La config vient de l'hôte** : seed, carte et params sont envoyés à l'invité à l'arrivée.
- **Params en cours de partie : datés, décidés par l'hôte.** Les params font partie de l'état simulé,
  donc un changement ne peut pas être immédiat : il prendrait effet à des ticks différents sur les
  deux machines et les ferait diverger. L'hôte diffuse donc *« ces params, au tick T »* avec
  `PARAM_SYNC_DELAY` = 20 ticks (~330 ms) d'avance ; les deux sims l'appliquent exactement au tick T,
  en live **comme en re-simulation** (un rollback qui traverse T réapplique le changement au bon
  endroit). Si l'ordre arrive alors que l'invité a déjà dépassé T, il rollback jusqu'à T pour rejouer
  ces ticks avec les bons params ; s'il est plus vieux que l'historique (3 s), le changement est
  quand même planifié et le compteur `paramsTooLate` du panneau signale la désync possible.
- Côté invité, les sliders et toggles de sim sont **verrouillés** et l'onglet BUILDS refuse
  d'appliquer : c'est l'hôte qui applique, pour les deux. Le panneau affiche le rôle et le tick du
  prochain changement.
- Changer de serveur : champ **Serveur** de l'écran multijoueur (persisté). Par défaut : le relais fixé
  au build par `VITE_NET_URL` s'il y en a un, sinon le même hôte que la page sur le port 8787 (rien à
  configurer en LAN).

### Sur un site déployé (Vercel)

Le site du jeu ne sert que des fichiers statiques. Vercel ne fait pas tourner le relais, qui doit
garder des WebSockets ouvertes : il s'héberge **à part**, sur un service qui les accepte.

1. **Render** (offre gratuite) : New → Blueprint → ce dépôt. `render.yaml` crée le service
   `tsj-relais` (branche `main`, `node server/index.mjs`, contrôle de santé sur `/`). L'adresse du
   service ouverte dans un navigateur doit afficher « Relais Turbo Samouraï Jetpack : OK ».
2. **Vercel** : Settings → Environment Variables → `VITE_NET_URL` = `wss://tsj-relais.onrender.com`
   (l'adresse du service, sans port). Le nom compte : Vite ne transmet au jeu que les variables en
   `VITE_`. Un copier-coller en `https://`, avec ou sans `/` final, est converti en `wss://`. Il faut
   ensuite redéployer : Vite inscrit la valeur dans le build. Les navigateurs suivent le relais du
   build (ancien défaut « même hôte, port 8787 » ou adresse mal saisie puis corrigée) ; seule une
   adresse tapée à la main dans le champ **Serveur** est gardée. Vider ce champ revient au relais du
   build.

Le relais gratuit de Render se met en veille après 15 minutes sans connexion. La connexion suivante le
réveille, en une minute environ : il suffit de réessayer. N'importe quel hébergeur Node qui accepte les
WebSockets convient aussi (Fly.io, Railway, un VPS). Il fournit `PORT`, que le relais écoute.

Ce qui manque pour un vrai jeu en ligne : la reconnexion après coupure et la détection de désync
(comparaison périodique de hash).

## Menus

Lancer une partie tient en deux choix. Le **menu principal** propose les deux modes en grand,
**Course** (atteindre l'arrivée le plus vite possible) et **Arcade** (éliminer tous les ennemis de la
carte), plus Multijoueur en ligne et Paramètres. Chaque mode ouvre la liste de ses cartes, avec le
choix 1 ou 2 joueurs : une carte = une partie. Le focus est toujours sur le dernier choix (le mode
joué en dernier, puis sa carte) : pour rejouer, Entrée, Entrée.

- **Échap** en partie : Continuer, Recommencer, Quitter au menu.
- **R** en course : repart de zéro, chrono compris, sans carton-titre (il ne s'affiche qu'en arrivant
  sur une carte). Le HUD le rappelle en bas à droite ; en arcade, on recommence depuis la pause.
- **Paramètres** : volumes, caméra à deux joueurs, plein écran, Contrôles (remapping, périphérique de
  chaque joueur), et les **outils de debug**, masqués par défaut.
- À l'arrivée (ou quand le dernier ennemi tombe), l'écran de fin propose Recommencer, Changer de
  carte (la liste du même mode), Continuer à jouer et Quitter au menu.

## Multijoueur local

- 1 ou 2 joueurs (écran Course ou Arcade, ou panneau de debug). Assignation joueur → périphérique explicite
  (`settings.devices`), inversable, un seul joueur peut être sur clavier+souris.
- Deux caméras à comparer, basculables à chaud (F2, réglages, debug) : **unique** englobant les deux joueurs
  avec zoom dynamique borné (zoom min/max, marge, lissage réglables), ou **split vertical**.
- La sim ne lit jamais un périphérique : `InputMapper` produit les `PlayerInput`, c'est le seul point à
  remplacer par une couche réseau.

## Panneaux latéraux (DEBUG · CARTES · BUILDS)

Trois onglets verticaux à droite, même style, un seul panneau ouvert à la fois. **Masqués par
défaut**, avec les mesures du HUD (fps, ticks, rendu) : **Paramètres › Outils de debug** les affiche,
ou **F1** (DEBUG), **F5** (CARTES), **F7** (BUILDS). Recliquer sur l'onglet actif referme. L'onglet
ouvert et l'affichage des outils sont persistés.

**CARTES** (`src/ui/mapPanel.ts`) : les 6 cartes avec un **aperçu** dessiné (minimap 1 px par
tuile : murs, surfaces lisses, pics, tremplins, spawn, ennemis), la taille, et un bouton **Appliquer** qui
relance la partie sur cette carte sans passer par le menu. C'est le sélecteur *en partie* ; les
écrans **Course** et **Arcade** du menu choisissent avant de lancer.

**BUILDS** (`src/ui/buildPanel.ts`, `src/io/buildsStore.ts`) : un *build* est une photo nommée et
annotée des paramètres de sim, pour comparer des réglages de feel. On sauvegarde les params courants
sous un nom + une note, on renomme et on réécrit la note à tout moment, **Appliquer** les remet tous
d'un coup, **Mettre à jour** écrase le build avec les params courants. En ligne, appliquer un build
depuis l'hôte l'applique **chez les deux joueurs** au même tick (voir la section multijoueur) ;
l'invité, lui, ne peut qu'en prendre note. Chaque carte affiche son écart
aux params courants (« 3 params d'écart » / « identique aux params actuels »), ce qui permet de
retrouver où on en est après avoir bougé des sliders. Persisté en localStorage (`tsj.builds.v1`,
64 builds max), assaini au chargement : un build d'une version antérieure ou corrompu est borné aux
plages de `PARAM_META` plutôt que rejeté. Appliquer un build est refusé pendant une partie en ligne
(les params y sont figés).

## Panneau de debug

Sliders + champ numérique pour : gravité, vitesse de marche, vitesse du projectile de grappin, longueur max (420 px par défaut : debout au sol, la rangée d'ancrages du bas est atteignable sans sauter),
vitesse de reel, raideur de corde, amortissement du pendule, force du jetpack, chauffe, refroidissement,
friction de l'air, vitesse max, seuil de mort au mur, seuil de kill d'ennemi, masse, sous-itérations de
contrainte, sous-pas d'intégration, et quelques extras (pompage du balancier, conservation du moment angulaire au reel,
longueur mini de corde (120 px), friction au sol, PV, fenêtres du cut manuel, respawn ennemi).

Toggles : ennemis, ennemis létaux, cut auto/manuel, maintien = accroché, 1/2 joueurs, mode caméra, hitboxes, vecteurs, trail.

En tête du panneau, la section **Rendu** règle le mode (Jeu, Valeurs, Couche de jeu, Grey-box), le thème
(auto ou forcé) et les pixels entiers. Elle affiche aussi le nuancier du thème affiché et les chronos du
rendu pixel et de la cuisson.

Persistance localStorage (`tsj.params.v1`, `tsj.settings.v1`). **Exporter JSON** télécharge et copie une
config complète (params + seed + options de rendu), **Importer JSON** l'applique. Les params
s'appliquent en live, la seed au prochain redémarrage.

Boutons **Test rollback** (rewind 60 ticks + re-sim, compare le hash au live) et **Auto-test 1000 ticks**.

## Les niveaux

`src/sim/level.ts`, six tableaux de lignes en haut du fichier (tuiles de 32 px), éditables à la main :

```
#  mur plein accrochable      =  mur plein NON accrochable (le grappin échoue)
^  pics (mort quelle que soit la vitesse)    T  tremplin (relance vers le haut)
.  vide (ouvert jusqu'en bas : gouffre)      S  spawn      F  arrivée (course)
e  ennemi statique            p  ennemi en patrouille lente
```

Deux familles de trois cartes (**Facile**, **Difficile**, **Horrible**), distinguées par `level.mode` et
regroupées dans le menu comme dans l'onglet CARTES. Un thème par difficulté : port, bambouseraie, forge.

**Arcade** (`mode: 'kills'`) : arènes hautes et symétriques, vider le stock d'ennemis termine la manche.

| Carte | Taille | Idée |
|---|---|---|
| **Facile** · Le port | 96 × 60 | Deux entrepôts (on démarre sous le hall), une grue au centre, balcons et quais. Un seul tapis de pics, deux tremplins. 6 ennemis. |
| **Difficile** · La bambouseraie | 104 × 64 | Colonnes de bambou lisses à nœuds accrochables, gouffre central sous un pont suspendu, pagode sous le plafond. 9 ennemis. |
| **Horrible** · La forge | 110 × 68 | Douves de pics et de vide, deux îlots-tremplins, donjon lisse à halls traversants, tours de guet à alcôves, crochets minuscules. 9 ennemis. |

**Course** (`mode: 'race'`) : cartes longues, il faut atteindre l'**arrivée** (colonne `F` qui barre toute
la hauteur, tout à droite). La toucher fige le chrono. Chaque carte enchaîne des sections à plusieurs voies :

- **Pont** : voie basse sous le tablier (plafond accrochable, sol piégé), voie haute entre le tablier et un
  toit, voie des toits sous des contrepoids suspendus. Un tremplin à l'entrée lance vers la voie haute.
- **Tour** crénelée du sol à k=30 : par-dessus (champ de tremplins, ancrages d'approche) ou par la porte
  (facile) / une chatière piégée (difficile).
- **Slalom** : stalactites et stalagmites alternées ; chaque stalactite est percée d'une fenêtre, la ligne
  droite pour qui ose.
- **Tunnel** : trois voies superposées (dessous, dedans, au-dessus).
- **Gouffre** : plus de sol, des îlots-tremplins et des contrepoids petits et espacés.

| Carte | Taille | Enchaînement |
|---|---|---|
| **Facile** | 300 × 48 | Départ, pont, tour (porte ouverte), slalom, tunnel, arrivée. Presque aucun piège. |
| **Difficile** | 340 × 48 | Départ, slalom, gouffre (pics), pont, tour, tunnel. Plafonds et faces lisses par tronçons. |
| **Horrible** | 380 × 48 | Départ, tunnel, gouffre (vide), slalom, tour, pont, gouffre. Le sol tue presque partout. |

Sélecteur de carte avant partie dans les écrans **Course** et **Arcade** du menu, et en partie dans
l'onglet **CARTES** (F5).
Le choix est persisté (`settings.levelId`) et la sim référence le niveau par `state.levelId`.

Règles de level design, vérifiées par `test/levels.test.ts` :

1. **Le bas est plat** (rangées H-2 et H-1), sans cave : du sol surtout, et par tronçons des pics, du vide
   (colonne ouverte jusqu'en bas) ou des tremplins. Pics et vide tuent : retour au début de la carte.
2. **La difficulté monte par la part de sol mortel** : 9 / 22 / 76 % en arcade, 3 / 26 / 40 % en course.
   S'y ajoutent l'espacement et la largeur des ancrages et les surfaces lisses (`=`).
3. **Debout au sol, un ancrage est à portée** (12 tuiles au plus au-dessus, grappin 420 px), et depuis le
   spawn il y en a toujours un dans le cône vers le haut. Couverture mesurée en visant droit en haut
   depuis le sol : 74 / 33 / 15 % en arcade, 48 / 29 / 17 % en course.
4. Pics et tremplins reposent sur du plein, les tremplins ont de l'air au-dessus, les ennemis sont posés
   sur du sol et jamais entre deux créneaux.

Faisabilité : chaque carte a été jouée par un bot d'exploration (Go-Explore) branché sur la vraie sim.
Il finit les trois courses (13 à 23 s de jeu sur sa meilleure trajectoire) et nettoie chaque arène
d'arcade en une seule partie.

## Éditeur de niveaux

**Menu → Éditeur de niveaux.** Une vue plein écran (DOM + canvas 2D, `src/editor/`) pour dessiner
ses cartes, les tester dans le vrai jeu et les exporter vers `level.ts`.

| Action | Commande |
|---|---|
| Peindre / gommer | clic gauche / clic droit |
| Tuiles | `1` mur accrochable, `2` lisse, `3` pics, `4` tremplin, `5` vide, `6` spawn (unique), `7` ennemi, `8` patrouille, `9` arrivée |
| Outils | `B` pinceau, `R` rectangle, `L` ligne, `G` remplissage, `I` pipette, `M` sélection, `P` presets |
| Sélection | glisser pour sélectionner, glisser dedans pour déplacer ; `Ctrl+C` / `Ctrl+X` / `Ctrl+V` (le collage suit la souris, clic pour poser), `Suppr` vide, `Ctrl+A` tout |
| Annuler / refaire | `Ctrl+Z` / `Ctrl+Y` (ou `Ctrl+Maj+Z`), 200 niveaux |
| Vue | molette : zoom sur le curseur ; clic milieu ou `Espace` + glisser : déplacer ; flèches ; `+` / `-` ; `0` : cadrer ; `Maj` + molette : défiler |
| Tester | `T` ou **▶ Tester** : la carte se lance dans le jeu (1 ou 2 joueurs locaux, thème choisi) ; **Pause → Retour à l'éditeur** revient exactement où on était |

**Presets** (`src/editor/presets.ts`, paramétrables dans le panneau de droite, aperçu fantôme, `R` ou
clic droit pour le miroir) : lanterne, contrepoids (la tige monte jusqu'au plafond), plateforme, balcon
mural, tour crénelée (descend jusqu'au sol), stalactite, stalagmite, dents de slalom, champ de
tremplins, tronçon de sol (sol, pics, gouffre ou tremplins, toujours posé en bas), ennemi sur
plateforme, pont à deux voies, rampe. Ce sont les briques des cartes officielles.

**Réglages de carte** (barre du haut) : nom, mode (arcade / course), thème, largeur × hauteur
(**Taille** redimensionne en gardant le contenu calé en bas à gauche : le sol reste le sol, les bords
sont recréés). Une nouvelle carte part d'un gabarit déjà jouable.

**Vérification en direct** : les règles de `src/sim/levelRules.ts` (les mêmes que celles que
`test/levels.test.ts` exige des cartes officielles). Rouge = bloquant (pas de spawn, course sans
arrivée, arcade sans ennemi : le test est refusé) ; doré = conseil de design (bords, bas plat, pics ou
tremplins dans le vide, ennemi flottant, pas d'ancrage à portée du spawn…). Un clic centre la vue sur
la tuile fautive ; « Ajouter l'arrivée » répare une course sans arrivée.

**Sauvegarde** : automatique, dans le navigateur (`localStorage`, clé `tsj.editor.maps.v1`). **Mes
cartes** : ouvrir, renommer, dupliquer, supprimer (confirmation dans la fenêtre), nouvelle arène ou
course, ou partir d'une **copie d'une carte officielle**.

**Export / import** : **Exporter** donne la carte au format de `level.ts` (une constante `MAP_…` et
l'entrée de `LEVEL_DEFS` en commentaire) ; la coller dans `src/sim/level.ts` en fait une carte
officielle (penser au thème dans `LEVEL_THEMES`). **Importer** accepte cet export, un bloc copié de
`level.ts` ou les lignes brutes de la carte.

Côté sim, la carte testée occupe l'emplacement `CUSTOM_LEVEL_ID` (200, `setCustomLevel`) : `getLevel`
la renvoie, mais `clampLevelId` l'ignore, donc elle n'est jamais enregistrée comme carte choisie ni
envoyée à un pair. **Carte perso = jeu local uniquement** : le multijoueur en ligne joue les cartes
officielles.

## Objectif, compteur d'ennemis et chrono

Le compteur et la condition de fin vivent **dans la sim** (`state.kills`, `state.finished`,
`state.finishTick`, `player.kills`) : ils sont donc déterministes, sérialisés dans le snapshot, et
synchronisés en réseau sans une ligne de code de plus.

L'objectif dépend du **mode de la carte** : une carte `race` se termine en franchissant l'arrivée
(quel que soit le compteur d'ennemis), une carte `kills` en vidant le stock. Le HUD affiche la
progression (`🏁 62 % · 84 tuiles restantes`) ou le stock restant selon le cas.

- **Stock fini** (défaut, cartes d'arcade) : les ennemis tués ne reviennent pas. Le HUD affiche `⚔ tués / total ·
  N restants`. Quand le dernier tombe, la sim émet `levelComplete` et **fige le chrono** sur
  `finishTick` ; le jeu passe en phase **`complete`** : la boucle se gèle et l'écran de fin s'ouvre
  avec le temps, le nombre d'ennemis, le détail par joueur et quatre actions — **Recommencer le
  niveau**, **Changer de carte**, **Continuer à jouer** (rend la main sur le niveau terminé, le
  chrono restant figé) et **Quitter**. L'écran n'est proposé qu'une fois par manche.
- **Ennemis illimités** (toggle du panneau DEBUG) : ils respawnent après `enemyRespawnTicks` et le
  compteur monte sans fin — pas de fin de niveau, c'est le mode score attack. Le HUD affiche
  `⚔ N · ennemis illimités`.
- Cocher le toggle **en cours de partie** remet les morts en file de respawn ; sur un niveau déjà
  terminé, non (la manche est finie, le chrono reste figé).
- Le chrono global tourne depuis le tick 0 de la manche. Chaque joueur garde en plus son chrono
  depuis son dernier respawn, ses morts (☠) et ses kills (⚔).

En ligne, le toggle est un param : il est donc **contrôlé par l'hôte** et daté comme les autres.
`state.finished` étant déterministe, les deux machines atteignent la fin **au même tick** et ouvrent
l'écran de fin ensemble. Recommencer et changer de carte y sont réservés à l'hôte : il diffuse un
ordre `restart` et les deux sims repartent au tick 0. Chaque manche porte un **numéro de génération**
transporté par les messages d'inputs et de params : les messages de la manche précédente encore en
vol sont jetés, sinon un input périmé resterait « confirmé » sur le même slot de tick et serait
rejoué à la place du vrai une minute plus tard.

## Son

Tout est synthétisé dans `src/io/audio/sfx.ts` (oscillateurs, bruit blanc généré en code, filtres,
enveloppes). One-shots : tir, accroche, échec, détache, surchauffe, impact mortel, kill d'ennemi, dégâts,
respawn, atterrissage, menu. Le « clac » d'accroche (et le bruit sourd d'un raté) est retardé du temps
de vol du grappin à l'écran (35 à 140 ms selon la distance) pour tomber avec l'image. Boucles : reel et
jetpack (volume et filtre liés à la poussée et à la chauffe). Le reel est une corde qui s'enroule : un
frottement de bruit filtré (rien sous 500 Hz, aucun oscillateur tonal) battu par un cliquet doux de
bobine. Son volume, sa brillance et la cadence du cliquet suivent la vitesse de rétraction réelle du
tick : discret, et muet dès que la corde est rentrée à fond ou bloquée (l'ancien ronflement de corde
rentrée a disparu). L'AudioContext est débloqué au premier clic ou à la
première touche.

## Tests

- `test/determinism.test.ts` : deux runs identiques, découpage temporel indifférent, empreinte de référence, coût par tick.
- `test/snapshot.test.ts` : identité sérialisation, clone complet, reprise depuis snapshot, rollback 60 ticks, input corrigé.
- `test/physics.test.ts` : accroche et contrainte, rétraction auto/relâche/détache, chauffe et reprise, mort au mur
  au-dessus du seuil seulement, ennemis (kill traversant vs repoussée), tremplin (relance, jamais mortel),
  gouffre (mort `void`, retour au spawn).
- `test/levels.test.ts` : 3 + 3 cartes dans l'ordre, bords pleins, bas plat (sol, pics, tremplins ou
  gouffre ouvert), part de sol mortel croissante avec la difficulté, spawn au sol loin des dangers,
  ancrages atteignables depuis le sol et le spawn, pics et tremplins posés sur du plein, ennemis sur du
  sol, arrivée présente, lointaine et pleine hauteur sur les seules cartes de course. Les règles
  structurelles passent par `validateRows` (`src/sim/levelRules.ts`), le module que l'éditeur affiche.
- `test/editor.test.ts` : outils de grille (rectangle, ligne, remplissage, spawn unique, copier-coller),
  annuler/refaire, redimensionnement, gabarits valides, chaque preset (dans la grille, miroir compris),
  export/import aller-retour, règles de validation, carte perso jouable sur `CUSTOM_LEVEL_ID` et thème
  auto de l'éditeur.
- `test/netcode.test.ts` : deux `Game` complets reliés par un lien simulé (latence, gigue), les états
  confirmés convergent, le rollback se déclenche vraiment, l'input local est figé par tick, un
  changement de params de l'hôte s'applique au même tick des deux côtés (y compris quand l'ordre
  arrive en retard et force un rollback), l'invité ne peut changer ni les params ni la manche seul,
  et une manche relancée par l'hôte converge sans reliquat de la précédente.
- `test/server.test.ts` : le vrai relais est lancé en sous-process — code valide, appariement, relais
  d'enveloppe, départ d'un pair, code inconnu, session pleine, version refusée.
- `test/builds.test.ts` : sauvegarde/renommage/note, indépendance vis-à-vis des params courants,
  assainissement d'un build corrompu, persistance, bornes, fonctionnement sans localStorage.
- `test/objective.test.ts` : franchissement de l'arrivée (et non-franchissement à côté), chrono figé,
  indépendance entre kills et fin de course, comptage par joueur et global, absence de respawn en stock fini, fin de
  niveau au bon tick avec chrono figé, respawn et compteur sans fin en illimité, bascule du toggle en
  cours de partie, sérialisation des compteurs, texte d'objectif.
- `test/gameFlow.test.ts` : bascule en phase `complete` et gel de la boucle, recommencer, changer de
  carte depuis l'écran de fin, « continuer à jouer » sans réinitialiser, non-réouverture de l'écran.
- `test/quickStart.test.ts` : R en course repart de zéro (en jeu comme à l'arrivée), sans effet en
  arcade ni en pause ; les deux modes du menu ; outils de debug masqués par défaut ; rappel de la
  bonne touche dans le HUD (clavier ou manette).
- `test/art.test.ts` : la direction artistique, sous Node. Il couvre le moteur pixel (format des couleurs,
  alpha des calques, double contour, particules), l'attribution des thèmes et l'analyse des 6 cartes.
  Pour chaque thème et chaque carte, il vérifie les règles des planches :
  - la couche de jeu colle aux collisions : rien hors des tuiles pleines, chaque tuile pleine peinte ;
  - les tuiles accrochables exposées ont une arête claire, et les tuiles lisses des reflets froids ;
  - les pointes sont rouges et chaque danger ressort de son sol ;
  - aucune teinte des joueurs n'apparaît dans le décor, et le décor arrière reste sombre ;
  - les accessoires restent dans la carte ;
  - chaque tremplin a son plateau vert, et l'abîme noircit vers le bord des gouffres.

  S'y ajoutent le pantin (pieds posés, teintes réservées, deux cordes, écharpe stable à pleine vitesse),
  l'animation des cordes (vol à la vitesse des planches, étincelles à l'arrivée, retour d'un raté, corde
  lâchée qui rentre, recalage sur la sim après une mort ou un rollback, « clac » calé sur le vol dessiné),
  la corde physique (droite tendue, chaînette avec du mou, inertie, pose sur les tuiles, retour dans la
  main, figée en pause, mou pris dans la sim, trait pixel perfect) et la planche de l'ashigaru.
- `test/math.test.ts`, `test/no-forbidden-math.test.ts`.

## Direction artistique (planches)

`design/planches/index.html` : premier jet de DA en pixel art animé, en dehors du jeu. Trois niveaux (Port
d'Umibozu, Forteresse de braise, Bambouseraie maudite) et un gros plan du samouraï, rendus en direct en
640 × 360 sur canvas. Sous chaque planche, le mode **Valeurs** (niveaux de gris) et le mode **Couche de jeu**
(décor coupé) servent à vérifier que le perso reste lisible. Ouvrir le fichier dans un navigateur suffit,
aucun build. Tout est procédural : ça valide la direction et le mouvement, pas le rendu final. Le jeu
implémente désormais cette direction (section suivante) ; les planches restent la référence.

## Rendu pixel (Design V1)

Le jeu dessine la direction artistique des planches avec leur propre moteur, porté en TypeScript :
`src/render/pixel/engine.ts` (framebuffer 32 bits, primitives entières, tramage Bayer, bruit, contour
automatique) et `kit.ts` (bois, pierre, surfaces lisses, pieux, bannières, lanternes, nuages), à
l'identique de `design/planches/engine.js` et `kit.js`. Aucun fichier image.

**Chaîne de rendu** (`src/render/art/`)

- Chaque vue est rendue dans une RenderTexture **à la résolution de l'art** : 1 px d'art = 2 px monde,
  une tuile = 16 px d'art, la densité exacte des planches. La caméra est calée au pixel d'art, comme dans
  les planches, puis `PixelQuad` agrandit l'image à l'écran en « sharp bilinear » : chaque pixel d'art
  reste un bloc net, seuls ses bords sont lissés sur un pixel écran. Le reste sous-pixel de la caméra est
  passé au quad : le défilement reste fluide. Le mode Valeurs est appliqué dans ce même shader.
- Zoom solo par défaut à 1,25 (2,5 px écran par px d'art). L'option **Pixels entiers** cale les zooms
  fixes (solo, split) sur le nombre entier de pixels écran par pixel d'art le plus proche. Pour le zoom
  solo, cela donne 3 px sur un écran à 100 % (zoom effectif 1,5), 3 px à 125 % (1,2), 4 px à 150 %
  (1,33) et 5 px à 200 % (1,25). Le zoom dynamique à deux joueurs reste continu (au plus 0,9), et le
  « sharp bilinear » évite le scintillement.
- `ArtWorld`, partagé entre les vues : cuisson de la carte par le peintre du thème en quatre calques
  découpés en tuiles de texture de 512 px (décor arrière, tuiles de jeu, dangers, décor avant), pantins,
  particules, planche de sprites de l'ashigaru. `ArtView`, une par viewport : couches, parallaxe,
  accessoires animés, cordes, particules. Ordre : fond du thème, décor arrière, accessoires, tuiles,
  brumes du thème, dangers, traînée, ennemis, halo, cordes, joueurs, particules, décor avant, premier
  plan du thème (pluie, braises : ils s'écartent du perso).
- Événements de la sim (accroche, échec, mort, kill, coup, atterrissage, surchauffe, fin de niveau) :
  étincelles, éclats, coup de lame, poussière, fumée. Les débris retombent et se couchent sur les tuiles.

**Le samouraï** (`hero.ts`) : le pantin des planches, redessiné pixel par pixel à chaque frame depuis son
squelette, mais piloté par l'état de la sim (position interpolée, vitesse, deux grappins, chauffe, sol,
visée) au lieu de son contrôleur automatique. Ajouts : une main par corde, marche en tongs, glissade au sol
au-delà de 100 px/s, réception, points de visée dans la teinte du joueur, pieds posés (le dessin remonte en
continu quand le sol approche). Écharpe en chaîne verlet (sous-échantillonnée à grande vitesse), retard des
jambes, genoux, clignements, liseré dans la lumière du niveau, double contour : tout reste côté rendu, le
déterminisme n'est pas touché. Le perso fait près de deux tuiles de haut pour une hitbox de 0,7 tuile
(rayon 11 px) : la hitbox couvre son bassin et ses jambes. Les planches suggéraient d'essayer un rayon de
14 px ; c'est un réglage de gameplay (`playerRadius`, panneau DEBUG), il n'est pas changé ici.

**Les cordes** (`ropeFx.ts`, dessinées au pixel près par `ArtView`) : l'animation de `design/planches`.
Le grappin vole de la main jusqu'à l'ancre à 1700 px d'art/s, pointe blanche et pixel de traîne, et
fait des étincelles en arrivant. Accrochée, la corde est en chanvre, prend la teinte du joueur tant
qu'elle raccourcit vraiment (rentrée à 120 px, elle redevient chanvre), et sa pointe clignote sur
l'ancre. Deux gestes absents des planches : un raté file jusqu'au point touché, fait un éclat terne et
revient ; une corde lâchée rentre dans la main. La sim accroche dès le tick du tir : l'envol (35 à
140 ms) est purement visuel, et l'état de la sim fait foi (mort, respawn ou rollback : aucune corde
fantôme).

**Une vraie corde** (`ropeChain.ts`) : à l'écran, la corde est une chaîne de 25 points simulée (PBD :
gravité, inertie, frottement de l'air, 2 sous-pas par frame à 60 Hz), tenue à la main et au grappin. Côté
rendu seulement : la corde de la sim reste rigide et déterministe.

- Tendue (la sim tire), elle est droite, exactement comme la contrainte de la sim.
- Avec du mou, elle pend en chaînette, traîne derrière le perso, se tord et fait des boucles quand il
  bouge, puis se calme. Le mou vient de la sim (sa corde part du centre du perso) : la main, plus près
  ou plus loin de l'ancre selon le bras, n'en invente pas.
- Comme une vraie corde, elle ne résiste qu'à l'étirement : comprimée, elle plie ou s'entasse. Molle,
  elle se pose sur les tuiles (sol, corniches) au lieu de les traverser, et traîne au sol si le perso
  marche. Tendue, elle traverse les murs comme celle de la sim.
- Lâchée, son bout libre suit la corde que la main ravale.
- Tracé au pixel près : un trait d'un pixel d'un seul tenant, sans « coins en L ».

Quatre cordes molles posées au sol coûtent environ 0,1 ms par frame.

**Teintes réservées** : cyan #4fd1ff pour le J1 (comme dans le proto), rose #ff6ec7 pour le J2. L'orange du
proto se noyait dans la forteresse et dans toutes les lanternes. Aucun décor ne les emploie : c'est testé.

**Grammaire commune** à tous les thèmes, habillée différemment : arête claire = accrochable (`#`), reflets
obliques froids = lisse (`=`), pointe rouge = mortel (`^`), masque blanc = ennemi. Le décor reste dans les
valeurs sombres ; seuls le perso, les arêtes accrochables et les dangers touchent les extrêmes. Un effet
ne cache jamais un danger, et ce qui passe devant s'écarte du perso.

**Thèmes** (`src/render/art/themes/`). Chaque niveau des planches est devenu un thème capable d'habiller
n'importe quelle carte. Il se compose d'un peintre pur (`paint.ts`, testé sous Node), qui cuit les calques à
partir de l'analyse de la carte (`levelShape.ts` : régions, faces exposées, sol principal, tremplins, gouffres, blocs
flottants, pics, arrivée), et d'un runtime Pixi par vue (`runtime.ts` : fond vivant, parallaxe
horizontale et verticale, météo).

| Thème | Cartes (auto) | Accrochable | Lisse | Mortel | Fond vivant |
|---|---|---|---|---|---|
| **Port d'Umibozu** | Facile (arcade, course) | bois : pontons, défenses, solives, poutres de cargaison sur poulies | pierre mouillée | pieux dans l'eau noire | orage à double éclair, jonques, mouettes, Umibozu qui suit le perso des yeux et frappe l'eau, mer calculée par pixel |
| **Forteresse de braise** | Horrible (arcade, course) | rempart à arêtes chaudes, poutres cerclées et échafaudages pendus à des chaînes | obsidienne à reflets violets | pics de fer sur fosses de lave | volcans et éruptions, oni de basalte, ville et château en feu, flèches enflammées, brume de chaleur (fond seulement) |
| **Bambouseraie maudite** | Difficile (arcade, course) | pierre moussue : linteaux, planches liées aux bambous, kasagi | laque noire | épines | étoiles, lune, ryū de jade, cascade, bambous qui ploient, lucioles, hitodama, brume maudite (sous les épines) |

Tremplins et gouffres sont peints pareil dans tous les thèmes (`themes/floorKit.ts`) : plateau vert sur
ressorts et chevrons qui montent (le vert n'appartient à aucun décor ni joueur), abîme qui noircit devant
les acteurs avec une brume froide. L'arrivée des cartes
chrono est un torii propre à chaque thème, sous un voile de lumière. Le thème se force dans le panneau
(DEBUG, section Rendu). La lave et les fosses ne sont peintes que sur les tuiles `^` : un sol sans pics
reste lisiblement sûr.

**Coût** mesuré en vue 1080p (~960 x 540 px d'art) dans Chrome headless en rendu logiciel, donc majoré :
pantins et particules ~0,5 ms par frame, runtime du thème de 0,8 ms (forteresse) à 1,4 ms (port,
bambouseraie), préparation des couches ~0,1 ms. Cuisson d'une carte : 50 à 180 ms, au chargement ou au
changement de thème. Le panneau affiche ces chronos en direct.

**Ajouter un thème** : un dossier `src/render/art/themes/<id>/` avec `palette.ts`, `paint.ts` et
`painter.ts` purs (aucun import de Pixi), plus `runtime.ts` et `index.ts`, puis l'inscrire dans
`painters.ts` et `index.ts`. `test/art.test.ts` le vérifie aussitôt sur les 6 cartes.

**Modes de rendu** (panneau DEBUG, section Rendu, ou **F8**) : **Jeu** ; **Valeurs** (six niveaux de gris :
le perso doit rester la forme la plus nette) ; **Couche de jeu** (décor coupé, arrivée marquée : ce qui
reste est tout ce qui compte pour jouer) ; **Grey-box** (le rendu vectoriel du proto, pour comparer).

**HUD et menus** : typographie et palette de la page des planches (DotGothic16, Zen Kaku Gothic New),
bloc joueur à bord de sa teinte, vitesse en vert au-dessus du seuil de kill et en rouge au-dessus du seuil
de mort, nom du niveau en or, carton-titre en arrivant sur une carte. Le niveau vit derrière les menus : le décor
continue de s'animer en pause.

## Limites connues de la V1

- Les cordes de la sim traversent les murs (pas d'enroulement autour des coins). À l'écran, seule une
  corde molle se pose sur les tuiles.
- Pas de collision joueur-joueur (seulement la corde entre eux).
- Le feel dépend des valeurs par défaut de `DEFAULT_PARAMS` : elles sont un point de départ, pas un réglage final.
- Le samouraï fait près de deux tuiles de haut pour une hitbox de 0,7 tuile : sa tête peut mordre un
  plafond au contact (le dessin se décale pour l'éviter en vol libre, pas quand il est accroché).
- L'art est procédural : il valide la direction, le mouvement et la lisibilité, pas le rendu final.
  Pour la prod, il faudra un pixel artist, au moins pour le perso, les ennemis et les tuiles.
