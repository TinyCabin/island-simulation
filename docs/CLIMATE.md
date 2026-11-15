# System klimatu, pogody i biomów

Dokument opisuje **cel klimatu → pogodę → biom → roślinność**.
Liczby: `src/config.js`. Logika bez Three.js: `Climate.js`, `WeatherCore.js`, `Fuzzy.js`.
Użycie: `SimulationManager`, `Island`, `FloraSystem`.

## 0. Pogoda vs klimat

| Poziom | Pola | Kto ustawia |
|---|---|---|
| **Cel klimatu** | `target.temperature`, `target.moisture` | suwaki / presety |
| **Stan pogody** | T, airM, soilM, windSpeed, windAngle, precip, isSnow | `WeatherCore` co tick |

Suwak zmienia tylko **cel**. Aktualna temperatura/wilgotność **doganiają** cel (`WEATHER.chaseRate`) oraz wahają się z sezonem i regułami fuzzy.
Przycisk **„Zastosuj natychmiast”** kopiuje cel → pogodę od razu.

- `precip` (0…1) — natężenie opadu; `raining = precip ≥ precipRainThreshold`.
- `isSnow` — pada i T < 0 °C.
- `soilMoisture` — wilgotność gleby (rośliny „piją” lokalnie z niej + oaza/pokrywa).

Seed: `SIM_SEED` w config; folder „Losowość” w UI resetuje symulację z nowym seedem.
Ten sam seed → ten sam przebieg (determinizm + cofanie czasu).

## 1. Parametry wejściowe biomu

| Parametr | Zakres | Skąd | Co robi |
|---|---|---|---|
| Temperatura live | −10 … 40 °C | pogoda | oś Y macierzy biomów |
| Wilgotność powietrza live | 0 … 1 | pogoda | oś X macierzy + reguły opadu |
| Wysokość terenu | `heightAt` | mapa | −1,6 °C / jednostkę |
| Odległość od stawu | 0 … 30 | mapa | do +0,3 wilgotności |
| Pokrywa drzew | 0 … 1 | siatka cover | +airM/+soilM (mikroklimat) |
| Wiatr na odsłoniętym | — | wind × (1−cover) | −soilM (wysuszanie) |

## 2. Fuzzy (lekki)

Bez biblioteki: trapezy `WEATHER_SETS` + reguły `WEATHER_RULES` (`Fuzzy.evaluateRules`).
Wejścia: temp, airM, soilM, wind, season. Wyjścia zagregowane 0…1 → delty w `WeatherCore.step`.

## 3. Macierz klimatu (temperatura × wilgotność → biom)

Wiersze = temperatura, kolumny = wilgotność powietrza (jak wcześniej).

| temp \ wilg. | arid (0) | dry (0,25) | moderate (0,5) | humid (0,75) | wet (1) |
|---|---|---|---|---|---|
| **frozen** (−10) | Pustynia lodowa | Pustynia lodowa | Tundra | Tundra | Tundra |
| **cold** (2,5) | Step | Step | Tajga | Tajga | Tajga |
| **temperate** (15) | Zarośla (makia) | Step | Las umiarkowany | Las umiarkowany | Las umiarkowany |
| **warm** (27,5) | Pustynia | Zarośla (makia) | Sawanna | Las tropikalny | Las tropikalny |
| **hot** (40) | Pustynia | Pustynia | Sawanna | Las tropikalny | Las tropikalny |

Definicja: `BIOME_MATRIX`, osie: `TEMPERATURE_BANDS`, `MOISTURE_BANDS`.
Przejścia: interpolacja dwuliniowa + `smoothstep` (`CLIMATE.transitionWidth`).

## 4. Macierz flory (biom × gatunek → przydatność 0…1)

`FLORA_AFFINITY` — bez zmian względem wcześniejszej wersji (patrz tabela w historii / kodzie).

## 5. Co robi przydatność (`fit`) w symulacji

| Mechanizm | Reguła |
|---|---|
| Wzrost | × `lerp(unfitGrowthFloor, 1, fit)` oraz wilgotność gleby / opad |
| Rozsiew | szansa × `fit`; kąt i dystans zależne od wiatru |
| Kiełkowanie | p ∝ `fit` |
| Stres klimatyczny | `fit < minFitness` → śmierć po limicie |
| Imigracja | gatunek ∝ `fit²` |
| Liście | zimno / susza / **silny wiatr** (liściaste) obniżają `LEAF` |
| Podłoże | `soils` gatunku |

## 6. Cykl życia liści

Jak wcześniej (`LEAF`, strategie deciduous / drought / evergreen / none), plus mnożnik wiatru (`WEATHER.windLeafStart` … `windLeafFull`).

## 7. Jak dodać…

**Nową regułę pogody:** wpis w `WEATHER_RULES` (+ ewentualnie etykieta w `WEATHER_SETS`).

**Nowy biom / gatunek:** jak wcześniej — `BIOME_MATRIX` / `FLORA_AFFINITY` / `SPECIES`.

**Zmiana osi biomu:** `TEMPERATURE_BANDS` / `MOISTURE_BANDS` + wymiary `BIOME_MATRIX`.

## 8. Ewolucja gleby (Mixed)

Siatka `Island.soilGrid` + `soilProgress`. Reguły w `SOIL_EVOLVE` (`config.js`):

- Rock + wilgotno + pokrywa roślin → Grassland (wolno)
- Grassland + sucho + wiatr + niska pokrywa → Sand
- Sand + wilgotno + rośliny → Grassland
- Water (morze/staw) nie ewoluuje; presety Sand/Rock zamrażają ewolucję

`canPlantAt`: zakaz na wodzie, stromiźnie, pasie brzegu/stawu i zbyt niskiej wysokości.
Paint: blend kolorów sąsiadów (`colorBlend`).

## 9. Poza zakresem (później)

Jeziorka/zalania, erozja heightmapy, siatka pogodowa 2D, wizual śniegu i opadających liści, nowe modele roślin.
