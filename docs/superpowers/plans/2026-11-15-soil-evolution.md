# Soil Evolution Implementation Plan

> **For agentic workers:** Implement task-by-task. Spec: `docs/superpowers/specs/2026-11-15-soil-evolution-design.md`.

**Goal:** Mutowalna siatka gleby w Mixed + polish (wiatr lerp, UI manual, canPlantAt, smooth paint).

**Architecture:** `Island` trzyma `soilGrid`+`soilProgress` i `evolveSoil`/`canPlantAt`; `SimulationManager` woła evolve i filtruje sadzenie; `FloraSystem` lerp wiatru; UI odblokowuje live weather przy auto off.

**Tech Stack:** Vanilla JS, Three.js, istniejący headless test.

## Global Constraints

- Water startowe nie ewoluuje; ewolucja tylko w `SoilMode.MIXED`
- Logika bez Three.js poza Island paint / FloraSystem
- Losowość tylko przez SeededRandom w logice

---

### Task 1: Config `SOIL_EVOLVE`
- [ ] Dodać stałe temp/progów/coast/slope/blend w `config.js`

### Task 2: Island
- [ ] `soilProgress`, `evolveSoil`, `canPlantAt`, smooth `#paint`, snapshot memento

### Task 3: SimulationManager
- [ ] Tick evolve, użyć `canPlantAt`, memento soil

### Task 4: Flora + UI
- [ ] Lerp lean wiatru; ręczne T/airM/soilM/precip przy auto off

### Task 5: Testy + docs
- [ ] headless asercje; krótki opis w docs
