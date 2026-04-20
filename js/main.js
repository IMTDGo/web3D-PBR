import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { appState } from './state.js';
import { setupLighting, updateModelShadowIntensity, setupLightUIEvents, updateShadowQuality } from './lighting.js';
import { createGrid, setupEnvironmentUIEvents } from './environment.js';
import { setupPostProcessing, setupPostProcessingUIEvents } from './postprocessing.js';
import { setupMaterialUIEvents } from './materials.js';
import { setupLoaderUIEvents } from './loader.js';
import { setupUVEditorEvents } from './uv-editor.js';
import { onWindowResize } from './utils.js';
import { setupSSSEvents } from './SSSManager.js';

function init() {
    appState.scene = new THREE.Scene();
    appState.scene.background = new THREE.Color(0xffffff);

    appState.camera = new THREE.PerspectiveCamera(50, (window.innerWidth - 320) / window.innerHeight, 0.01, 1000);
    appState.camera.position.set(5, 0, 0);

    // 優化：將 antialias 設為 false。
    // 原因：當使用 EffectComposer (Post-Processing) 時，渲染會寫入內部的 RenderTarget。
    // 此時若開啟原生 antialias，瀏覽器仍會分配預設的 MSAA 緩衝區，導致 VRAM 雙重浪費且無實際效果。
    appState.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    appState.renderer.setSize(window.innerWidth - 320, window.innerHeight);
    appState.renderer.setPixelRatio(1); // 強制 1.0 以大幅節省 VRAM (特別是在高解析度螢幕上)
    appState.renderer.shadowMap.enabled = true;
    appState.renderer.shadowMap.type = THREE.PCFSoftShadowMap; // 改用 PCFSoft，比 VSM 更省記憶體
    appState.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    appState.renderer.toneMappingExposure = 1.0;
    appState.renderer.outputColorSpace = THREE.SRGBColorSpace;
    appState.renderer.physicallyCorrectLights = true;
    appState.renderer.shadowMap.autoUpdate = false; // 優化：關閉陰影自動更新，僅在需要時更新

    document.getElementById('viewport').appendChild(appState.renderer.domElement);

    appState.controls = new OrbitControls(appState.camera, appState.renderer.domElement);
    appState.controls.enableDamping = true;
    appState.controls.dampingFactor = 0.05;
    appState.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: THREE.MOUSE.PAN };

    createGrid();
    setupLighting();
    updateShadowQuality('low'); // 預設陰影品質為 Low (1024)
    // 初始化陰影濃度 (同步模型自身陰影)
    const initialShadowOpacity = parseFloat(document.getElementById('shadowOpacity').value);
    updateModelShadowIntensity(initialShadowOpacity);
    setupPostProcessing();
    setupEventListeners();

    // --- 優化核心：按需渲染 (Render on Demand) ---
    appState.needsRender = true; // 初始渲染
    // 監聽所有 UI 操作，一旦有變動就請求渲染一幀
    document.body.addEventListener('input', () => { appState.needsRender = true; });
    document.body.addEventListener('change', () => { appState.needsRender = true; });
    document.body.addEventListener('click', () => { appState.needsRender = true; });
    
    animate();
}

function setupEventListeners() {
    setupLoaderUIEvents();
    setupMaterialUIEvents();
    setupUVEditorEvents();
    setupEnvironmentUIEvents();
    setupLightUIEvents();
    setupPostProcessingUIEvents();
    setupSSSEvents();
    
    appState.renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', onWindowResize);
}

function animate() {
    requestAnimationFrame(animate);
    
    // controls.update() 回傳 true 代表攝影機還在移動 (例如阻尼滑動中)
    const controlsChanged = appState.controls.update();

    // 優化：只有在 UI 操作或場景變動 (needsRender=true) 時才更新陰影
    // 單純旋轉攝影機 (controlsChanged) 時，使用快取的陰影貼圖，大幅提升 FPS
    if (appState.needsRender) {
        appState.renderer.shadowMap.needsUpdate = true;
    }

    // 只有在 "攝影機移動" 或 "UI改變(needsRender)" 時才進行渲染
    if (controlsChanged || appState.needsRender) {
        if (appState.composer) {
            appState.composer.render();
        } else {
            appState.renderer.render(appState.scene, appState.camera);
        }
        appState.needsRender = false; // 渲染完畢，重置標記
    }
}

init();