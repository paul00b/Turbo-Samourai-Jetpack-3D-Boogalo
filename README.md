# Turbo Samouraï Jetpack — prototype V1

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
scénario scripté et affiche un hash. Le hash de référence est `e507ca5e` (test `empreinte de référence`,
identique sous Node/V8 et dans Chromium). Lance-le dans Firefox et Safari : il doit être identique. Si tu
modifies la physique, mets à jour `GOLDEN_HASH` dans `test/determinism.test.ts` dans le même commit.

Coût mesuré : ~7 µs par tick pour 2 joueurs (4 sous-pas × 6 itérations) sous Node. Une re-simulation de
60 ticks coûte < 1 ms : large marge pour un rollback réseau.

## Contrôles

| Action | Clavier / souris (défaut) | Manette (mapping standard) |
|---|---|---|
| Grappin gauche (maintien = reel, second appui = détache) | Clic gauche | LB / L1 |
| Grappin droit | Clic droit | RB / R1 |
| Jetpack (orienté vers le curseur / stick droit) | Espace ou Maj gauche | RT / R2 |
| Marche (ridiculement lente) | Q / D (touches physiques A/D, donc Q/D sur AZERTY) | Stick gauche, croix |
| Grab / cut manuel | E | A / ✕ (ou X / □) |
| Pause | Échap | Start / Options |

Tout est remappable dans **Contrôles** (clavier et manette). Les touches sont identifiées par
`KeyboardEvent.code` (position physique) ; le libellé affiché utilise la disposition réelle quand le
navigateur expose `navigator.keyboard.getLayoutMap()` (Chrome).

Manette : la Gamepad API ne liste une manette qu'après un premier appui, le HUD et les menus affichent
« appuie sur un bouton ». Les manettes non « standard » gardent le mapping par défaut en meilleur effort
et un avertissement invite à remapper. Deadzone radiale de 0.18 avec remise à l'échelle.

Raccourcis debug : **F1** panneau, **F2** mode caméra, **F3** hitboxes, **F4** vecteurs de vélocité, **F6** trail.

## Multijoueur local

- 1 ou 2 joueurs (menu Mode ou panneau de debug). Assignation joueur → périphérique explicite
  (`settings.devices`), inversable, un seul joueur peut être sur clavier+souris.
- Deux caméras à comparer, basculables à chaud (F2, réglages, debug) : **unique** englobant les deux joueurs
  avec zoom dynamique borné (zoom min/max, marge, lissage réglables), ou **split vertical**.
- La sim ne lit jamais un périphérique : `InputMapper` produit les `PlayerInput`, c'est le seul point à
  remplacer par une couche réseau.

## Panneau de debug

Sliders + champ numérique pour : gravité, vitesse de marche, vitesse du projectile de grappin, longueur max,
vitesse de reel, raideur de corde, amortissement du pendule, force du jetpack, chauffe, refroidissement,
friction de l'air, vitesse max, seuil de mort au mur, seuil de kill d'ennemi, masse, sous-itérations de
contrainte, sous-pas d'intégration, et quelques extras (conservation du moment angulaire au reel,
longueur mini de corde, friction au sol, PV, fenêtres du cut manuel, respawn ennemi).

Toggles : ennemis, ennemis létaux, cut auto/manuel, 1/2 joueurs, mode caméra, hitboxes, vecteurs, trail.

Persistance localStorage (`tsj.params.v1`, `tsj.settings.v1`). **Exporter JSON** télécharge et copie une
config complète (params + seed + options de rendu), **Importer JSON** l'applique. Les params
s'appliquent en live, la seed au prochain redémarrage.

Boutons **Test rollback** (rewind 60 ticks + re-sim, compare le hash au live) et **Auto-test 1000 ticks**.

## Le niveau

`src/sim/level.ts`, tableau `MAP_ROWS` en haut du fichier, 150 × 48 tuiles de 32 px, éditable à la main :

```
#  mur plein accrochable      =  mur plein NON accrochable (le grappin échoue)
^  pics (mort quelle que soit la vitesse)      .  vide      S  spawn
e  ennemi statique            p  ennemi en patrouille lente
```

Zones : A hall ouvert avec grille d'ancrages (pendule pur), B couloir étroit avec décrochés et pics
(contrôle à haute vitesse), C puits vertical avec nubs alternés (montée au reel), D champ de pics avec
ancrages suspendus, E1 salle de murs francs (mort par vitesse), E2 tunnel à plafond bas non accrochable
et puits lisse (jetpack obligatoire).

## Son

Tout est synthétisé dans `src/io/audio/sfx.ts` (oscillateurs, bruit blanc généré en code, filtres,
enveloppes). One-shots : tir, accroche, échec, détache, surchauffe, impact mortel, kill d'ennemi, dégâts,
respawn, atterrissage, menu. Boucles : reel (pitch lié à la vitesse de rétraction réelle du tick) et jetpack
(volume et filtre liés à la poussée et à la chauffe). L'AudioContext est débloqué au premier clic ou à la
première touche.

## Tests

- `test/determinism.test.ts` : deux runs identiques, découpage temporel indifférent, empreinte de référence, coût par tick.
- `test/snapshot.test.ts` : identité sérialisation, clone complet, reprise depuis snapshot, rollback 60 ticks, input corrigé.
- `test/physics.test.ts` : accroche et contrainte, reel/relâche/détache, chauffe et reprise, mort au mur
  au-dessus du seuil seulement, ennemis (kill traversant vs repoussée).
- `test/math.test.ts`, `test/no-forbidden-math.test.ts`.

## Limites connues de la V1

- Les cordes traversent les murs (pas d'enroulement autour des coins).
- Pas de collision joueur-joueur (seulement la corde entre eux).
- Le feel dépend des valeurs par défaut de `DEFAULT_PARAMS` : elles sont un point de départ, pas un réglage final.
- Aucun art : grey-box volontaire.
