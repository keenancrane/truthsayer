// 3D viewer panel for truthsayer.
//
// Loader / lighting / framing patterns adapted from OHZI Interactive's
// glb-viewer-core (MIT, https://github.com/ohzinteractive/glb-viewer-core).
// In particular: DRACO + KTX2 + Meshopt loader wiring, the studio-light
// emissive cube scene used to seed the PMREM environment, the camera
// fit-to-bounding-sphere math, and the wireframe / double-sided / normals
// toggles.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { VertexNormalsHelper } from "three/examples/jsm/helpers/VertexNormalsHelper.js";

interface ViewerInit {
  fileUri: string;
  libBaseUri: string;
}

export interface ViewerCallbacks {
  onObjectClicked?: (info: {
    meshIndex: number | null;
    nodeIndex: number | null;
    name: string | null;
  }) => void;
}

export interface Viewer {
  loadFromUri(uri: string): Promise<void>;
  frameAll(): void;
  frameMesh(meshIndex: number): void;
  frameNode(nodeIndex: number): void;
  highlightMesh(meshIndex: number): void;
  clearHighlight(): void;
  setWireframe(on: boolean): void;
  setDoubleSided(on: boolean): void;
  setNormalsOverride(on: boolean): void;
  setNormalsHelpers(on: boolean): void;
  setOriginArrows(on: boolean): void;
  setBackground(kind: "studio" | "dark" | "light" | "transparent"): void;
  getAnimations(): { index: number; name: string; duration: number }[];
  playAnimation(index: number | null): void;
  setAnimationSpeed(s: number): void;
  isPlaying(): boolean;
  resize(): void;
  setPaused(paused: boolean): void;
  dispose(): void;
}

const DEFAULT_BG = new THREE.Color("#1f1f24");

// Adapted from OHZI's StudioLightScene (MIT).
function studioEnvScene(): THREE.Scene {
  const scene = new THREE.Scene();
  const mat = (intensity: number) =>
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xffffff).multiplyScalar(intensity),
    });
  const lights: [THREE.Vector3, number, [number, number, number]][] = [
    [new THREE.Vector3(5, 5, 5), 5, [3, 3, 3]],
    [new THREE.Vector3(-5, 5, 5), 5, [3, 3, 3]],
    [new THREE.Vector3(5, 5, -5), 5, [3, 3, 3]],
    [new THREE.Vector3(-5, 5, -5), 5, [5, 3, 5]],
  ];
  for (const [pos, intensity, dims] of lights) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dims), mat(intensity));
    m.position.copy(pos);
    scene.add(m);
  }
  const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), mat(0.25));
  floor.position.y = -1;
  scene.add(floor);
  return scene;
}

export function createViewer(
  container: HTMLElement,
  init: ViewerInit,
  callbacks: ViewerCallbacks = {}
): Viewer {
  // Renderer
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1, false);
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  // Scene + camera
  const scene = new THREE.Scene();
  scene.background = DEFAULT_BG;
  const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 5000);
  camera.position.set(2, 1.5, 3);

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  scene.environment = pmrem.fromScene(studioEnvScene(), 0.04).texture;

  const grid = new THREE.GridHelper(10, 10, 0x4b4b4b, 0x4b4b4b);
  (grid.material as THREE.Material).depthWrite = false;
  grid.renderOrder = -1000;
  scene.add(grid);

  const axisHelper = new THREE.Object3D();
  axisHelper.add(new THREE.ArrowHelper(new THREE.Vector3(1, 0, 0), new THREE.Vector3(), 1, 0xea334c, 0));
  axisHelper.add(new THREE.ArrowHelper(new THREE.Vector3(0, 1, 0), new THREE.Vector3(), 1, 0x80ca1e, 0));
  axisHelper.add(new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(), 1, 0x2d83e8, 0));
  axisHelper.visible = false;
  scene.add(axisHelper);

  const selectionMat = new THREE.MeshBasicMaterial({
    color: 0x50af8e, wireframe: true, depthTest: false,
    depthWrite: false, transparent: true, opacity: 0.65,
  });
  const selectionMesh = new THREE.Mesh(new THREE.BufferGeometry(), selectionMat);
  selectionMesh.renderOrder = 999;
  selectionMesh.visible = false;
  scene.add(selectionMesh);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;

  // Loaders
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${init.libBaseUri}/draco/`);
  draco.setDecoderConfig({ type: "wasm" });
  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${init.libBaseUri}/basis/`);
  ktx2.detectSupport(renderer);
  loader.setDRACOLoader(draco);
  loader.setKTX2Loader(ktx2);
  loader.setMeshoptDecoder(MeshoptDecoder);

  // State
  let model: THREE.Object3D | null = null;
  let gltf: GLTF | null = null;
  let meshIndexToObjects: Map<number, THREE.Object3D[]> = new Map();
  let nodeIndexToObject: Map<number, THREE.Object3D> = new Map();
  let originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]> = new Map();
  let normalHelpers: VertexNormalsHelper[] = [];
  let wireframe = false;
  let doubleSided = false;

  let mixer: THREE.AnimationMixer | null = null;
  const clips: THREE.AnimationClip[] = [];
  let currentAction: THREE.AnimationAction | null = null;
  let playing = false;
  let speed = 1;
  const clock = new THREE.Clock();

  // Resize handling
  let lastSize = { w: 0, h: 0 };
  const ro = new ResizeObserver(() => doResize());
  ro.observe(container);
  function doResize(): void {
    const w = Math.max(1, container.clientWidth);
    const h = Math.max(1, container.clientHeight);
    if (w === lastSize.w && h === lastSize.h) return;
    lastSize = { w, h };
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  doResize();

  // Picking
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let mouseDown: { x: number; y: number; t: number } | null = null;
  renderer.domElement.addEventListener("pointerdown", (e) => {
    mouseDown = { x: e.clientX, y: e.clientY, t: performance.now() };
  });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (!model || !mouseDown) return;
    const dt = performance.now() - mouseDown.t;
    const dx = Math.abs(e.clientX - mouseDown.x);
    const dy = Math.abs(e.clientY - mouseDown.y);
    mouseDown = null;
    if (dt > 250 || dx > 4 || dy > 4) return;
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(model, true).filter((h) => h.object.visible);
    if (hits.length === 0) {
      api.clearHighlight();
      callbacks.onObjectClicked?.({ meshIndex: null, nodeIndex: null, name: null });
      return;
    }
    const hit = hits[0].object;
    const meshIdx = (hit.userData?.gltfMeshIndex as number | undefined) ?? null;
    const nodeIdx = (hit.userData?.gltfNodeIndex as number | undefined) ?? null;
    if (meshIdx !== null) api.highlightMesh(meshIdx);
    callbacks.onObjectClicked?.({
      meshIndex: meshIdx,
      nodeIndex: nodeIdx,
      name: hit.name || null,
    });
  });

  async function buildIndexMaps(g: GLTF): Promise<void> {
    meshIndexToObjects = new Map();
    nodeIndexToObject = new Map();
    const json = g.parser.json as { meshes?: unknown[]; nodes?: unknown[] };
    const meshCount = Array.isArray(json.meshes) ? json.meshes.length : 0;
    const nodeCount = Array.isArray(json.nodes) ? json.nodes.length : 0;
    for (let i = 0; i < nodeCount; i++) {
      try {
        const obj = await g.parser.getDependency("node", i);
        if (obj instanceof THREE.Object3D) {
          obj.userData.gltfNodeIndex = i;
          nodeIndexToObject.set(i, obj);
        }
      } catch {
        // unsupported node type
      }
    }
    for (let i = 0; i < meshCount; i++) {
      try {
        const obj = await g.parser.getDependency("mesh", i);
        const list: THREE.Object3D[] = [];
        if (obj instanceof THREE.Object3D) {
          obj.traverse((child) => {
            const cm = child as THREE.Mesh;
            if (cm.isMesh || (child as THREE.SkinnedMesh).isSkinnedMesh) {
              child.userData.gltfMeshIndex = i;
              list.push(child);
            }
          });
        }
        if (list.length) meshIndexToObjects.set(i, list);
      } catch {
        // ignore
      }
    }
  }

  let paused = false;
  let rafHandle = 0;
  function tick(): void {
    if (paused) {
      rafHandle = 0;
      return;
    }
    const dt = clock.getDelta();
    controls.update();
    if (mixer && playing) mixer.update(dt * speed);
    const target = (selectionMesh.userData.target as THREE.Object3D | null) ?? null;
    if (target && selectionMesh.visible) {
      target.getWorldPosition(selectionMesh.position);
      target.getWorldQuaternion(selectionMesh.quaternion);
      target.getWorldScale(selectionMesh.scale);
    }
    renderer.render(scene, camera);
    rafHandle = requestAnimationFrame(tick);
  }
  rafHandle = requestAnimationFrame(tick);

  function rememberMaterial(mesh: THREE.Mesh): void {
    if (!originalMaterials.has(mesh)) {
      originalMaterials.set(
        mesh,
        Array.isArray(mesh.material) ? [...mesh.material] : mesh.material
      );
    }
  }

  function applyMaterialFlags(): void {
    if (!model) return;
    model.traverse((c) => {
      const m = c as THREE.Mesh;
      if (!m.isMesh) return;
      rememberMaterial(m);
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) {
        if ("wireframe" in mat) (mat as THREE.MeshStandardMaterial).wireframe = wireframe;
        if ("side" in mat) (mat as THREE.Material).side = doubleSided ? THREE.DoubleSide : THREE.FrontSide;
      }
    });
  }

  function clearNormalHelpers(): void {
    for (const h of normalHelpers) scene.remove(h);
    normalHelpers = [];
  }

  function frameBox(box: THREE.Box3, padding = 1.4): void {
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const radius = Math.max(size.length() / 2, 0.001);
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const aspect = camera.aspect || 1;
    const distH = radius / Math.sin(fov / 2);
    const distW = radius / Math.sin(Math.atan(Math.tan(fov / 2) * aspect));
    const dist = Math.max(distH, distW) * padding;
    const dir = new THREE.Vector3().subVectors(camera.position, controls.target).normalize();
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    camera.position.copy(center.clone().add(dir.multiplyScalar(dist)));
    camera.near = Math.max(0.001, radius / 1000);
    camera.far = Math.max(camera.far, dist + size.length() * 4);
    camera.updateProjectionMatrix();
    controls.target.copy(center);
    controls.update();
  }

  const api: Viewer = {
    async loadFromUri(uri: string): Promise<void> {
      if (model) {
        scene.remove(model);
        model.traverse((c) => {
          const m = c as THREE.Mesh;
          if (m.geometry) m.geometry.dispose?.();
          if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) (mat as THREE.Material).dispose?.();
          }
        });
        model = null;
      }
      gltf = null;
      clips.length = 0;
      mixer?.stopAllAction();
      mixer = null;
      currentAction = null;
      playing = false;
      originalMaterials = new Map();
      clearNormalHelpers();
      scene.overrideMaterial = null;
      api.clearHighlight();

      gltf = await new Promise<GLTF>((resolve, reject) => {
        loader.load(uri, resolve, undefined, (err) => reject(err as unknown as Error));
      });

      model = gltf.scene;
      model.traverse((c) => { c.frustumCulled = false; });
      scene.add(model);
      await buildIndexMaps(gltf);

      if (gltf.animations.length) {
        clips.push(...gltf.animations);
        mixer = new THREE.AnimationMixer(model);
      }

      const box = new THREE.Box3().setFromObject(model);
      if (box.isEmpty()) {
        camera.position.set(2, 1.5, 3);
        controls.target.set(0, 0, 0);
        controls.update();
      } else {
        const center = new THREE.Vector3();
        box.getCenter(center);
        const size = box.getSize(new THREE.Vector3()).length();
        camera.position.copy(center).add(new THREE.Vector3(0, size * 0.25, size * 1.4));
        controls.target.copy(center);
        controls.update();
        frameBox(box);
      }
      applyMaterialFlags();
    },

    frameAll(): void {
      if (!model) return;
      const box = new THREE.Box3().setFromObject(model);
      if (!box.isEmpty()) frameBox(box);
    },

    frameMesh(meshIndex: number): void {
      const objs = meshIndexToObjects.get(meshIndex);
      if (!objs || objs.length === 0) return;
      const box = new THREE.Box3();
      for (const o of objs) box.expandByObject(o);
      if (!box.isEmpty()) {
        frameBox(box, 1.6);
        api.highlightMesh(meshIndex);
      }
    },

    frameNode(nodeIndex: number): void {
      const obj = nodeIndexToObject.get(nodeIndex);
      if (!obj) return;
      const box = new THREE.Box3().setFromObject(obj);
      if (!box.isEmpty()) frameBox(box, 1.6);
      else {
        const p = new THREE.Vector3();
        obj.getWorldPosition(p);
        controls.target.copy(p);
        controls.update();
      }
    },

    highlightMesh(meshIndex: number): void {
      const objs = meshIndexToObjects.get(meshIndex);
      if (!objs || objs.length === 0) return;
      const first = objs[0] as THREE.Mesh;
      if (!first.geometry) return;
      selectionMesh.geometry = first.geometry;
      selectionMesh.userData.target = first;
      first.getWorldPosition(selectionMesh.position);
      first.getWorldQuaternion(selectionMesh.quaternion);
      first.getWorldScale(selectionMesh.scale);
      selectionMesh.visible = true;
    },

    clearHighlight(): void {
      selectionMesh.visible = false;
      selectionMesh.userData.target = null;
    },

    setWireframe(on: boolean): void { wireframe = on; applyMaterialFlags(); },
    setDoubleSided(on: boolean): void { doubleSided = on; applyMaterialFlags(); },
    setNormalsOverride(on: boolean): void {
      scene.overrideMaterial = on ? new THREE.MeshNormalMaterial() : null;
    },
    setNormalsHelpers(on: boolean): void {
      clearNormalHelpers();
      if (!on || !model) return;
      model.traverse((c) => {
        const m = c as THREE.Mesh;
        if (m.isMesh && m.geometry?.attributes.normal) {
          const helper = new VertexNormalsHelper(m, 0.05, 0x00ff66);
          normalHelpers.push(helper);
          scene.add(helper);
        }
      });
    },
    setOriginArrows(on: boolean): void { axisHelper.visible = on; },
    setBackground(kind): void {
      switch (kind) {
        case "studio":      scene.background = DEFAULT_BG; break;
        case "dark":        scene.background = new THREE.Color("#0d0d10"); break;
        case "light":       scene.background = new THREE.Color("#dadde2"); break;
        case "transparent": scene.background = null; break;
      }
    },

    getAnimations() {
      return clips.map((c, i) => ({
        index: i, name: c.name || `Animation ${i}`, duration: c.duration,
      }));
    },
    playAnimation(index: number | null) {
      if (!mixer) return;
      mixer.stopAllAction();
      currentAction = null;
      playing = false;
      if (index === null || index < 0 || index >= clips.length) return;
      currentAction = mixer.clipAction(clips[index]);
      currentAction.reset().play();
      playing = true;
      clock.getDelta();
    },
    setAnimationSpeed(s) {
      speed = s;
      if (currentAction) currentAction.timeScale = s;
    },
    isPlaying() { return playing; },
    resize() { doResize(); },
    setPaused(p) {
      if (paused === p) return;
      paused = p;
      if (!paused && rafHandle === 0) {
        // Reset the delta so a long pause doesn't make animations jump.
        clock.getDelta();
        rafHandle = requestAnimationFrame(tick);
      }
    },
    dispose() {
      paused = true;
      if (rafHandle !== 0) {
        cancelAnimationFrame(rafHandle);
        rafHandle = 0;
      }
      ro.disconnect();
      pmrem.dispose();
      controls.dispose();
      renderer.dispose();
      draco.dispose();
      ktx2.dispose();
    },
  };

  api.loadFromUri(init.fileUri).catch((err) => {
    console.error("Truthsayer viewer load failed:", err);
    container.dispatchEvent(
      new CustomEvent("ts-viewer-error", { detail: String(err?.message ?? err) })
    );
  });

  return api;
}
