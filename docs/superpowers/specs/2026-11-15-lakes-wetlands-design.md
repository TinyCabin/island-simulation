# Design: jeziora, mokradła, kałuże (seed + reguły)

Data: 2026-11-15. Zatwierdzone: podejście 1, wariant B, bez limitu „max 2”.

## Cel

Lokalne zbiorniki zamiast stawu w środku. Seed ustala baseny-kandydatów w terenie; woda/mokradła powstają gdy spełnione warunki. Kałuże tymczasowe przy wysokim `soilM`. Bez fizyki cieczy — wizual + siatka gleby.

## Model

- `basins[]` z seeda: środki ≠ (0,0), różne `radius`/`depth`; liczba 0…N (losowo z seeda)
- `heightAt` zagłębia teren przy basenach
- Start: głębokie dno → `Water` (trwałe), obrzeże → `Wetland`
- Reguły: dołek + wilgoć → Wetland/Water (kałuża); susza → kałuże znikają; głębokie jeziora trwałe
- Oaza / canPlant: dystans do najbliższej wody/mokradła
- Meshe dysków wody na jeziorach i kałużach; morze bez zmian

## Poza zakresem

Fale/SPH, erozja heightmapy w runtime, nowe modele roślin.
