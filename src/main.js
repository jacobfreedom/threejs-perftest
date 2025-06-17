import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GUI } from 'dat.gui';
import Stats from 'three/examples/jsm/libs/stats.module.js';
import { RGBELoader } from 'three/examples/jsm/loaders/RGBELoader.js';

const LOD_PATHS = {
  lod1: '/lod1/Untitled.gltf',
  lod2: '/lod2/Untitled.gltf',
  lod3: '/lod3/Untitled.gltf',
  lod4: '/lod4/Untitled.gltf',
};

const NORMAL_MAP_PATHS = {
  lod1: '/lod1/lambert1_normal_1001.png',
  lod2: '/lod2/lambert1_normal_1001.png',
  lod3: '/lod3/lambert1_normal_1001.png',
  lod4: '/lod4/lambert1_normal_1001.png',
};

// Global scene variables
let scene, camera, renderer, model, controls, stats, particleLight, directionalLight;
let appControls;

// Asset caches
const lods = {};
const normalMaps = {};

// Performance monitoring variables
let lastFrameTime = 0;

let performanceMonitor = {
  triangles: 0,
  drawCalls: 0,
  lastUpdateTime: 0
};

async function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x111111);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.z = 2;

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.25;
  controls.screenSpacePanning = false;
  controls.maxPolarAngle = Math.PI / 2;

  initializeAppControls();
  setupLights();
  stats = new Stats();
  document.body.appendChild(stats.dom);
  setupGUI();
  
  // First load the environment map
  await updateEnvironmentMap();
  
  // Then load LODs with priority on lod1
  await loadLODs();
  
  window.addEventListener('resize', onWindowResize, false);
}

// Async LOD loading
async function loadLODs() {
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();

  // First load lod1 with its normal map
  try {
    await new Promise((resolve, reject) => {
      loader.load(LOD_PATHS.lod1, (gltf) => {
        gltf.scene.traverse((child) => {
          if (child.isMesh) {
            lods.lod1 = child;
          }
        });

        textureLoader.load(NORMAL_MAP_PATHS.lod1, (normalMap) => {
          normalMap.encoding = THREE.LinearEncoding;
          normalMaps.lod1 = normalMap;
          resolve();
        }, undefined, reject);
      }, undefined, reject);
    });

    // Now we can show the model while loading the rest
    onAllLODsLoaded();

    // Sequentially load remaining LODs
    for (const lodKey of ['lod2', 'lod3', 'lod4']) {
      await new Promise((resolve, reject) => {
        loader.load(LOD_PATHS[lodKey], (gltf) => {
          gltf.scene.traverse((child) => {
            if (child.isMesh) {
              lods[lodKey] = child;
            }
          });

          textureLoader.load(NORMAL_MAP_PATHS[lodKey], (normalMap) => {
            normalMap.encoding = THREE.LinearEncoding;
            normalMaps[lodKey] = normalMap;
            resolve();
          }, undefined, reject);
        }, undefined, reject);
      });
    }
  } catch (error) {
    console.error('Error loading LODs:', error);
  }
}

function onAllLODsLoaded() {
  // Initially add the highest LOD to the scene
  changeLOD('lod1');
  animate();
}

// Changing of LODs
function changeLOD(lodKey) {
  if (model) {
    scene.remove(model);
  }
  // Check if the LOD is actually loaded before trying to clone
  if (!lods[lodKey]) {
    console.error(`LOD for key ${lodKey} is not loaded yet.`);
    return; // Exit if LOD is not ready
  }

  model = lods[lodKey].clone();
  model.position.set(0, 0, 0); // Set model position to 0,0,0

  // Ensure all meshes within the model have the correct material and settings
  model.traverse((child) => {
    if (child.isMesh) {
      const currentMaterial = child.material; // Keep reference to original material for maps if needed
      child.castShadow = appControls.shadow.useShadows;
      child.receiveShadow = appControls.shadow.useShadows;
      
      child.material = new THREE.MeshPhysicalMaterial(); // Create a new material to avoid shared state issues
      applyMaterialProperties(child.material, currentMaterial, lodKey); // Apply properties using a helper

      child.material.needsUpdate = true;
    }
  });
  
  scene.add(model);
  console.log(`Changed LOD to: ${lodKey}`);
  updateModelMaterials(); // Ensure materials are updated after LOD change
}

function updateModelMaterials() {
  if (!model) return;

  model.traverse((child) => {
    if (child.isMesh && child.material instanceof THREE.MeshPhysicalMaterial) {
      // The original material of the loaded LOD model might be needed for texture references
      const originalLodMaterial = lods[appControls.lod.currentLOD]?.material;
      applyMaterialProperties(child.material, originalLodMaterial, appControls.lod.currentLOD);
      child.material.needsUpdate = true;
    }
  });
}

function applyMaterialProperties(targetMaterial, originalMaterial, lodKey) {
  if (!appControls) return; // Guard clause

  if (!targetMaterial || !(targetMaterial instanceof THREE.MeshPhysicalMaterial)) {
    console.warn('Target material is not a MeshPhysicalMaterial. Skipping property application.');
    return;
  }

  const { material: materialCtrl, normalMap: normalMapCtrl, wireframe: wireframeCtrl, general: generalCtrl } = appControls;

  // Base maps: Use from originalMaterial if available and enabled, otherwise null.
  // Fallback to default LOD textures if originalMaterial is undefined but maps are desired (though this case might need specific handling).
  const defaultLodSource = lods[lodKey]; // The originally loaded GLTF scene for this LOD

  targetMaterial.map = materialCtrl.useBaseColorMap 
    ? (originalMaterial?.map || defaultLodSource?.material?.map || null) 
    : null;
  targetMaterial.roughnessMap = materialCtrl.useAORMMaps 
    ? (originalMaterial?.roughnessMap || defaultLodSource?.material?.roughnessMap || null) 
    : null;
  targetMaterial.metalnessMap = materialCtrl.useAORMMaps 
    ? (originalMaterial?.metalnessMap || defaultLodSource?.material?.metalnessMap || null) 
    : null;
  targetMaterial.aoMap = materialCtrl.useAORMMaps 
    ? (originalMaterial?.aoMap || defaultLodSource?.material?.aoMap || null) 
    : null;

  // Normal Map
  targetMaterial.normalMap = normalMapCtrl.normalMapEnabled ? normalMaps[normalMapCtrl.selectedNormalMap] : null;
  
  // Wireframe
  targetMaterial.wireframe = wireframeCtrl.wireframeEnabled;

  // Color
  targetMaterial.color.set(materialCtrl.useBaseColorMap ? 0xffffff : materialCtrl.color);

  // Physical Properties
  targetMaterial.roughness = materialCtrl.roughness;
  targetMaterial.metalness = materialCtrl.metalness;
  targetMaterial.clearcoat = materialCtrl.clearcoat;
  targetMaterial.clearcoatRoughness = materialCtrl.clearcoatRoughness;
  targetMaterial.transmission = materialCtrl.transmission;
  targetMaterial.thickness = materialCtrl.thickness; // Assuming this is for transmission
  targetMaterial.ior = materialCtrl.ior;
  targetMaterial.reflectivity = materialCtrl.reflectivity;
  targetMaterial.sheen = materialCtrl.sheen;
  targetMaterial.sheenRoughness = materialCtrl.sheenRoughness;
  targetMaterial.sheenColor.set(materialCtrl.sheenColor);
  targetMaterial.specularIntensity = materialCtrl.specularIntensity;
  targetMaterial.specularColor.set(materialCtrl.specularColor);
  targetMaterial.iridescence = materialCtrl.iridescence;
  targetMaterial.iridescenceIOR = materialCtrl.iridescenceIOR;
  targetMaterial.iridescenceThicknessRange = [materialCtrl.iridescenceThicknessMin, materialCtrl.iridescenceThicknessMax];
  
  // Double-sided mesh
  targetMaterial.side = generalCtrl.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
}


function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  
  const currentTime = Date.now();
  const deltaTime = currentTime - (lastFrameTime || currentTime);
  lastFrameTime = currentTime;
  
  // Animate the particle light
  const timer = currentTime * 0.00025;
  particleLight.position.x = Math.sin(timer * 7) * 3;
  particleLight.position.y = Math.cos(timer * 5) * 4;
  particleLight.position.z = Math.cos(timer * 3) * 3;
  
  // Update rotation
  controls.update();
  if (appControls.general.rotatePlane) {
    if (model) {
      model.rotation.y += 0.005 * (deltaTime / 16.67); // Normalize rotation speed to 60fps
    }
  }
  
  renderer.render(scene, camera);
  stats.update();

  // Update custom stats
  updateStatsOverlay();
}

function initializeAppControls() {
  appControls = {
    // LOD (Level of Detail) settings
    lod: {
      currentLOD: 'lod1'
    },
    // Normal map settings
    normalMap: {
      selectedNormalMap: 'lod1',
      normalMapEnabled: true,
      toggle: function() {
        this.normalMapEnabled = !this.normalMapEnabled;
        updateModelMaterials();
      }
    },
    // Wireframe display settings
    wireframe: {
      wireframeEnabled: false,
      toggle: function() {
        this.wireframeEnabled = !this.wireframeEnabled;
        updateModelMaterials();
      }
    },
    // Material properties
    material: {
      useBaseColorMap: true,
      useAORMMaps: true,
      color: 0xffffff,
      roughness: 0.0,
      metalness: 0.0,
      clearcoat: 0.0,
      clearcoatRoughness: 0.0,
      transmission: 0.0,
      thickness: 0.0,
      ior: 0.0,
      reflectivity: 0.0,
      sheen: 0.0,
      sheenRoughness: 0.0,
      sheenColor: 0x000000,
      specularIntensity: 0.0,
      specularColor: 0xffffff,
      iridescence: 0.0,
      iridescenceIOR: 1.3,
      iridescenceThicknessMin: 100,
      iridescenceThicknessMax: 400,
      emissive: 0x000000,     // Emissive color (black = no emission)
      emissiveIntensity: 0.0  // Emissive intensity
    },
    // Shadow settings
    shadow: {
      useShadows: true,
      useDirectionalLightShadow: true,
      useParticleLightShadow: true,
      shadowResolutions: [512, 1024, 2048, 4096],
      shadowResolution: 1024, // Default resolution
    },
    // Environment map settings
    environment: {
      envMap: 'studio_small_01_1k.hdr',
      envMapIntensity: 0.15,
      useBackgroundAsEnv: true
    },
    // General scene settings
    general: {
        rotatePlane: false,
        doubleSided: true
    }
  };
}

function setupLights() {
  // Ambient Light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
  scene.add(ambientLight);

  // Directional Light
  directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
  directionalLight.position.set(0, 10, 10);
  directionalLight.castShadow = appControls.shadow.useShadows && appControls.shadow.useDirectionalLightShadow;
  directionalLight.shadow.mapSize.width = appControls.shadow.shadowResolution;
  directionalLight.shadow.mapSize.height = appControls.shadow.shadowResolution;
  directionalLight.shadow.camera.near = 0.5;
  directionalLight.shadow.camera.far = 50;
  scene.add(directionalLight);

  // Particle Light (acting as a holder for PointLight)
  particleLight = new THREE.Mesh(
    new THREE.SphereGeometry(0.05, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  scene.add(particleLight);

  // Create and configure the point light
  const pointLight = new THREE.PointLight(0xffffff, 12);
  pointLight.castShadow = appControls.shadow.useShadows && appControls.shadow.useParticleLightShadow;
  pointLight.shadow.mapSize.width = appControls.shadow.shadowResolution;
  pointLight.shadow.mapSize.height = appControls.shadow.shadowResolution;
  pointLight.shadow.camera.near = 0.5;
  pointLight.shadow.camera.far = 50;
  
  // Add the point light to the particle light mesh
  particleLight.add(pointLight);
  
  // Store a reference to the point light for easier access
  particleLight.userData.pointLight = pointLight;
}

function updateStatsOverlay() {
  const statsOverlay = document.getElementById('stats-overlay');
  if (!statsOverlay) return;
  
  const currentTime = Date.now();
  
  // Update performance metrics every 500ms to avoid excessive DOM updates
  if (currentTime - performanceMonitor.lastUpdateTime > 500) {
    performanceMonitor.lastUpdateTime = currentTime;
    

    
    // Get renderer stats
    performanceMonitor.triangles = renderer.info.render.triangles;
    performanceMonitor.drawCalls = renderer.info.render.calls;
    
    // Update the overlay with formatted information
    let statsHtml = '';
    
    // Show different stats based on wireframe mode
    if (appControls.wireframe && appControls.wireframe.wireframeEnabled) {
      const lines = renderer.info.render.lines;
      statsHtml += `Lines: ${lines.toLocaleString('en-US')}<br>`;
    } else {
      statsHtml += `Triangles: ${performanceMonitor.triangles.toLocaleString('en-US')}<br>`;
    }
    
    // Add more performance metrics
    statsHtml += `Draw Calls: ${performanceMonitor.drawCalls}`;
    
    // Update the overlay
    statsOverlay.innerHTML = statsHtml;
  }
}

function updateShadowResolution(resolution) {
  // Update directional light shadow resolution
  if (directionalLight) {
    directionalLight.shadow.mapSize.width = resolution;
    directionalLight.shadow.mapSize.height = resolution;
    // Force shadow map update
    if (directionalLight.shadow.map) {
      directionalLight.shadow.map.dispose();
      directionalLight.shadow.map = null;
    }
    directionalLight.shadow.needsUpdate = true;
  }

  // Update point light shadow resolution
  if (particleLight && particleLight.children.length > 0) {
    const pointLight = particleLight.children.find(child => child instanceof THREE.PointLight);
    if (pointLight) {
      pointLight.shadow.mapSize.width = resolution;
      pointLight.shadow.mapSize.height = resolution;
      // Force shadow map update
      if (pointLight.shadow.map) {
        pointLight.shadow.map.dispose();
        pointLight.shadow.map = null;
      }
      pointLight.shadow.needsUpdate = true;
    }
  }
}

init();

function updateEnvironmentMap(forceUpdate = false) {
  return new Promise((resolve, reject) => {
    if (!appControls || !appControls.environment) {
      resolve();
      return;
    }
    
    // Cache environment maps to avoid reloading the same textures
    if (!window.environmentMapCache) {
      window.environmentMapCache = {};
    }
    
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();

    const envMapPath = appControls.environment.envMap;
    
    // Check if this environment map is already cached
    if (window.environmentMapCache[envMapPath] && !forceUpdate) {
      scene.environment = window.environmentMapCache[envMapPath];
      scene.environmentIntensity = appControls.environment.envMapIntensity;
      scene.background = appControls.environment.useBackgroundAsEnv ? scene.environment : new THREE.Color(0x111111);
      resolve();
    } else {
      // Load new environment map
      new RGBELoader()
        .setPath('/env/')
        .load(envMapPath, function (texture) {
          const envMap = pmremGenerator.fromEquirectangular(texture).texture;
          
          // Cache for future use
          window.environmentMapCache[envMapPath] = envMap;
          
          scene.environment = envMap;
          scene.environmentIntensity = appControls.environment.envMapIntensity;
          scene.background = appControls.environment.useBackgroundAsEnv ? scene.environment : new THREE.Color(0x111111);
          texture.dispose();
          pmremGenerator.dispose();
          resolve();
        }, undefined, reject);
    }
  });
}

function setupGUI() {
  if (!appControls) {
    console.error("appControls not initialized before setupGUI");
    return;
  }
  const gui = new GUI();

  setupLODGUI(gui, appControls.lod);
  setupNormalMapGUI(gui, appControls.normalMap);
  setupWireframeGUI(gui, appControls.wireframe);
  setupGeneralSettingsGUI(gui, appControls.general);
  setupEnvironmentGUI(gui, appControls.environment);
  setupShadowGUI(gui, appControls.shadow);
  setupMaterialPropertiesGUI(gui, appControls.material);

  gui.open();
}

function setupLODGUI(gui, lodCtrl) {
  gui.add(lodCtrl, 'currentLOD', Object.keys(LOD_PATHS)).name('Select LOD').onChange(function(value) {
    changeLOD(value);
  });
}

function setupNormalMapGUI(gui, normalMapCtrl) {
  gui.add(normalMapCtrl, 'selectedNormalMap', Object.keys(NORMAL_MAP_PATHS)).name('Normal Map Source').onChange(function() {
    updateModelMaterials();
  });
  gui.add(normalMapCtrl, 'toggle').name('Toggle Normal Map');
  // normalMapFolder.open(); // Optional: open by default
}

function setupWireframeGUI(gui, wireframeCtrl) {
  gui.add(wireframeCtrl, 'toggle').name('Toggle Wireframe');
}

function setupGeneralSettingsGUI(gui, generalCtrl) {
    gui.add(generalCtrl, 'rotatePlane').name('Rotate Plane');
    gui.add(generalCtrl, 'doubleSided').name('Double Sided').onChange((value) => {
        if (model) {
            model.traverse((child) => {
                if (child.isMesh && child.material instanceof THREE.MeshPhysicalMaterial) {
                    child.material.side = value ? THREE.DoubleSide : THREE.FrontSide;
                    child.material.needsUpdate = true;
                }
            });
        }
    });
}

function setupEnvironmentGUI(gui, environmentCtrl) {
  const envFolder = gui.addFolder('Environment');
  
  // Environment map selection
  envFolder.add(environmentCtrl, 'envMap', ['studio_small_01_1k.hdr', 'moonless_golf_1k.hdr', 'pond_bridge_night_1k.hdr']).name('Environment Map').onChange(updateEnvironmentMap);
  envFolder.add(environmentCtrl, 'envMapIntensity', 0, 2).name('Intensity').onChange(function() {
    scene.environmentIntensity = environmentCtrl.envMapIntensity;
  });
  envFolder.add(environmentCtrl, 'useBackgroundAsEnv').name('Use Background as Environment').onChange(function(value) {
    updateEnvironmentMap(true); // Force update to apply background change
  });
}

function setupShadowGUI(gui, shadowCtrl) {
  const shadowFolder = gui.addFolder('Shadows');
  
  /**
   * Helper function to update shadow settings for all lights
   */
  function updateShadowSettings() {
    const useShadows = shadowCtrl.useShadows;
    const useDirectional = shadowCtrl.useDirectionalLightShadow;
    const useParticle = shadowCtrl.useParticleLightShadow;
    
    // Update directional light
    if (directionalLight) {
      directionalLight.castShadow = useShadows && useDirectional;
    }
    
    // Update particle light
    const pointLight = particleLight.children.find(child => child instanceof THREE.PointLight);
    if (pointLight) {
      pointLight.castShadow = useShadows && useParticle;
    }
  }
  shadowFolder.add(shadowCtrl, 'useShadows').name('Enable Shadows').onChange((value) => {
    renderer.shadowMap.enabled = value;
    
    // Update shadow settings for all lights
    updateShadowSettings();
    
    // Update model shadow properties
    if (model) {
      model.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = value;
          child.receiveShadow = value;
        }
      });
    }
  });

  shadowFolder.add(shadowCtrl, 'useDirectionalLightShadow').name('Directional Light Shadow').onChange((value) => {
    // Update directional light shadow settings
    directionalLight.castShadow = value && shadowCtrl.useShadows;
    
    // Force shadow map update if needed
    if (value && shadowCtrl.useShadows) {
      if (directionalLight.shadow.map) {
        directionalLight.shadow.map.dispose();
        directionalLight.shadow.map = null;
      }
      directionalLight.shadow.needsUpdate = true;
    }
  });

  shadowFolder.add(shadowCtrl, 'useParticleLightShadow').name('Particle Light Shadow').onChange((value) => {
    // Update particle light shadow settings
    const pointLight = particleLight.children.find(child => child instanceof THREE.PointLight);
    if (pointLight) {
      pointLight.castShadow = value && shadowCtrl.useShadows;
      
      // Force shadow map update if needed
      if (value && shadowCtrl.useShadows) {
        if (pointLight.shadow.map) {
          pointLight.shadow.map.dispose();
          pointLight.shadow.map = null;
        }
        pointLight.shadow.needsUpdate = true;
      }
    }
  });

  shadowFolder.add(shadowCtrl, 'shadowResolution', shadowCtrl.shadowResolutions).name('Resolution').onChange((newResolution) => {
    shadowCtrl.shadowResolution = newResolution; // Ensure the control object is updated
    
    // Update shadow resolution for all shadow-casting lights
    updateShadowResolution(newResolution);
  });
}

function setupMaterialPropertiesGUI(gui, materialCtrl) {
  const materialFolder = gui.addFolder('Material Properties');
  materialFolder.add(materialCtrl, 'useBaseColorMap').name('Use BaseColor Map').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'useAORMMaps').name('Use AORM Maps').onChange(updateModelMaterials);
  materialFolder.addColor(materialCtrl, 'color').name('Color').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'roughness', 0, 1).name('Roughness').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'metalness', 0, 1).name('Metalness').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'clearcoat', 0, 1).name('Clearcoat').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'clearcoatRoughness', 0, 1).name('Clearcoat Roughness').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'transmission', 0, 1).name('Transmission').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'thickness', 0, 5).name('Thickness (for Trans.)').onChange(updateModelMaterials); // Adjusted range for thickness
  materialFolder.add(materialCtrl, 'ior', 1.0, 2.333).name('IOR').onChange(updateModelMaterials);
  materialFolder.add(materialCtrl, 'reflectivity', 0, 1).name('Reflectivity').onChange(updateModelMaterials);
  
  // Add emissive controls
  const emissiveFolder = materialFolder.addFolder('Emissive');
  emissiveFolder.addColor(materialCtrl, 'emissive').name('Emissive Color').onChange(updateModelMaterials);
  emissiveFolder.add(materialCtrl, 'emissiveIntensity', 0, 2).name('Emissive Intensity').onChange(updateModelMaterials);
  
  const sheenFolder = materialFolder.addFolder('Sheen');
  sheenFolder.add(materialCtrl, 'sheen', 0, 1).name('Sheen Intensity').onChange(updateModelMaterials);
  sheenFolder.add(materialCtrl, 'sheenRoughness', 0, 1).name('Sheen Roughness').onChange(updateModelMaterials);
  sheenFolder.addColor(materialCtrl, 'sheenColor').name('Sheen Color').onChange(updateModelMaterials);
  
  const specularFolder = materialFolder.addFolder('Specular');
  specularFolder.add(materialCtrl, 'specularIntensity', 0, 1).name('Specular Intensity').onChange(updateModelMaterials);
  specularFolder.addColor(materialCtrl, 'specularColor').name('Specular Color').onChange(updateModelMaterials);

  const iridescenceFolder = materialFolder.addFolder('Iridescence');
  iridescenceFolder.add(materialCtrl, 'iridescence', 0, 1).name('Iridescence Intensity').onChange(updateModelMaterials);
  iridescenceFolder.add(materialCtrl, 'iridescenceIOR', 1.0, 2.333).name('Iridescence IOR').onChange(updateModelMaterials);
  iridescenceFolder.add(materialCtrl, 'iridescenceThicknessMin', 0, 1000).name('Thickness Min').onChange(updateModelMaterials);
  iridescenceFolder.add(materialCtrl, 'iridescenceThicknessMax', 0, 1000).name('Thickness Max').onChange(updateModelMaterials);
}
// Expose changeLOD to global scope for easy testing (e.g., via console)
window.changeLOD = changeLOD;
