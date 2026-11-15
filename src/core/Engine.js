import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const SKY_COLOR = 0x8ec5ee;

export class Engine {
  constructor(container) {
    this.clock = new THREE.Clock();
    this.frameCallbacks = new Set();
    this.groundHeight = () => 0;
    this.cameraClearance = 2.5;
    this.maxTargetRadius = 35;

    this.#createRenderer(container);
    this.#createScene();
    this.#createCamera();
    this.#createControls();
    this.#createLights();

    window.addEventListener('resize', () => this.#handleResize());
  }

  onFrame(callback) {
    this.frameCallbacks.add(callback);
  }

  constrainCamera(groundHeightFn, clearance = 2.5, maxTargetRadius = 35) {
    this.groundHeight = groundHeightFn;
    this.cameraClearance = clearance;
    this.maxTargetRadius = maxTargetRadius;
  }

  start() {
    this.renderer.setAnimationLoop(() => {
      const delta = Math.min(this.clock.getDelta(), 0.1);
      const elapsed = this.clock.elapsedTime;
      this.controls.update();
      this.#enforceCameraBounds();
      this.frameCallbacks.forEach((callback) => callback(delta, elapsed));
      this.renderer.render(this.scene, this.camera);
    });
  }

  #createRenderer(container) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    container.appendChild(this.renderer.domElement);
  }

  #createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(SKY_COLOR);
    this.scene.fog = new THREE.Fog(SKY_COLOR, 150, 380);
  }

  #createCamera() {
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 600);
    this.camera.position.set(0, 55, 80);
  }

  #createControls() {
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.07;
    this.controls.screenSpacePanning = false;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.minPolarAngle = 0.1;
    this.controls.minDistance = 12;
    this.controls.maxDistance = 130;
    this.controls.target.set(0, 0, 0);
  }

  #createLights() {
    this.hemi = new THREE.HemisphereLight(0xcfe8ff, 0x4a5b3a, 1.0);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.4);
    this.sun.position.set(60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -75;
    this.sun.shadow.camera.right = 75;
    this.sun.shadow.camera.top = 75;
    this.sun.shadow.camera.bottom = -75;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 260;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.05;
    this.scene.add(this.sun);
  }

  #enforceCameraBounds() {
    const target = this.controls.target;
    const radius = Math.hypot(target.x, target.z);
    if (radius > this.maxTargetRadius) {
      const factor = this.maxTargetRadius / radius;
      target.x *= factor;
      target.z *= factor;
    }
    target.y = 0;

    const position = this.camera.position;
    const minHeight = this.groundHeight(position.x, position.z) + this.cameraClearance;
    if (position.y < minHeight) position.y = minHeight;
  }

  #handleResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }
}