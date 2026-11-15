import * as THREE from 'three';

const DROP_COUNT = 6000;
const RAIN_AREA = 120;
const RAIN_CEILING = 55;
const RAIN_FLOOR = 1;
const BOLT_LIFETIME = 0.55;
const FLASH_PEAK = 6000;

const SKY_CLEAR = new THREE.Color(0x8ec5ee);
const SKY_STORM = new THREE.Color(0x56606b);
const FLASH_SKY = new THREE.Color(0xffffff);

const lerp = (a, b, t) => a + (b - a) * t;
const randomIn = (min, max) => min + Math.random() * (max - min);

function flashEnvelope(age) {
  if (age < 0.07) return 1;
  if (age < 0.12) return 0.15;
  if (age < 0.2) return 0.85;
  return Math.exp(-(age - 0.2) * 9);
}

export class WeatherSystem {
  constructor(engine) {
    this.engine = engine;
    this.rainLevel = 0;
    this.bolts = [];
    this.flashAge = Infinity;
    this.baseSun = engine.sun.intensity;
    this.baseHemi = engine.hemi.intensity;
    this.skyColor = new THREE.Color();

    this.#createRain();
    this.#createFlashLight();
  }

  update(delta, simDelta, weather) {
    const target = weather.raining ? 1 : 0;
    this.rainLevel += (target - this.rainLevel) * Math.min(1, delta * 1.5);

    this.#updateRain(simDelta, weather);
    this.#updateLightning(delta);
    this.#updateAtmosphere();
  }

  strike(target) {
    this.flashAge = 0;
    this.flashLight.position.set(target.x, target.y + 14, target.z);
    this.#spawnBolt(new THREE.Vector3(target.x, target.y, target.z));
  }

  #createRain() {
    this.heads = new Float32Array(DROP_COUNT * 3);
    this.speeds = new Float32Array(DROP_COUNT);
    this.vertices = new Float32Array(DROP_COUNT * 6);

    for (let i = 0; i < DROP_COUNT; i++) {
      this.heads[i * 3] = randomIn(-RAIN_AREA / 2, RAIN_AREA / 2);
      this.heads[i * 3 + 1] = randomIn(RAIN_FLOOR, RAIN_CEILING);
      this.heads[i * 3 + 2] = randomIn(-RAIN_AREA / 2, RAIN_AREA / 2);
      this.speeds[i] = randomIn(30, 45);
    }

    const geometry = new THREE.BufferGeometry();
    this.rainAttribute = new THREE.BufferAttribute(this.vertices, 3);
    this.rainAttribute.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', this.rainAttribute);

    const material = new THREE.LineBasicMaterial({ color: 0x9fc4e6, transparent: true, opacity: 0.55 });
    this.rain = new THREE.LineSegments(geometry, material);
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.engine.scene.add(this.rain);
  }

  #createFlashLight() {
    this.flashLight = new THREE.PointLight(0xbcd2ff, 0, 0, 2);
    this.engine.scene.add(this.flashLight);
  }

  #updateRain(simDelta, weather) {
    this.rain.visible = this.rainLevel > 0.02;
    if (!this.rain.visible) return;

    const active = Math.floor(DROP_COUNT * this.rainLevel);
    this.rain.geometry.setDrawRange(0, active * 2);

    const angle = THREE.MathUtils.degToRad(weather.windAngle);
    const driftX = Math.cos(angle) * weather.windSpeed * 10;
    const driftZ = Math.sin(angle) * weather.windSpeed * 10;
    const half = RAIN_AREA / 2;

    for (let i = 0; i < active; i++) {
      const h = i * 3;
      let x = this.heads[h] + driftX * simDelta;
      let y = this.heads[h + 1] - this.speeds[i] * simDelta;
      let z = this.heads[h + 2] + driftZ * simDelta;

      if (y < RAIN_FLOOR) {
        y = RAIN_CEILING;
        x = randomIn(-half, half);
        z = randomIn(-half, half);
      }
      if (x > half) x -= RAIN_AREA;
      else if (x < -half) x += RAIN_AREA;
      if (z > half) z -= RAIN_AREA;
      else if (z < -half) z += RAIN_AREA;

      this.heads[h] = x;
      this.heads[h + 1] = y;
      this.heads[h + 2] = z;

      const v = i * 6;
      this.vertices[v] = x;
      this.vertices[v + 1] = y;
      this.vertices[v + 2] = z;
      this.vertices[v + 3] = x - driftX * 0.04;
      this.vertices[v + 4] = y + 1.4;
      this.vertices[v + 5] = z - driftZ * 0.04;
    }
    this.rainAttribute.needsUpdate = true;
  }

  #updateAtmosphere() {
    const { scene, sun, hemi } = this.engine;
    const flash = this.flashAge < 1 ? flashEnvelope(this.flashAge) : 0;

    this.skyColor.copy(SKY_CLEAR).lerp(SKY_STORM, this.rainLevel).lerp(FLASH_SKY, flash * 0.35);
    scene.background.copy(this.skyColor);
    scene.fog.color.copy(this.skyColor);

    sun.intensity = lerp(this.baseSun, this.baseSun * 0.35, this.rainLevel);
    hemi.intensity = lerp(this.baseHemi, this.baseHemi * 0.7, this.rainLevel) + flash * 1.5;
  }

  #updateLightning(delta) {
    if (this.flashAge < 1) {
      this.flashAge += delta;
      this.flashLight.intensity = FLASH_PEAK * flashEnvelope(this.flashAge);
    } else {
      this.flashLight.intensity = 0;
    }

    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const bolt = this.bolts[i];
      bolt.age += delta;
      if (bolt.age >= BOLT_LIFETIME) {
        this.#disposeBolt(bolt);
        this.bolts.splice(i, 1);
        continue;
      }
      const flicker = 0.75 + 0.25 * Math.sin(bolt.age * 90);
      const opacity = (1 - bolt.age / BOLT_LIFETIME) * flicker;
      bolt.materials.forEach((material) => {
        material.opacity = opacity;
      });
    }
  }

  #spawnBolt(target) {
    const start = new THREE.Vector3(target.x + randomIn(-6, 6), 60, target.z + randomIn(-6, 6));
    const mainPath = this.#jag(start, target, 6, 5);

    const group = new THREE.Group();
    const materials = [];
    const geometries = [];

    const addTube = (points, radius) => {
      const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.1);
      const geometry = new THREE.TubeGeometry(curve, points.length * 2, radius, 5, false);
      const material = new THREE.MeshBasicMaterial({
        color: 0xe8f1ff,
        transparent: true,
        opacity: 1,
        fog: false,
        depthWrite: false,
      });
      group.add(new THREE.Mesh(geometry, material));
      geometries.push(geometry);
      materials.push(material);
    };

    addTube(mainPath, 0.18);

    for (let b = 0; b < 2; b++) {
      const origin = mainPath[Math.floor(randomIn(4, mainPath.length - 6))];
      const end = origin.clone().add(new THREE.Vector3(randomIn(-12, 12), -randomIn(8, 16), randomIn(-12, 12)));
      addTube(this.#jag(origin.clone(), end, 3, 4), 0.08);
    }

    this.engine.scene.add(group);
    this.bolts.push({ group, materials, geometries, age: 0 });
  }

  #jag(from, to, offset, depth) {
    if (depth === 0) return [from, to];
    const mid = from.clone().lerp(to, 0.5);
    mid.x += (Math.random() - 0.5) * offset;
    mid.z += (Math.random() - 0.5) * offset;
    const left = this.#jag(from, mid, offset / 2, depth - 1);
    const right = this.#jag(mid, to, offset / 2, depth - 1);
    return left.concat(right.slice(1));
  }

  #disposeBolt(bolt) {
    this.engine.scene.remove(bolt.group);
    bolt.geometries.forEach((geometry) => geometry.dispose());
    bolt.materials.forEach((material) => material.dispose());
  }
}