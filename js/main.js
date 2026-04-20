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
    appState.renderer.shadowMap.autoUpdate = false; // 優化：關閉陰影自動更新，僅在需要時更新

    document.getElementById('viewport').appendChild(appState.renderer.domElement);

    appState.controls = new OrbitControls(appState.camera, appState.renderer.domElement);
    appState.controls.enableDamping = false; // 不使用任何阻尼，滑鼠移動直接對應畫面
    appState.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: null, RIGHT: THREE.MOUSE.PAN };

    createGrid();
    setupLighting();
    updateShadowQuality('low'); // 預設陰影品質為 Low (1024)
    // 初始化陰影濃度 (同步模型自身陰影)
    const initialShadowOpacity = parseFloat(document.getElementById('shadowOpacity').value);
    updateModelShadowIntensity(initialShadowOpacity);

    // C2/C3 修正：初始時同步 UI checkbox 與內部狀態，避免 AO/陰影 與 UI 不一致
    const shadowsCheckbox = document.getElementById('shadowsEnabled');
    if (shadowsCheckbox) {
        const enabled = shadowsCheckbox.checked;
        if (appState.shadowTopLight) appState.shadowTopLight.castShadow = enabled;
        if (appState.shadowLeftLight) appState.shadowLeftLight.castShadow = enabled;
        if (appState.shadowRightLight) appState.shadowRightLight.castShadow = enabled;
        if (appState.shadowSubLight) appState.shadowSubLight.castShadow = enabled;
    }
    const aoCheckbox = document.getElementById('aoEnabled');
    if (aoCheckbox) appState.aoEnabled = aoCheckbox.checked;

    setupPostProcessing();
    setupEventListeners();

    // --- 優化核心：按需渲染 (Render on Demand) ---
    appState.needsRender = true; // 初始渲染
    // M2 修正：僅監聽 sidebar (UI) 區域的互動，避免對無關互動觸發 shadowMap 更新
    const sidebar = document.querySelector('aside') || document.body;
    const requestRender = () => { appState.needsRender = true; };
    sidebar.addEventListener('input', requestRender);
    sidebar.addEventListener('change', requestRender);
    sidebar.addEventListener('click', requestRender);
    
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

    // 用 pointerdown/up 追蹤拖曳狀態，供 animate 判斷是否需要渲染
    appState.renderer.domElement.addEventListener('pointerdown', () => { appState.isDragging = true; });
    window.addEventListener('pointerup', () => { appState.isDragging = false; appState.needsRender = true; });

    // 滾輪縮放：每次滾動觸發一幀渲染
    appState.renderer.domElement.addEventListener('wheel', () => { appState.needsRender = true; }, { passive: true });
}

function animate() {
    requestAnimationFrame(animate);

    // 拖曳中（isDragging）每幀都渲染；其他情況只在 needsRender 時渲染一幀
    const shouldRender = appState.isDragging || appState.needsRender;

    if (shouldRender) {
        // controls.update() 必須在渲染前呼叫以同步攝影機狀態
        appState.controls.update();

        if (appState.needsRender) {
            appState.renderer.shadowMap.needsUpdate = true;
        }

        if (appState.composer) {
            appState.composer.render();
        } else {
            appState.renderer.render(appState.scene, appState.camera);
        }
        appState.needsRender = false;
    }
}

init();