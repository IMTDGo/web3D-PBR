import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { appState } from './state.js';

// ⬇️ 新增以下 6 行 ⬇️
function updateSlider(id, value, decimals = 2, suffix = '') {
    const slider = document.getElementById(id);
    const label = document.getElementById(id + 'Val');
    if (slider) slider.value = value;
    if (label) label.textContent = value.toFixed(decimals) + suffix;
}
// ⬆️ 新增結束 ⬆️

let isMiddleMouseDown = false;
let previousMousePosition = { x: 0, y: 0 };

export function setupLighting() {
    RectAreaLightUniformsLib.init();
    
    appState.lightPivot = new THREE.Group();
    appState.scene.add(appState.lightPivot);

    appState.ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    appState.scene.add(appState.ambientLight);

    setupLight('top');
    setupLight('left');
    setupLight('right');
    setupLight('sub');

    updateLightTransform('top');
    updateLightTransform('left');
    updateLightTransform('right');
    updateLightTransform('sub');

    appState.hemiLight = new THREE.HemisphereLight(0x87ceeb, 0x543210, 0.2);
    appState.scene.add(appState.hemiLight);

    createLightHelpers();
}

function setupLight(type) {
    const data = appState.lightData[type];
    
    const light = new THREE.RectAreaLight(
        new THREE.Color(data.color).getHex(), 
        data.intensity * 20,
        data.size.width,
        data.size.height
    );
    appState.lightPivot.add(light);
    appState[`${type}Light`] = light;
    
    const shadowLight = new THREE.DirectionalLight(
        new THREE.Color(data.color).getHex(),
        data.intensity * (type === 'top' ? 1.5 : 0.5)
    );
    // 初始值依 UI (shadowsEnabled) 狀態決定，於 init() 同步
    const shadowsCheckbox = document.getElementById('shadowsEnabled');
    shadowLight.castShadow = shadowsCheckbox ? shadowsCheckbox.checked : false;
    const size = 1024; // 預設品質 Low
    shadowLight.shadow.mapSize.width = size;
    shadowLight.shadow.mapSize.height = size;
    shadowLight.shadow.camera.near = 0.5;
    shadowLight.shadow.camera.far = 200;
    // 🚀 VRAM 優化：縮小陰影範圍以提高效率
    shadowLight.shadow.camera.left = -30;
    shadowLight.shadow.camera.right = 30;
    shadowLight.shadow.camera.top = 30;
    shadowLight.shadow.camera.bottom = -30;
    shadowLight.shadow.bias = -0.0001;
    // 🚀 效能優化：模糊採樣從 20 降到 8（視覺差異小但效能提升顯著）
    shadowLight.shadow.blurSamples = 8;
    shadowLight.shadow.radius = type === 'top' ? 3 : 5;
    
    appState.lightPivot.add(shadowLight);
    appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`] = shadowLight;
}

export function updateLightTransform(lightType) {
    const data = appState.lightData[lightType];
    const light = appState[`${lightType}Light`];
    const shadowLight = appState[`shadow${lightType.charAt(0).toUpperCase() + lightType.slice(1)}Light`];
    
    light.position.set(data.position.x, data.position.y, data.position.z);
    light.rotation.set(
        THREE.MathUtils.degToRad(data.rotation.x),
        THREE.MathUtils.degToRad(data.rotation.y),
        THREE.MathUtils.degToRad(data.rotation.z)
    );
    
    if (shadowLight) {
        shadowLight.position.copy(light.position);
        shadowLight.rotation.copy(light.rotation);
        shadowLight.target.position.set(0, 0, 0);
        if (shadowLight.target.parent === null) {
            appState.scene.add(shadowLight.target);
        }
    }
    
    updateAllLightHelpers();
}

export function syncLightDataFromTransform(lightType) {
    const light = appState[`${lightType}Light`];
    const data = appState.lightData[lightType];
    
    data.position.x = light.position.x;
    data.position.y = light.position.y;
    data.position.z = light.position.z;
    
    data.rotation.x = THREE.MathUtils.radToDeg(light.rotation.x);
    data.rotation.y = THREE.MathUtils.radToDeg(light.rotation.y);
    data.rotation.z = THREE.MathUtils.radToDeg(light.rotation.z);
    
    updateLightUI(lightType);
}

export function updateLightUI(lightType) {
    const prefix = lightType + 'Light';
    const data = appState.lightData[lightType];
    
    // ⬇️ 完整替換為以下 6 行 ⬇️
    updateSlider(prefix + 'PosX', data.position.x, 1);
    updateSlider(prefix + 'PosY', data.position.y, 1);
    updateSlider(prefix + 'PosZ', data.position.z, 1);
    updateSlider(prefix + 'RotX', data.rotation.x, 0, '°');
    updateSlider(prefix + 'RotY', data.rotation.y, 0, '°');
    updateSlider(prefix + 'RotZ', data.rotation.z, 0, '°');
    // ⬆️ 替換結束 ⬆️
}

export function updateLightSize(lightType) {
    const data = appState.lightData[lightType];
    const light = appState[`${lightType}Light`];
    
    light.width = data.size.width;
    light.height = data.size.height;
    
    const helper = appState.lightHelpers.find(h => h.userData.lightType === lightType);
    if (helper && helper.geometry) {
        helper.geometry.dispose();
        helper.geometry = new THREE.PlaneGeometry(data.size.width, data.size.height);
    }
}

export function createLightHelpers() {
    appState.lightHelpers.forEach(helper => {
        if (helper.parent) helper.parent.remove(helper);
        if (helper.geometry) helper.geometry.dispose();
        if (helper.material) helper.material.dispose();
    });
    appState.lightHelpers = [];
    
    const helperConfigs = [
        { type: 'top', color: 0xffffff, size: 10 },
        { type: 'left', color: 0xffffff, size: 4 },
        { type: 'right', color: 0xffffff, size: 4 },
        { type: 'sub', color: 0xffa500, size: 3 }
    ];
    
    helperConfigs.forEach(config => {
        const helper = new THREE.Mesh(
            new THREE.PlaneGeometry(config.size, config.size),
            new THREE.MeshBasicMaterial({ 
                color: config.color, 
                wireframe: true,
                transparent: true,
                opacity: 0.7,
                side: THREE.DoubleSide
            })
        );
        helper.userData.lightType = config.type;
        helper.visible = false;
        appState.lightPivot.add(helper);
        appState.lightHelpers.push(helper);
    });
    
    updateAllLightHelpers();
}

export function updateAllLightHelpers() {
    appState.lightHelpers.forEach(helper => {
        const lightType = helper.userData.lightType;
        const light = appState[`${lightType}Light`];
        
        if (light && helper) {
            helper.position.copy(light.position);
            helper.rotation.copy(light.rotation);
        }
    });
}

export function toggleLightHelpers(show) {
    appState.lightHelpers.forEach(helper => helper.visible = show);
    if (show) updateAllLightHelpers();
}

export function toggleShadows(enabled) {
    if (appState.shadowTopLight) appState.shadowTopLight.castShadow = enabled;
    if (appState.shadowLeftLight) appState.shadowLeftLight.castShadow = enabled;
    if (appState.shadowRightLight) appState.shadowRightLight.castShadow = enabled;
    if (appState.shadowSubLight) appState.shadowSubLight.castShadow = enabled;
    if (appState.groundPlane) appState.groundPlane.receiveShadow = enabled;
    // ⬇️ 完整替換為以下 3 行 ⬇️
    appState.meshCache.forEach(mesh => {
        mesh.castShadow = enabled;
        mesh.receiveShadow = enabled;
    });
    // ⬆️ 替換結束 ⬆️
}

export function updateShadowQuality(quality) {
    let size = quality === 'low' ? 1024 : (quality === 'high' ? 4096 : 2048);
    // H8 修正：釋放舊的 shadow RenderTarget，避免 VRAM 洩漏
    const resetShadowMap = (light, s) => {
        if (!light) return;
        light.shadow.mapSize.width = s;
        light.shadow.mapSize.height = s;
        if (light.shadow.map) {
            light.shadow.map.dispose();
            light.shadow.map = null;
        }
    };
    resetShadowMap(appState.shadowTopLight, size);
    const lowerSize = Math.max(1024, size / 2);
    resetShadowMap(appState.shadowLeftLight, lowerSize);
    resetShadowMap(appState.shadowRightLight, lowerSize);
    resetShadowMap(appState.shadowSubLight, lowerSize);
}

export function updateShadowSoftness(softness) {
    if (appState.shadowTopLight) appState.shadowTopLight.shadow.radius = softness;
    if (appState.shadowLeftLight) appState.shadowLeftLight.shadow.radius = softness + 1;
    if (appState.shadowRightLight) appState.shadowRightLight.shadow.radius = softness + 1;
    if (appState.shadowSubLight) appState.shadowSubLight.shadow.radius = softness + 2;
}

export function updateModelShadowIntensity(opacity) {
    // 根據陰影濃度調整環境光與半球光強度，模擬陰影深淺
    // Opacity 越高 (陰影越深) -> 環境光越弱；Opacity 越低 (陰影越淡) -> 環境光越強
    const intensityFactor = 1.0 - opacity;
    if (appState.ambientLight) appState.ambientLight.intensity = intensityFactor * 0.5;
    if (appState.hemiLight) appState.hemiLight.intensity = intensityFactor * 0.6;
}

export function setupLightUIEvents() {
    // Light interaction (Middle Mouse)
    const handleMouseDown = (e) => { if (e.button === 1) { isMiddleMouseDown = true; previousMousePosition = { x: e.clientX, y: e.clientY }; e.preventDefault(); } };
    appState.renderer.domElement.removeEventListener('mousedown', handleMouseDown);
    appState.renderer.domElement.addEventListener('mousedown', handleMouseDown);
    
    const handleMouseMove = (e) => {
        if (isMiddleMouseDown) {
            const deltaX = e.clientX - previousMousePosition.x;
            appState.lightPivot.rotation.y += deltaX * 0.01;
            appState.lightPivotRotationY = appState.lightPivot.rotation.y;
            // C6 修正：Texture.rotation 是 UV 旋轉，對 PBR env 取樣無效。
            // 正確做法是使用 scene.environmentRotation (Euler)。
            appState.scene.environmentRotation.y = appState.lightPivot.rotation.y;
            appState.scene.backgroundRotation.y = appState.lightPivot.rotation.y;
            // C7 修正：pivot 旋轉不會改變子光源 local transform，
            // 不再呼叫 syncLightDataFromTransform，避免 UI 與內部資料失準。
            previousMousePosition = { x: e.clientX, y: e.clientY };
            appState.needsRender = true;
        }
    };
    appState.renderer.domElement.removeEventListener('mousemove', handleMouseMove);
    appState.renderer.domElement.addEventListener('mousemove', handleMouseMove);

    appState.renderer.domElement.addEventListener('mouseup', (e) => { if (e.button === 1) isMiddleMouseDown = false; });

    // Lights UI
    ['top', 'left', 'right', 'sub'].forEach(type => {
        const prefix = type + 'Light';
        document.getElementById(prefix + 'Enabled').addEventListener('change', (e) => {
            appState.lightData[type].enabled = e.target.checked;
            appState[`${type}Light`].visible = e.target.checked;
            if (appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`]) appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`].visible = e.target.checked;
            document.getElementById(prefix + 'Controls').style.display = e.target.checked ? 'block' : 'none';
        });
        ['PosX', 'PosY', 'PosZ'].forEach(axis => {
            document.getElementById(prefix + axis).addEventListener('input', (e) => {
                appState.lightData[type].position[axis.toLowerCase().slice(-1)] = parseFloat(e.target.value);
                document.getElementById(prefix + axis + 'Val').textContent = parseFloat(e.target.value).toFixed(1);
                updateLightTransform(type);
            });
        });
        ['RotX', 'RotY', 'RotZ'].forEach(axis => {
            document.getElementById(prefix + axis).addEventListener('input', (e) => {
                appState.lightData[type].rotation[axis.toLowerCase().slice(-1)] = parseFloat(e.target.value);
                document.getElementById(prefix + axis + 'Val').textContent = e.target.value + '°';
                updateLightTransform(type);
            });
        });
        document.getElementById(prefix + 'Color').addEventListener('input', (e) => {
            appState.lightData[type].color = e.target.value;
            appState[`${type}Light`].color.set(e.target.value);
            if (appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`]) appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`].color.set(e.target.value);
        });
        document.getElementById(prefix + 'Intensity').addEventListener('input', (e) => {
            appState.lightData[type].intensity = parseFloat(e.target.value);
            document.getElementById(prefix + 'IntensityVal').textContent = e.target.value;
            appState[`${type}Light`].intensity = parseFloat(e.target.value) * 20;
            const shadowLight = appState[`shadow${type.charAt(0).toUpperCase() + type.slice(1)}Light`];
            if (shadowLight) shadowLight.intensity = parseFloat(e.target.value) * (type === 'top' ? 0.8 : 0.4);
        });
        document.getElementById(prefix + 'Width').addEventListener('input', (e) => {
            appState.lightData[type].size.width = parseFloat(e.target.value);
            document.getElementById(prefix + 'WidthVal').textContent = parseFloat(e.target.value).toFixed(1);
            updateLightSize(type);
        });
        document.getElementById(prefix + 'Height').addEventListener('input', (e) => {
            appState.lightData[type].size.height = parseFloat(e.target.value);
            document.getElementById(prefix + 'HeightVal').textContent = parseFloat(e.target.value).toFixed(1);
            updateLightSize(type);
        });
    });

    document.getElementById('showLightHelpers').addEventListener('change', (e) => toggleLightHelpers(e.target.checked));

    // Shadows
    document.getElementById('shadowsEnabled').addEventListener('change', (e) => {
        toggleShadows(e.target.checked);
        document.getElementById('shadowControls').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('shadowQuality').addEventListener('change', (e) => updateShadowQuality(e.target.value));
    document.getElementById('shadowSoftness').addEventListener('input', (e) => { document.getElementById('shadowSoftnessVal').textContent = e.target.value; updateShadowSoftness(parseInt(e.target.value)); });
    
    document.getElementById('shadowOpacity').addEventListener('input', (e) => {
        document.getElementById('shadowOpacityVal').textContent = e.target.value;
        // updateShadowOpacity(parseFloat(e.target.value)); // 停用地板陰影更新，保持地板無陰影
        updateModelShadowIntensity(parseFloat(e.target.value));
    });
}