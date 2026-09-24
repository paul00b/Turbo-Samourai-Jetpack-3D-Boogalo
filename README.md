# Turbo Samouraï Jetpack : prototype V1

Jeu 2D de mouvement basé sur la physique : un personnage qui marche à peine (tongs), deux grappins
indépendants et un jetpack orientable. La vitesse est l'outil principal et la cause de mort principale.

Cette V1 sert à **valider le feel** et à **poser une architecture déterministe** compatible plus tard
avec leaderboard, replays fantômes et netcode rollback. Pas de contenu, pas de progression, grey-box.

## Lancer

```bash
npm install          # .npmrc active legacy-peer-deps (arbre de peer deps de vitest 4 vs npm 10)
npm run dev          # http://localhost:5173
npm test             # 35 tests : déterminisme, snapshot/rollback, physique, garde-fou statique
npm run build        # typecheck + build de prod dans dist/
```

Stack : TypeScript, Vite 7, PixiJS 8 (WebGL forcé), Web Audio API native. Aucun asset : sons synthétisés, formes vectorielles.

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
- **Mort au mur** : seuil à 1800 px/s sur la composante normale à l'impact (chute libre de ~28 tuiles).
  En dessous, on rebondit. Les pics tuent quelle que soit la vitesse, d'où leur cantonnement à la cave.
- **Grappin** : par défaut on reste accroché tant que le bouton est maintenu, la corde se rétracte
  automatiquement pendant ce maintien, et relâcher lâche (`holdToAttach`). La touche reel dédiée reste
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
scénario scripté et affiche un hash. Le hash de référence est `4a8ef524` (test `empreinte de référence`,
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
| Pause | Échap | Start / Options |

Tout est remappable dans **Contrôles** (clavier et manette). Les touches sont identifiées par
`KeyboardEvent.code` (position physique) ; le libellé affiché utilise la disposition réelle quand le
navigateur expose `navigator.keyboard.getLayoutMap()` (Chrome).

Manette : la Gamepad API ne liste une manette qu'après un premier appui, le HUD et les menus affichent
« appuie sur un bouton ». Les manettes non « standard » gardent le mapping par défaut en meilleur effort
et un avertissement invite à remapper. Deadzone radiale de 0.18 avec remise à l'échelle.

Raccourcis debug : **F1** panneau, **F2** mode caméra, **F3** hitboxes, **F4** vecteurs de vélocité, **F6** trail.

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
- Changer de serveur : champ **Serveur** de l'écran multijoueur (persisté). Par défaut, même hôte que
  la page sur le port 8787, donc rien à configurer en LAN.

Ce qui manque pour un vrai jeu en ligne : la reconnexion après coupure, la détection de désync
(comparaison périodique de hash) et un relais déployé ailleurs que sur ta machine.

## Multijoueur local

- 1 ou 2 joueurs (menu Mode ou panneau de debug). Assignation joueur → périphérique explicite
  (`settings.devices`), inversable, un seul joueur peut être sur clavier+souris.
- Deux caméras à comparer, basculables à chaud (F2, réglages, debug) : **unique** englobant les deux joueurs
  avec zoom dynamique borné (zoom min/max, marge, lissage réglables), ou **split vertical**.
- La sim ne lit jamais un périphérique : `InputMapper` produit les `PlayerInput`, c'est le seul point à
  remplacer par une couche réseau.

## Panneaux latéraux (DEBUG · CARTES · BUILDS)

Trois onglets verticaux à droite, même style, un seul panneau ouvert à la fois. **F1** ouvre DEBUG,
**F5** CARTES, **F7** BUILDS ; recliquer sur l'onglet actif referme. L'onglet ouvert est persisté.

**CARTES** (`src/ui/mapPanel.ts`) : les 4 difficultés avec un **aperçu** dessiné (minimap 1 px par
tuile : murs, surfaces lisses, pics, spawn, ennemis), la taille, et un bouton **Appliquer** qui
relance la partie sur cette carte sans passer par le menu. C'est le sélecteur *en partie* ; le menu
**Jouer → Carte** ne sert plus qu'à choisir avant de lancer.

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
longueur mini de corde, friction au sol, PV, fenêtres du cut manuel, respawn ennemi).

Toggles : ennemis, ennemis létaux, cut auto/manuel, maintien = accroché, 1/2 joueurs, mode caméra, hitboxes, vecteurs, trail.

Persistance localStorage (`tsj.params.v1`, `tsj.settings.v1`). **Exporter JSON** télécharge et copie une
config complète (params + seed + options de rendu), **Importer JSON** l'applique. Les params
s'appliquent en live, la seed au prochain redémarrage.

Boutons **Test rollback** (rewind 60 ticks + re-sim, compare le hash au live) et **Auto-test 1000 ticks**.

## Les niveaux

`src/sim/level.ts`, quatre tableaux de lignes en haut du fichier (tuiles de 32 px), éditables à la main :

```
#  mur plein accrochable      =  mur plein NON accrochable (le grappin échoue)
^  pics (mort quelle que soit la vitesse)      .  vide      S  spawn
e  ennemi statique            p  ennemi en patrouille lente
```

Deux familles, distinguées par `level.mode` et regroupées dans le menu comme dans l'onglet CARTES.

**Élimination** (`mode: 'kills'`) : vider le stock d'ennemis termine la manche.

| Carte | Taille | Idée |
|---|---|---|
| **Facile** · Dojo | 112 × 34 | Trois rangées d'ancrages tous les 9 tuiles, sol continu, zéro pic. |
| **Normale** · Chantier | 132 × 40 | Quatre trous vers la cave, pics au fond de deux d'entre elles, un plafond lisse. |
| **Difficile** · Usine | 144 × 44 | Ancrages tous les 14 tuiles, longs plafonds lisses, piliers lisses, cave piégée, puits de sortie. |
| **Horrible** · Broyeur | 156 × 48 | Ancrages tous les 19 tuiles, plafond lisse quasi partout, cave entièrement piégée. |

**Chrono** (`mode: 'race'`) : cartes longues et horizontales, il faut atteindre l'**arrivée** (tuiles
`F`, zone verte tout à droite). La toucher fige le chrono. Les ennemis n'y sont que des obstacles.

| Carte | Taille | Idée |
|---|---|---|
| **Sprint** | 300 × 26 | Ligne droite, sol continu, ancrages tous les 9 tuiles, aucun piège. |
| **Autoroute** | 360 × 30 | Six trous vers la cave (pics au fond de trois), plafonds lisses : il faut arriver lancé. |
| **Gouffre** | 420 × 34 | Sept trous larges, cave entièrement piégée, ancrages tous les 17 tuiles, piliers lisses. |

Sélecteur de carte avant partie dans **Jouer → Carte**, et en partie dans l'onglet **CARTES** (F5).
Le choix est persisté (`settings.levelId`) et la sim référence le niveau par `state.levelId`.

Trois règles de level design communes, vérifiées par `test/levels.test.ts` :

1. La rangée d'ancrages la plus basse est à 10 tuiles du sol, soit ~272 px : **accrochable debout, sans
   sauter** (le grappin fait 420 px).
2. Les pics ne sont jamais sur la ligne de jeu : ils vivent au fond de la cave, 6 à 8 tuiles sous le sol
   principal. Tomber dans un trou est un détour, pas une mort.
3. La difficulté monte par l'espacement des ancrages et la surface lisse (`=`), pas par les pics. Couverture
   mesurée en visant droit en haut depuis le sol : 51 / 41 / 24 / 20 % en élimination, 31 / 23 / 11 % en chrono.

## Objectif, compteur d'ennemis et chrono

Le compteur et la condition de fin vivent **dans la sim** (`state.kills`, `state.finished`,
`state.finishTick`, `player.kills`) : ils sont donc déterministes, sérialisés dans le snapshot, et
synchronisés en réseau sans une ligne de code de plus.

L'objectif dépend du **mode de la carte** : une carte `race` se termine en franchissant l'arrivée
(quel que soit le compteur d'ennemis), une carte `kills` en vidant le stock. Le HUD affiche la
progression (`🏁 62 % · 84 tuiles restantes`) ou le stock restant selon le cas.

- **Stock fini** (défaut, cartes élimination) : les ennemis tués ne reviennent pas. Le HUD affiche `⚔ tués / total ·
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
respawn, atterrissage, menu. Boucles : reel (pitch lié à la vitesse de rétraction réelle du tick) et jetpack
(volume et filtre liés à la poussée et à la chauffe). L'AudioContext est débloqué au premier clic ou à la
première touche.

## Tests

- `test/determinism.test.ts` : deux runs identiques, découpage temporel indifférent, empreinte de référence, coût par tick.
- `test/snapshot.test.ts` : identité sérialisation, clone complet, reprise depuis snapshot, rollback 60 ticks, input corrigé.
- `test/physics.test.ts` : accroche et contrainte, rétraction auto/relâche/détache, chauffe et reprise, mort au mur
  au-dessus du seuil seulement, ennemis (kill traversant vs repoussée).
- `test/levels.test.ts` : les 7 cartes parsent, bords pleins, spawn au sol et loin des pics, ancrages
  atteignables depuis le sol, pics cantonnés à la cave, arrivée présente et lointaine sur les seules
  cartes chrono, ratio largeur/hauteur des courses.
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
- `test/math.test.ts`, `test/no-forbidden-math.test.ts`.

## Direction artistique (planches)

`design/planches/index.html` : premier jet de DA en pixel art animé, en dehors du jeu. Trois niveaux (Port
d'Umibozu, Forteresse de braise, Bambouseraie maudite) et un gros plan du samouraï, rendus en direct en
640 × 360 sur canvas. Sous chaque planche, le mode **Valeurs** (niveaux de gris) et le mode **Couche de jeu**
(décor coupé) servent à vérifier que le perso reste lisible. Ouvrir le fichier dans un navigateur suffit,
aucun build. Tout est procédural : ça valide la direction et le mouvement, pas le rendu final.

## Limites connues de la V1

- Les cordes traversent les murs (pas d'enroulement autour des coins).
- Pas de collision joueur-joueur (seulement la corde entre eux).
- Le feel dépend des valeurs par défaut de `DEFAULT_PARAMS` : elles sont un point de départ, pas un réglage final.
- Aucun art dans le jeu : grey-box volontaire (la DA est explorée à part dans `design/planches`).
