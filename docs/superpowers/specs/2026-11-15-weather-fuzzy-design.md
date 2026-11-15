# Design: dynamika pogody (WeatherCore + lekki fuzzy)

Data: 2026-11-15.

## Cel

Parametry pogody mają się zmieniać w czasie (jak w przyrodzie), a trwały klimat wynika z celu ustawianego suwakami. Bez pełnego silnika fizycznego — reguły fuzzy + doganianie celu.

## Model

- **Cel klimatu:** `targetTemperature`, `targetMoisture` (suwaki / presety).
- **Stan pogody:** `temperature`, `airMoisture`, `soilMoisture`, `windSpeed`, `windAngle`, `precip`, `isSnow`.
- Pogoda **dogania** cel (`chaseRate`) + wahania sezonowe + delty z fuzzy.
- **Zastosuj natychmiast** kopiuje cel → pogodę (demo).
- Biom: macierz T × airM z **aktualnej** pogody; lokalnie wysokość, staw, pokrywa drzew (+wilgoć), wiatr na odsłoniętym (−soilM).
- Liściaste: silny wiatr obniża `LEAF` (grafika animacji później).
- Rozsiew: kąt/zasięg zależny od wiatru.
- Seed: `SIM_SEED` + UI resetu.

## Poza zakresem

Ewolucja typu gleby, jeziorka/hydrologia, siatka terenu/erozja, siatka pogodowa 2D, nowa grafika śniegu/opadających liści.

## Pliki

`WeatherCore.js`, `Fuzzy.js`, rozszerzenia `config.js`, `Climate.js`, `SimulationManager.js`, `UIManager.js`, `main.js`, `tools/headless-test.mjs`.
