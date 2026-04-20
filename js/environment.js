import * as THREE from 'three';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { appState } from './state.js';

export function createGrid(size = 20) {
    // 移除舊的網格與陰影平面，防止疊加
    if (appState.gridHelper) {
        // H5 修正：將舊 GridHelper 的 geometry/material 全部 dispose，避免 GPU 資源洩漏
        appState.gridHelper.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(m => m.dispose());
            }
        });
        appState.scene.remove(appState.gridHelper);
    }
    if (appState.groundPlane) {
        appState.scene.remove(appState.groundPlane);
        if (appState.groundPlane.geometry) appState.groundPlane.geometry.dispose();
        if (appState.groundPlane.material) appState.groundPlane.material.dispose();
    }

    // 建立新網格
    const mainGrid = new THREE.GridHelper(size, size, 0x888888, 0x444444);
    
    const subSize = Math.max(10, size / 2);
    const limitedGrid = new THREE.GridHelper(subSize, subSize, 0xaaaaaa, 0x555555);
    limitedGrid.position.y = 0.01;
    
    appState.gridHelper = new THREE.Group();
    appState.gridHelper.add(mainGrid);
    appState.gridHelper.add(limitedGrid);
    appState.scene.add(appState.gridHelper);

    // 建立陰影平面 (讀取目前的陰影濃度設定)
    // ⬇️ 完整替換為以下 2 行 ⬇️
    const opacityElem = document.getElementById('shadowOpacity');
    const currentOpacity = opacityElem ? parseFloat(opacityElem.value) : 0;
    // ⬆️ 替換結束 ⬆️
    const planeGeometry = new THREE.PlaneGeometry(100, 100);
    const planeMaterial = new THREE.ShadowMaterial({ opacity: currentOpacity });
    appState.groundPlane = new THREE.Mesh(planeGeometry, planeMaterial);
    appState.groundPlane.rotation.x = -Math.PI / 2;
    appState.groundPlane.receiveShadow = true;
    appState.groundPlane.position.y = -0.01;
    appState.scene.add(appState.groundPlane);
    
    // 確保可見性狀態與 UI 一致
    const showGrid = document.getElementById('showGrid');
    if (showGrid) {
        appState.gridHelper.visible = showGrid.checked;
    }
    // 陰影平面應始終保持開啟 (ShadowMaterial 僅在有陰影時顯示)
    appState.groundPlane.visible = true;
}

export function updateShadowOpacity(val) {
    if (appState.groundPlane && appState.groundPlane.material) {
        appState.groundPlane.material.opacity = val;
    }
}

export function createGroundReflection() {
    if (appState.groundMirror) {
        appState.scene.remove(appState.groundMirror);
        if (appState.groundMirror.geometry) appState.groundMirror.geometry.dispose();
        if (appState.groundMirror.material) appState.groundMirror.material.dispose();
    }
    
    const groundGeometry = new THREE.PlaneGeometry(100, 100);
    
    appState.groundMirror = new Reflector(groundGeometry, {
        clipBias: 0.003,
        textureWidth: window.innerWidth * window.devicePixelRatio * 0.5,
        textureHeight: window.innerHeight * window.devicePixelRatio * 0.5,
        color: 0x888888,
        multisample: 4
    });
    
    appState.groundMirror.position.y = -0.02;
    appState.groundMirror.rotation.x = -Math.PI / 2;
    // 防止在特定角度或近距離時反射平面被錯誤剔除
    appState.groundMirror.frustumCulled = false;
    
    // 修正 1: 注入 Opacity 支援 (讓反射強度設定生效)
    // Reflector 預設 Shader 不支援透明度，我們需要手動修改 Fragment Shader
    appState.groundMirror.material.transparent = true;
    appState.groundMirror.material.uniforms.opacity = { value: 0.5 };
    appState.groundMirror.material.uniforms.fadeStart = { value: 0.0 };
    appState.groundMirror.material.uniforms.fadeEnd = { value: 0.5 };
    
    // 修改 Vertex Shader 以傳遞 UV (用於計算漸層)
    const vertexShader = appState.groundMirror.material.vertexShader;
    appState.groundMirror.material.vertexShader = vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vPlaneUv;')
        .replace('#include <logdepthbuf_vertex>', '#include <logdepthbuf_vertex>\nvPlaneUv = uv;');

    const fragmentShader = appState.groundMirror.material.fragmentShader;
    // 替換 Shader 中的 alpha 值，並加入徑向漸層衰減
    const newFragmentShader = fragmentShader
        .replace('#include <logdepthbuf_pars_fragment>', '#include <logdepthbuf_pars_fragment>\nvarying vec2 vPlaneUv;')
        .replace(
            'gl_FragColor = vec4( blendOverlay( base.rgb, color ), 1.0 );',
            `
                float dist = distance(vPlaneUv, vec2(0.5));
                float fade = 1.0 - smoothstep(fadeStart, fadeEnd, dist);
                gl_FragColor = vec4( base.rgb, opacity * fade );
            `
        );

    appState.groundMirror.material.fragmentShader = `
        uniform float opacity;
        uniform float fadeStart;
        uniform float fadeEnd;
        ${newFragmentShader}
    `;

    // 修正 2: 在渲染反射時隱藏網格與陰影平面 (防止網格出現在倒影中或產生干擾)
    const originalOnBeforeRender = appState.groundMirror.onBeforeRender;
    appState.groundMirror.onBeforeRender = function(renderer, scene, camera) {
        const gridVisible = appState.gridHelper ? appState.gridHelper.visible : false;
        const shadowVisible = appState.groundPlane ? appState.groundPlane.visible : false;
        
        // 暫時隱藏網格和陰影平面
        if (appState.gridHelper) appState.gridHelper.visible = false;
        if (appState.groundPlane) appState.groundPlane.visible = false;
        
        originalOnBeforeRender.call(this, renderer, scene, camera);
        
        // 恢復顯示狀態
        if (appState.gridHelper) appState.gridHelper.visible = gridVisible;
        if (appState.groundPlane) appState.groundPlane.visible = shadowVisible;
    };

    appState.scene.add(appState.groundMirror);
    
    updateGroundReflection();
}

export function updateGroundReflection() {
    if (!appState.groundMirror) return;
    
    const strengthEl = document.getElementById('reflectionStrength');
    const startEl = document.getElementById('reflectionFadeStart');
    const endEl = document.getElementById('reflectionFadeEnd');
    if (!strengthEl || !startEl || !endEl) return;
    const strength = parseFloat(strengthEl.value);
    const start = parseFloat(startEl.value);
    const end = parseFloat(endEl.value);
    
    // 更新我們注入的 opacity uniform
    if (appState.groundMirror.material && appState.groundMirror.material.uniforms.opacity) {
        appState.groundMirror.material.uniforms.opacity.value = strength;
        appState.groundMirror.material.uniforms.fadeStart.value = start;
        appState.groundMirror.material.uniforms.fadeEnd.value = end;
    }
}

export function toggleGroundReflection(enabled) {
    if (appState.groundMirror) {
        appState.groundMirror.visible = enabled;
    }
}

export async function loadHDRI(hdriName) {
    if (hdriName === 'gradient') {
        // M5 修正：切回 gradient 時，釋放舊的 HDRI texture 以釋放 VRAM
        if (appState.currentHDRI) {
            appState.currentHDRI.dispose();
            appState.currentHDRI = null;
        }
        updateHDR();
        return;
    }
    
    // 🚀 VRAM 優化：使用 1K HDRI（對於預覽已經足夠，節省大量 VRAM）
    const hdriFiles = {
        'studio': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/studio_small_09_1k.hdr',
        'warehouse': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/empty_warehouse_01_1k.hdr',
        'outdoor': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/kloppenheim_06_1k.hdr',
        'sunset': 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/sunset_in_the_chalk_quarry_1k.hdr'
    };
    
    const hdriUrl = hdriFiles[hdriName];
    if (!hdriUrl) return;
    
    document.getElementById('loading').style.display = 'block';
    document.getElementById('loading').textContent = '載入環境貼圖...';
    
    try {
        if (!appState.rgbeLoader) appState.rgbeLoader = new RGBELoader();
        
        const texture = await new Promise((resolve, reject) => {
            appState.rgbeLoader.load(hdriUrl, resolve, undefined, reject);
        });
        
        texture.mapping = THREE.EquirectangularReflectionMapping;
        // --- VRAM 優化：釋放舊的 HDRI 貼圖 ---
        if (appState.currentHDRI) appState.currentHDRI.dispose();
        appState.currentHDRI = texture;
        
        if (appState.hdrEnabled) {
            appState.scene.environment = texture;
            appState.scene.background = texture;
            appState.scene.environmentIntensity = appState.hdrIntensity;
            
            appState.materials.forEach(matInfo => {
                matInfo.material.envMapIntensity = appState.hdrIntensity;
                matInfo.material.needsUpdate = true;
            });
        }
    } catch (error) {
        console.error('HDRI 載入失敗:', error);
        alert('HDRI 載入失敗');
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('loading').textContent = '載入中...';
    }
}

export function updateHDR() {
    if (appState.currentHDRI && document.getElementById('hdriSelect').value !== 'gradient') {
        if (appState.hdrEnabled) {
            appState.scene.environment = appState.currentHDRI;
            appState.scene.background = appState.currentHDRI;
            appState.scene.environmentIntensity = appState.hdrIntensity;
        } else {
            appState.scene.environment = null;
            appState.scene.background = new THREE.Color(document.getElementById('backgroundColor').value);
        }
        return;
    }

    const pmremGenerator = new THREE.PMREMGenerator(appState.renderer);
    pmremGenerator.compileEquirectangularShader();
    
    const skyColor = new THREE.Color(document.getElementById('hdrSkyColor')?.value || '#87ceeb');
    const groundColor = new THREE.Color(document.getElementById('hdrGroundColor')?.value || '#543210');
    
    const envScene = new THREE.Scene();
    const vertexShader = `
        varying vec3 vWorldPosition;
        void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;
    const fragmentShader = `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
            float h = normalize(vWorldPosition).y;
            gl_FragColor = vec4(mix(bottomColor, topColor, max(h, 0.0)), 1.0);
        }
    `;
    
    const skyGeo = new THREE.SphereGeometry(100, 32, 15);
    const skyMat = new THREE.ShaderMaterial({
        vertexShader, fragmentShader,
        uniforms: { topColor: { value: skyColor }, bottomColor: { value: groundColor } },
        side: THREE.BackSide
    });
    
    envScene.add(new THREE.Mesh(skyGeo, skyMat));
    
    if (appState.envMap) appState.envMap.dispose();
    appState.envMap = pmremGenerator.fromScene(envScene).texture;
    
    if (appState.hdrEnabled) {
        appState.scene.environment = appState.envMap;
        appState.scene.environmentIntensity = appState.hdrIntensity;
        appState.materials.forEach(matInfo => matInfo.material.envMapIntensity = appState.hdrIntensity);
    } else {
        appState.scene.environment = null;
        appState.scene.environmentIntensity = 0;
        appState.materials.forEach(matInfo => matInfo.material.envMapIntensity = 0);
    }
    
    // H2 修正：釋放臨時 sphere 資源，避免每次更新 HDR 都洩漏 geometry/material
    skyGeo.dispose();
    skyMat.dispose();
    pmremGenerator.dispose();
}

export function setupEnvironmentUIEvents() {
    document.getElementById('showGrid').addEventListener('change', (e) => {
        if (appState.gridHelper) appState.gridHelper.visible = e.target.checked;
    });

    document.getElementById('gridSize').addEventListener('input', (e) => {
        const size = parseInt(e.target.value);
        document.getElementById('gridSizeVal').textContent = size;
        createGrid(size); // 傳入新的大小
    });

    document.getElementById('backgroundColor').addEventListener('input', (e) => appState.scene.background = new THREE.Color(e.target.value));

    // HDR
    document.getElementById('hdrEnabled').addEventListener('change', (e) => {
        appState.hdrEnabled = e.target.checked;
        document.getElementById('hdrControls').style.display = e.target.checked ? 'block' : 'none';
        updateHDR();
    });
    document.getElementById('hdrIntensity').addEventListener('input', (e) => {
        appState.hdrIntensity = parseFloat(e.target.value);
        document.getElementById('hdrIntensityVal').textContent = e.target.value;
        updateHDR();
    });
    document.getElementById('hdrSkyColor').addEventListener('input', updateHDR);
    document.getElementById('hdrGroundColor').addEventListener('input', updateHDR);
    document.getElementById('hdriSelect').addEventListener('change', (e) => loadHDRI(e.target.value));

    // Ground Reflection （目前 UI 已移除，隐藏元素仍存在以避免 JS 錯誤）
    // C4 修正：一律 null-guard，避免對不存在的 Val/Controls 元素寫入屬性
    const groundRefEnabled = document.getElementById('groundReflectionEnabled');
    if (groundRefEnabled) {
        groundRefEnabled.addEventListener('change', (e) => {
            toggleGroundReflection(e.target.checked);
            const ctrl = document.getElementById('groundReflectionControls');
            if (ctrl) ctrl.style.display = e.target.checked ? 'block' : 'none';
        });
    }
    const addReflectListener = (inputId, valId) => {
        const input = document.getElementById(inputId);
        if (!input) return;
        input.addEventListener('input', (e) => {
            const val = document.getElementById(valId);
            if (val) val.textContent = parseFloat(e.target.value).toFixed(2);
            updateGroundReflection();
        });
    };
    addReflectListener('reflectionStrength', 'reflectionStrengthVal');
    addReflectListener('reflectionFadeStart', 'reflectionFadeStartVal');
    addReflectListener('reflectionFadeEnd', 'reflectionFadeEndVal');
}