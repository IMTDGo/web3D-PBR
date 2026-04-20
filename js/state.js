import * as THREE from 'three';

export const appState = {
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    currentModel: null,
    currentMaterial: null,
    materials: [],
    lightPivot: null,
    gridHelper: null,
    groundPlane: null,
    groundMirror: null,
    // ⬇️ 新增這 1 行 ⬇️
    meshCache: [],
    // ⬆️ 新增結束 ⬆️
    
    // Lights
    topLight: null,
    leftLight: null,
    rightLight: null,
    subLight: null,
    shadowTopLight: null,
    shadowLeftLight: null,
    shadowRightLight: null,
    shadowSubLight: null,
    ambientLight: null,
    hemiLight: null,
    lightHelpers: [],
    
    // Post-processing
    composer: null,
    bloomPass: null,
    bokehPass: null,
    renderPass: null,
    gtaoPass: null,
    smaaPass: null,
    vignettePass: null,
    bloomLayer: new THREE.Layers(),
    
    // Interaction
    raycaster: new THREE.Raycaster(),
    mouse: new THREE.Vector2(),
    
    // Environment
    envMap: null,
    currentHDRI: null,
    
    // Loaders
    rgbeLoader: null,
    textureLoader: new THREE.TextureLoader(),
    
    // Configs & Data
    lightData: {
        top: { 
            position: { x: 0, y: 100, z: 0 },
            rotation: { x: -90, y: 0, z: 0 },
            intensity: 1.0,
            size: { width: 80, height: 80 },
            color: '#ffffff', 
            enabled: true 
        },
        left: { 
            position: { x: 40, y: 40, z: 40 },
            rotation: { x: -45, y: 45, z: 0 },
            intensity: 3.0,
            size: { width: 20, height: 20 },
            color: '#ffffff', 
            enabled: true 
        },
        right: { 
            position: { x: 40, y: 20, z: -40 },
            rotation: { x: -45, y: -135, z: 0 },
            intensity: 2.5,
            size: { width: 20, height: 20 },
            color: '#ffffff', 
            enabled: true 
        },
        sub: { 
            position: { x: -50, y: 30, z: 0 },
            rotation: { x: -45, y: 0, z: 0 },
            intensity: 2.0,
            size: { width: 10, height: 40 },
            color: '#ffffff', 
            enabled: true 
        }
    },
    hdrEnabled: true,
    hdrIntensity: 1.0,
    bloomEnabled: false,
    dofEnabled: false,
    aoEnabled: true,
    anisotropyRotation: 0,
    anisotropyPattern: 'linear',
    originalMaterialData: [],
    BLOOM_LAYER: 1
};

appState.bloomLayer.set(appState.BLOOM_LAYER);