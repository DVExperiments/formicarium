# Formicarium

A real-time ant colony ecosystem you observe rather than control. Every ant is an independent agent; trails, nests, territories, booms and collapses emerge from simple biological rules.

## Deploying to GitHub Pages

## What you can do

- **Drag food** (seeds, dead insects, fruit, sugar water) from the toolbar onto the ground, or click a food tool and then click the ground.
- **Found colonies** of three species with the Colony tool.
- **Click an ant** to see what it is doing and why; press **Follow** to track it, including into and out of the nest.
- **Click a nest** for colony statistics; **double-click** it, or use *Underground*, to see the live cross-section of chambers, brood, stores and refuse.
- **Overlays:** scent trails and alarm pheromone (P), territories (T), debugging (D).
- **Time:** pause (Space) and run at 1×, 2×, 5× or 10× (keys 1–4).
- **Panel tabs:** inspector, colony list, historical graphs, event log, and a World tab with conditions, the resource ledger, performance, and seeded experiments.

URL parameters make experiments repeatable: `?seed=meadow&species=messor` always produces the same world and the same run.

## The simulation

### Ants
Each ant has its own identity, caste, age, lifespan, energy, water, health, load, crop contents, position and short-term memory of a food source. Workers choose tasks with a **response-threshold model**: colony-level stimuli (hungry larvae, low stores, crowding, corpses, alarm) compete against each ant's personal thresholds, which shift with age (young ants nurse, older ants forage) and with experience (ants grow keener on tasks they repeat).

Tasks: exploring, foraging, following trails, hunting, carrying (alone or cooperatively), unloading, feeding, nursing, moving brood, digging, hauling soil, removing corpses, milling seeds, defending, resting and overwintering.

### Communication and navigation
Foragers find their way home by path integration. Returning ants lay recruitment trail **only if the source is still worth visiting**, with strength depending on food quality and colony need. Trails decay exponentially and wash out in rain, so routes to exhausted food disappear. Each colony has its own trail and alarm pheromone fields.

### Resources
Food has nutritional value (carbohydrate and protein), physical size, carrying requirements, remaining quantity, spoilage rate and species-specific appeal. Medium items are carried cooperatively; large ones are cut up piece by piece. Colonies store food in workers' crops (black garden ants) or in store chambers, with finite capacity, so surplus is wasted. Seeds go to granaries and must be milled before they can be eaten.

A **resource ledger** tracks every unit of food from its source (initial, natural, player, carcass) to its sink (metabolism, decay, spoilage, waste, brood tissue, brood loss, mortality, dispersal). The balance is checked in the tests and shown in the World tab; it holds to about one part in 10¹³. Colonies grow only from food actually gathered and allocated to brood.

### Reproduction
Queens lay eggs at rates that depend on nutrition, nest temperature, season, reserves and how many larvae the workers can care for. Brood develops from egg to larva to pupa to adult, needs protein and the right temperature, and can starve, drown or overheat. Nurses move brood towards chambers near 28 °C and out of flooded ones. Well-fed larvae in larger colonies can become majors; in mature colonies in summer, some become winged queens and males that leave on synchronised nuptial flights after rain. A few mated queens found new colonies, raising their first small workers alone from their body reserves.

### Nests
Nests are trees of chambers and tunnels that workers excavate when crowding, brood or stores demand it. Excavation costs time and energy, and the soil is carried up to build the mound. Shallow chambers warm and cool with the day; deep ones stay stable. Saturated soil floods shallow chambers.

### Environment
Day and night, seasonal and daily temperature cycles, weather anomalies, rain, soil moisture and seasons. Natural food includes aphid honeydew on herbs, seed heads on grasses, fruit from shrubs in late summer and autumn, dead insects, and living insects that predatory species hunt. Supply is seasonal and limited, and survival is never guaranteed.

### Competition
Encounters between colonies lead to avoidance, threat displays or fights depending on species aggression, local numbers, distance from each nest, food at stake, alarm level, injury and body size. Fights cause injuries and deaths, release alarm pheromone that recruits defenders, and make carriers drop their loads, which rivals can steal. Retreating ants are left alone, and dead enemies become protein for the victors.

### Species

| | Black garden ant | Harvester ant | Big-headed ant |
|---|---|---|---|
| Latin name | *Lasius niger* | *Messor barbarus* | *Pheidole megacephala* |
| Diet | Honeydew, sugar, insects | Seeds (granary and milling) | Insects, sugar, seeds |
| Castes | Monomorphic workers | Workers and majors | Minors and soldiers |
| Queens | One | One | Several, re-adopts daughter queens |
| Storage | Workers' crops | Granary chambers | Store chambers |
| Activity | Day and night | Daytime only | Day and night |
| Winter | Dormancy | Dormancy | No dormancy, struggles in the cold |
| Aggression | Low | Moderate | High |

Big-headed ants are a notorious invasive species that exterminates native ants. Founding one right next to another colony usually ends badly for the neighbour.

### Time scale
At 1× a simulated day lasts two minutes and each season lasts eight days, so a year takes about an hour (around six minutes at 10×). Biological durations are compressed to match: brood takes roughly a week to develop and workers live one to three seasons. Speed changes only how many fixed simulation ticks run per second, never the rules, so results are identical at every speed. If a device can't keep up, the simulation slows down rather than skipping steps, and the top bar shows the effective speed.

## Architecture

```
js/sim/       simulation engine and persistent world state (no DOM; runs in Node)
  world.js      orchestration, spawning, combat, flights, territory, ledger
  colony.js     stores, brood, egg laying, task stimuli, expansion, extinction
  ant.js        individual behaviour and task allocation
  nest.js       chambers, tunnels, excavation, pathing, flooding
  environment.js, pheromone.js, food.js, spatial.js, species.js, rng.js, constants.js
js/render/    presentation: surface view, underground cross-section, sprites, terrain, charts, camera
js/ui/        main loop, input, panels
tests/        automated tests (Node and browser) and an unattended long-run harness
```

The simulation never reads from the renderer. All randomness comes from a seeded generator, so a seed fully determines a run. Neighbour searches use spatial hashing, pheromone decay is batched with exact compounding, and far-zoomed ants are drawn as simple strokes.

## Testing

```
node tests/run.mjs                          # 24 unit tests
node tests/longrun.mjs 64 myseed --colonies # unattended run with invariant checks
```

The tests can also be run in the browser at `/tests/`. They cover pheromone decay and batch invariance, metabolism, resource conservation, food depletion, storage limits, starvation, brood development and starvation, egg costs, dormancy, population decline and growth, extinction with preserved nests and history, determinism, speed invariance, nest pathing, excavation, task switching and combat. GitHub Actions runs both on every push (`.github/workflows/tests.yml`).

## Ideas for later versions

Nest raiding and slave-making species, colony budding in polygynous species, worker-laid male eggs in queenless colonies, more detailed thermoregulation, user-adjustable climate, and saving and loading worlds.

## Licence

MIT
