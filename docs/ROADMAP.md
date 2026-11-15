# Plan prac: klimat, biomy, roślinność

Stan na: 15.11.2026. Dokument roboczy: aktualizuj tabelę statusów po każdym etapie.

## Cel projektu

Pokazać możliwości wizualne 3D w przeglądarce (Three.js) przez pseudo-symulację:
kilka parametrów (temperatura, wilgotność, …) → przejście do innego klimatu/biomu,
a roślinność reaguje wizualnie i ekologicznie.

## Status

| # | Zadanie | Status |
|---|---|---|
| 1 | Macierz reguł klimat → biom (T × M), biomy mieszają się na granicach | ✅ zrobione, przetestowane logicznie |
| 1a | Macierz flory (biom × gatunek), przydatność gatunku, ekotony | ✅ |
| 1b | 6 nowych gatunków (z istniejących modeli: proporcje, kolor, kształt korony) | ✅ (wygląd do oceny w przeglądarce) |
| 1c | Imigracja gatunków po zmianie klimatu | ✅ |
| 1d | Lokalne różnice klimatu (wysokość, oaza przy stawie) | ✅ |
| 1e | UI: suwaki T/M, presety, odczyt biomu, liczniki gatunków | ✅ |
| 1f | Kolor gruntu zależny od biomu | ✅ |
| 2 | Cykl liści: sadzonka (pień) → ulistnienie → przebarwienie → opad → uschnięcie/przetrwanie | 🟡 logika + render gotowe i przetestowane w Node; **wymaga oceny wizualnej** |
| 3 | Reguły sąsiedztwa między gatunkami | ⬜ zaczątek: warstwy `tree`/`shrub` w tłoku |
| 4 | Proceduralne generowanie roślin | ⬜ zaczątek: proporcje, kształt korony, jitter koloru/rozmiaru z ID |

**Nie zweryfikowano w przeglądarce** (środowisko pracy nie miało WebGL). Zweryfikowano: `vite build`
bez błędów, logika w Node (`node tools/headless-test.mjs`): presety, przejścia, determinizm, memento.

## Co zmieniono (pliki)

| Plik | Zmiana |
|---|---|
| `src/config.js` | `CLIMATE`, `LEAF`, osie, `Biome/BIOMES`, `BIOME_MATRIX`, `CLIMATE_PRESETS`, `MODELS`, 8 gatunków, `FLORA_AFFINITY`; `INITIAL_PLANTS` zastąpiło `INITIAL_POPULATION` |
| `src/simulation/Climate.js` | **nowy**: wagi biomów, przydatność, lokalne warunki, opis do UI, kolor gruntu |
| `src/simulation/SimulationManager.js` | przydatność w wzroście/rozsiewie/kiełkowaniu, stres klimatyczny, `updateLeaves`, `immigrate`, `pickSpeciesAt`, gleby per gatunek, tolerancja suszy, deszcz zależny od wilgotności, API `setTemperature/setMoisture/setClimate`, klimat w mementach |
| `src/simulation/PlantStore.js` | `STRIDE` 13→16 (`CLIMATE`, `LEAF`, `HUE`), `speciesCounts`, filtr warstwy w `countNeighbours` |
| `src/entities/FloraSystem.js` | części pień/korona, paleta gatunku, skalowanie korony wokół środka, proporcje, jitter, cache GLTF |
| `src/environment/Island.js` | `climate`, `refreshClimate`, kolor gruntu z biomu (szum koloru w cache) |
| `src/ui/UIManager.js` | foldery „Klimat” i „Gatunki (żywe)” |
| `src/main.js` | tworzy `Climate`, przekazuje do `Island` i `SimulationManager` |
| `tools/headless-test.mjs` | test logiki bez przeglądarki |
| `docs/CLIMATE.md` | macierze, reguły, jak rozszerzać |

## Wyniki testu logiki (400 s symulacji od zera)

| Preset | Dominujące gatunki |
|---|---|
| Las umiarkowany | dąb 817, krzew 951, sosna 132 |
| Tajga | sosna 1363, krzewinka tundrowa 590 |
| Tundra | krzewinka tundrowa 1286 |
| Pustynia lodowa | brak roślin (celowo) |
| Step / Makia | krzew suchy (+ pojedyncze inne) |
| Sawanna | krzew suchy 1198, akacja 271, palma 236, krzew 164 |
| Las tropikalny | drzewo tropikalne 1883, krzew 988 |
| Pustynia | kaktus 645, krzew suchy 595, **dęby przy stawie (oaza)** |

Przejście las → pustynia: po 240 s zostają kaktusy, krzewy suche i dęby tylko w oazie.
Przejście 15 → 2,5 °C: dąb po 20 s bez liści (przebarwienie → opad), sosna zielona, potem dąb wymiera.

## Następne kroki (kolejność)

### Etap A: weryfikacja wizualna (zrobić pierwsze)
1. `npm install && npm run dev`, wybierz presety po kolei, obserwuj. Checklista:
   - [ ] korona dęba faktycznie maleje/znika przy zimnie (pień zostaje), kolor przechodzi w pomarańcz
   - [ ] sadzonki mają najpierw „gołe” gałęzie, potem liście
   - [ ] sosna wąska i wysoka, akacja płaska (parasol), kaktus zielony i smukły
   - [ ] grunt zmienia kolor (biały/szary/żółty/zielony), widać oazę wokół stawu
   - [ ] suwak temperatury nie przycina klatek (przemalowanie 40 tys. wierzchołków przy każdej zmianie)
   - [ ] cofanie osią czasu przywraca klimat i kolor gruntu
2. Jeśli korona/pień źle wykrywane: sprawdź w konsoli nazwy materiałów, popraw `MODELS[...].trunkMaterials`.
3. Dostrój kolory w `species.colors` i proporcje (to czysta konfiguracja).

### Etap B: sezony + autonomiczna pogoda
- ✅ WeatherCore: cel klimatu vs live, chase, sezon, lekki fuzzy, soilM/precip/wiatr, seed UI
- ✅ Liście reagują na wiatr (logika); wizual opadających liści / śniegu — później
- Opcjonalnie: UI suwak amplitudy sezonu, wskaźnik pory roku

### Etap B2: ewolucja gleby + polish
- ✅ Mutowalna siatka (Rock↔Grass↔Sand), canPlantAt (brzeg/staw/stromizna), smooth paint
- ✅ Lerp pochylenia wiatrem; ręczne T/airM/soilM/precip przy auto off
- Później: kałuże/hydrologia

### Etap C: reguły między roślinami (punkt „otoczenie”)
Zacząć od macierzy interakcji `INTERACTIONS[gatunekA][gatunekB]` (cień, nianie, konkurencja) i prostych reguł:
1. Cień: drzewa dorosłe w promieniu R obniżają przydatność krzewów światłolubnych.
2. Nianie: krzewy ułatwiają kiełkowanie drzew na suchym terenie (facylitacja).
3. Wpływ otoczenia na biom: gęsty las lokalnie podnosi wilgotność (+0,05…0,1).
Wymaga **siatki przestrzennej** (spatial hash) zamiast O(N) w `countNeighbours`; zrobić przed pkt 1-3.

### Etap D: generowanie proceduralne
- Pula wariantów geometrii drzewa (np. 4–6) z prostego L-systemu lub rekurencyjnego rozgałęzienia,
  każdy wariant jako osobny `InstancedMesh` (gałęzie + liście), losowany po ID rośliny.
- Wersja lekka: przesunięcia wierzchołków szumem w vertex shaderze (`onBeforeCompile`), bez nowych modeli.
- Liście jako instancje płaskich listków zamiast skalowanej bryły korony (wtedy opad liści może być prawdziwym opadaniem cząstek).

### Etap E: klimat przestrzenny i atmosfera
- Pola T/M z szumu (plamy biomów na wyspie) zamiast tylko wysokość + staw; cień deszczowy od wiatru.
- Kolor nieba/mgły i światło słońca zależne od biomu; śnieg (kolor gruntu + cząstki) w tundrze; kolor wody.
- Wiatr wpływa na zasięg rozsiewu.

### Etap F: techniczne
- Historia różnicowa (delta) zamiast pełnych snapshotów (teraz 16 pól × N roślin).
- Wiatr w vertex shaderze; LOD modeli.

## Wytyczne dla dalszej pracy

1. **Warstwy**: logika (`simulation/`, `Climate`) nie importuje Three.js. `Island`/`FloraSystem` tylko czytają stan.
2. **Losowość w logice tylko przez `SeededRandom`** (inaczej psuje się cofanie czasu). `Math.random()` wolno w czystej dekoracji.
3. **Każdy nowy stan rośliny** = nowe pole na końcu `F` w `PlantStore` + podbicie `STRIDE`. Nowy stan globalny = dopisać do `createMemento`/`restoreMemento`.
4. **Liczby i reguły do `config.js`**, logika bez „magicznych” stałych.
5. **Zmiana macierzy/gatunków**: po każdej zmianie `node tools/headless-test.mjs` (dane z tabeli wyżej jako punkt odniesienia) i `npm run build`.
6. **Dodając gatunek**, dopisz kolumnę do **wszystkich** wierszy `FLORA_AFFINITY` (start rzuci błędem, jeśli zapomnisz).
7. **Wydajność**: bez alokacji w pętlach klatki i ticku (używaj współdzielonych wektorów/tablic jak w `FloraSystem`/`Climate`).
8. Zmiany wykonuj małymi krokami, po każdym test w przeglądarce (szczególnie wygląd korony i kolory).

## Znane uwagi / ryzyka

- Dokumentacja PDF (`doku.pdf`) opisuje stan sprzed tych zmian (np. `INITIAL_POPULATION`, 13 pól na roślinę, krzew z tłokiem 1,8/4); trzeba ją zaktualizować po zakończeniu etapu A.
- Zasięg i balans: krzewy suche dominują w step/makia/sawannie (szybkie rozmnażanie); jeśli akacja ma być widoczniejsza: zwiększ jej `seedChancePerTick` lub zmniejsz `thornbush`.
- Pogoda wizualna (`rainLevel`, kropelki) nadal nie jest w mementach (stare ograniczenie).
- Klimat jest teraz statyczny między zmianami użytkownika; zmiany suwaków wchodzą do historii (każda zmiana = snapshot).
- Zmiana temperatury o dużą wartość „zabija” wiele roślin w ~60 s symulacji; przy ×8 trwa to kilka sekund realnych. Można wydłużyć `stressLimitSeconds`.
