import * as THREE from 'three';
import { appState } from './state.js';
import { showWarning, blendColors } from './utils.js';
import { updateUVEditorFromMaterial } from './uv-editor.js';
import { setupMaterialChannels, onBaseColorLoaded } from './transmission.js';
import { updateSSSUIFromMaterial } from './SSSManager.js';

// ⬇️ 新增以下 6 行 ⬇️
function updateSlider(id, value, decimals = 2, suffix = '') {
    const slider = document.getElementById(id);
    const label = document.getElementById(id + 'Val');
    if (slider) slider.value = value;
    if (label) label.textContent = value.toFixed(decimals) + suffix;
}
// ⬆️ 新增結束 ⬆️

export function updateMaterialSelect() {
    const select = document.getElementById('materialSelect');
    select.innerHTML = '';
    appState.materials.forEach((mat, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = mat.name;
        select.appendChild(option);
    });
    if (appState.materials.length > 0) selectMaterial({ target: { value: 0 }});
}

export function selectMaterial(event) {
    const index = parseInt(event.target.value);
    if (index >= 0 && index < appState.materials.length) {
        appState.currentMaterial = appState.materials[index].material;
        updateUIFromMaterial();
        updateAnisotropyTexture();
        updateUVEditorFromMaterial();
        setTimeout(updateAllTexturePreviews, 200);
    }
}

// 拖曳偵測：記錄 mousedown 位置，放開時若位移超過閾值則不觸發選取
let _mouseDownX = 0;
let _mouseDownY = 0;
const DRAG_THRESHOLD_SQ = 16; // 4px 以上視為拖曳

function _onViewportMouseDown(e) {
    _mouseDownX = e.clientX;
    _mouseDownY = e.clientY;
}

function _onViewportClickGuarded(e) {
    const dx = e.clientX - _mouseDownX;
    const dy = e.clientY - _mouseDownY;
    if (dx * dx + dy * dy > DRAG_THRESHOLD_SQ) return; // 拖曳後不選取
    onViewportClick(e);
}

export function onViewportClick(event) {
    const rect = appState.renderer.domElement.getBoundingClientRect();
    appState.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    appState.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    
    appState.raycaster.setFromCamera(appState.mouse, appState.camera);
    
    if (appState.currentModel) {
        const intersects = appState.raycaster.intersectObject(appState.currentModel, true);
        if (intersects.length > 0) {
            const clickedMaterial = intersects[0].object.material;
            const materialIndex = appState.materials.findIndex(m => m.material === clickedMaterial);
            if (materialIndex !== -1) {
                document.getElementById('materialSelect').value = materialIndex;
                selectMaterial({ target: { value: materialIndex }});
                highlightMaterial(clickedMaterial);
            }
        }
    }
}

export function highlightMaterial(material) {
    // H6 修正：使用 userData 管理每個材質的 timeout，
    // 避免使用者在 500ms 內編輯 emissive 時被覆蓋。
    if (material.userData._highlightTimeout) {
        clearTimeout(material.userData._highlightTimeout);
    } else {
        // 僅在首次高亮時備份原值
        material.userData._highlightOrigEmissive = material.emissive.clone();
        material.userData._highlightOrigIntensity = material.emissiveIntensity;
    }
    material.emissive.set(0x4a9eff);
    material.emissiveIntensity = 0.3;
    material.userData._highlightTimeout = setTimeout(() => {
        material.emissive.copy(material.userData._highlightOrigEmissive);
        material.emissiveIntensity = material.userData._highlightOrigIntensity;
        material.userData._highlightTimeout = null;
    }, 500);
}

export function updateUIFromMaterial() {
    if (!appState.currentMaterial) return;
    const mat = appState.currentMaterial;
    // H1 修正：完整同步所有材質控制項，避免切換材質後 UI 顯示舊數值
    updateSlider('roughness', mat.roughness ?? 0.5);
    updateSlider('metallic', mat.metalness ?? 0);
    const ns = (mat.normalMap && mat.normalScale) ? mat.normalScale.x : 1;
    updateSlider('normalScale', ns);
    updateSlider('aoIntensity', mat.aoMapIntensity ?? 1);
    updateSlider('lightMapIntensity', mat.lightMapIntensity ?? 1);
    updateSlider('emissiveIntensity', mat.emissiveIntensity ?? 1);
    updateSlider('sheen', mat.sheen ?? 0);
    updateSlider('sheenRoughness', mat.sheenRoughness ?? 1);
    updateSlider('clearcoat', mat.clearcoat ?? 0);
    updateSlider('clearcoatRoughness', mat.clearcoatRoughness ?? 0);
    updateSlider('anisotropy', mat.anisotropy ?? 0);
    // anisotropyRotation 用自定義卡格 (角度)
    const rotSlider = document.getElementById('anisotropyRotation');
    const rotVal = document.getElementById('anisotropyRotationVal');
    if (rotSlider) rotSlider.value = appState.anisotropyRotation;
    if (rotVal) rotVal.textContent = appState.anisotropyRotation.toFixed(0) + '°';
    // 顏色選擇器
    const setColor = (id, col) => {
        const el = document.getElementById(id);
        if (el && col) el.value = '#' + col.getHexString();
    };
    setColor('baseColor', mat.color);
    setColor('emissiveColor', mat.emissive);
    setColor('sheenColor', mat.sheenColor);
    setupMaterialChannels(mat);
    updateSSSUIFromMaterial();
    updateUVEditorFromMaterial();
}

export function updateMaterial(property, value) {
    if (!appState.currentMaterial) return;
    // M3 修正：anisotropyRotation 使用度號格式，其他才用 toFixed(2)，避免 label 闃爐
    if (property !== 'anisotropyRotation') {
        const valEl = document.getElementById(property + 'Val');
        if (valEl) valEl.textContent = value.toFixed(2);
    }
    
    // 🚀 效能優化：批量更新屬性，避免多次 needsUpdate
    let needsUpdate = false;
    
    switch(property) {
        case 'roughness': 
            appState.currentMaterial.roughness = value; 
            needsUpdate = true;
            break;
        case 'metallic': 
            appState.currentMaterial.metalness = value; 
            needsUpdate = true;
            break;
        case 'normalScale': 
            if (appState.currentMaterial.normalMap) {
                appState.currentMaterial.normalScale.set(value, value);
                needsUpdate = true;
            }
            break;
        case 'aoIntensity': 
            appState.currentMaterial.aoMapIntensity = value; 
            needsUpdate = true;
            break;
        case 'lightMapIntensity': 
            appState.currentMaterial.lightMapIntensity = value; 
            needsUpdate = true;
            break;
        case 'emissiveIntensity': 
            appState.currentMaterial.emissiveIntensity = value; 
            needsUpdate = true;
            break;
        case 'sheen': 
            appState.currentMaterial.sheen = value; 
            needsUpdate = true;
            break;
        case 'sheenRoughness': 
            appState.currentMaterial.sheenRoughness = value; 
            needsUpdate = true;
            break;
        case 'clearcoat': 
            appState.currentMaterial.clearcoat = value; 
            needsUpdate = true;
            break;
        case 'clearcoatRoughness': 
            appState.currentMaterial.clearcoatRoughness = value; 
            needsUpdate = true;
            break;
        case 'anisotropy': 
            appState.currentMaterial.anisotropy = value; 
            updateAnisotropyTexture(); 
            needsUpdate = true;
            break;
        case 'anisotropyRotation': 
            appState.anisotropyRotation = value;
            document.getElementById('anisotropyRotationVal').textContent = value.toFixed(0) + '°';
            updateAnisotropyTexture();
            needsUpdate = true;
            break;
    }
    
    // 只調用一次 needsUpdate
    if (needsUpdate) {
        appState.currentMaterial.needsUpdate = true;
    }
}

export function loadTexture(file, mapName) {
    if (!file || !appState.currentMaterial) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        // 🚀 VRAM 優化：圖片載入前先處理尺寸
        const img = new Image();
        img.onload = function() {
            const MAX_SIZE = 2048; // 限制最大解析度以節省 VRAM
            const needsResize = img.width > MAX_SIZE || img.height > MAX_SIZE;
            
            let finalImage = img;
            if (needsResize) {
                // 自動縮放過大的貼圖
                const scale = Math.min(MAX_SIZE / img.width, MAX_SIZE / img.height);
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(img.width * scale);
                canvas.height = Math.floor(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                finalImage = canvas;
                console.log(`⚡ 貼圖已自動縮放: ${img.width}x${img.height} → ${canvas.width}x${canvas.height}`);
            }
            
            const texture = new THREE.Texture(finalImage);
            texture.needsUpdate = true;
            
            // 顏色貼圖使用 SRGB，數據貼圖使用線性 (NoColorSpace)
            const isColorData = ['map', 'emissiveMap', 'sheenColorMap'].includes(mapName);
            texture.colorSpace = isColorData ? THREE.SRGBColorSpace : THREE.NoColorSpace;

            // 預設開啟 RepeatWrapping 以支援 UV 縮放
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            
            // 🚀 VRAM 優化：降低 Anisotropy 從 4 到 2（視覺差異極小但 VRAM 節省明顯）
            texture.generateMipmaps = true;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.anisotropy = 2;
            
            // Sync with current UV settings if available
            const uvScaleX = document.getElementById('uvScaleX');
            const currentScale = uvScaleX ? parseFloat(uvScaleX.value) : 1.0;
            if (currentScale) texture.repeat.set(currentScale, currentScale);

            if (mapName === 'aoMap' || mapName === 'lightMap') texture.channel = 1;
           
            // 釋放舊貼圖以節省 VRAM
            if (appState.currentMaterial[mapName]) {
                appState.currentMaterial[mapName].dispose();
            }
            
            appState.currentMaterial[mapName] = texture;
            if (mapName === 'normalMap') appState.currentMaterial.normalScale = new THREE.Vector2(1, 1);
            
            if (mapName === 'map') {
                onBaseColorLoaded(appState.currentMaterial);
            }
            
            // 當手動上傳 Roughness 貼圖時，自動將數值設為 1.0，避免貼圖效果被打折
            if (mapName === 'roughnessMap') {
                appState.currentMaterial.roughness = 1.0;
                const slider = document.getElementById('roughness');
                if (slider) slider.value = "1.0";
                const val = document.getElementById('roughnessVal');
                if (val) val.textContent = "1.00";
            }
            
            appState.currentMaterial.needsUpdate = true;
            // H7 修正：該呼叫 updateUVs() 同步 offset/rotation/scaleY，
            // 使新貼圖與其他通道一致；動態 import 避免循環依賴
            import('./uv-editor.js').then(m => {
                if (m.updateUVs) m.updateUVs();
                m.updateUVEditorFromMaterial();
            });
            updateTexturePreview(mapName, texture);
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

// 綁定到 window 以供 HTML onclick 使用
window.clearTexture = function(mapName) {
    if (!appState.currentMaterial) return;
    appState.currentMaterial[mapName] = null;
    appState.currentMaterial.needsUpdate = true;
    updateTexturePreview(mapName, null);
};

export function updateTexturePreview(mapName, texture) {
    const previewElement = document.getElementById('preview-' + mapName);
    if (!previewElement) return;
    
    if (!texture) {
        previewElement.className = 'w-16 h-16 border-2 border-dashed border-base-content/20 rounded bg-base-200 flex items-center justify-center overflow-hidden shrink-0 text-xs text-base-content/50';
        previewElement.innerHTML = '<span>無</span>';
        return;
    }
    
    // 簡化版預覽邏輯
    let imgSrc = null;
    if (texture.image) {
        if (texture.image.src) {
            imgSrc = texture.image.src;
        } else if (texture.image instanceof ImageBitmap || texture.image instanceof HTMLCanvasElement || texture.image instanceof HTMLImageElement) {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = texture.image.width;
                canvas.height = texture.image.height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(texture.image, 0, 0);
                imgSrc = canvas.toDataURL();
            } catch (e) { console.warn('Preview generation failed', e); }
        }
    }

    if (imgSrc) {
        previewElement.className = 'w-16 h-16 border-2 border-base-content/20 rounded bg-base-200 flex items-center justify-center overflow-hidden shrink-0';
        previewElement.innerHTML = `<img src="${imgSrc}" style="width:100%;height:100%;object-fit:cover;">`;
    } else {
        previewElement.className = 'w-16 h-16 border-2 border-dashed border-base-content/20 rounded bg-base-200 flex items-center justify-center overflow-hidden shrink-0 text-xs text-base-content/50';
        previewElement.innerHTML = '<span>有貼圖</span>';
    }
}

export function updateAllTexturePreviews() {
    if (!appState.currentMaterial) return;
    ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'lightMap', 'emissiveMap', 'alphaMap', 'transmissionMap'].forEach(type => {
        updateTexturePreview(type, appState.currentMaterial[type]);
    });
}

export function applyBatchAdjustments(isPreview = false) {
    if (appState.materials.length === 0) { alert('請先載入 FBX 模型'); return; }
    
    const enableColorBlend = document.getElementById('enableBatchColor').checked;
    const blendColor = new THREE.Color(document.getElementById('batchColor').value);
    const blendMode = document.getElementById('batchBlendMode').value;
    const opacity = parseFloat(document.getElementById('batchOpacity').value);
    const roughnessMultiplier = parseFloat(document.getElementById('batchRoughness').value);
    const normalScale = parseFloat(document.getElementById('batchNormalScale').value);
    
    appState.materials.forEach((matInfo, index) => {
        const mat = matInfo.material;
        const originalData = appState.originalMaterialData[index];
        if (!originalData) return;
        
        if (enableColorBlend) mat.color = blendColors(originalData.color, blendColor, blendMode, opacity);
        else mat.color.copy(originalData.color);
        
        mat.roughness = Math.max(0, Math.min(1.5, originalData.roughness * roughnessMultiplier));
        if (mat.normalMap && originalData.normalScale) {
            mat.normalScale.set(originalData.normalScale.x * normalScale, originalData.normalScale.y * normalScale);
        }
        mat.needsUpdate = true;
    });
    
    if (appState.currentMaterial) updateUIFromMaterial();
    if (!isPreview) showWarning(`✅ 已套用批量調整`, [], false);
}

export function resetBatchAdjustments() {
    if (appState.materials.length === 0) return;
    appState.materials.forEach((matInfo, index) => {
        const mat = matInfo.material;
        const originalData = appState.originalMaterialData[index];
        if (!originalData) return;
        mat.color.copy(originalData.color);
        mat.roughness = originalData.roughness;
        mat.metalness = originalData.metalness;
        if (mat.normalMap && originalData.normalScale) mat.normalScale.copy(originalData.normalScale);
        mat.needsUpdate = true;
    });
    
    document.getElementById('enableBatchColor').checked = false;
    document.getElementById('batchColorControls').style.display = 'none';
    document.getElementById('batchRoughness').value = 1;
    document.getElementById('batchRoughnessVal').textContent = '×1.0';
    document.getElementById('enableBatchPreview').checked = false;
    
    if (appState.currentMaterial) updateUIFromMaterial();
    showWarning('🔄 已重置所有批量調整', [], false);
}

export function updateAnisotropyTexture() {
    if (!appState.currentMaterial) return;
    const anisotropyValue = parseFloat(document.getElementById('anisotropy').value);
    
    if (anisotropyValue === 0) {
        appState.currentMaterial.anisotropyMap = null;
        appState.currentMaterial.anisotropy = 0;
        appState.currentMaterial.needsUpdate = true;
        return;
    }
    
    appState.currentMaterial.anisotropy = anisotropyValue;
    const size = 512;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const imageData = ctx.createImageData(size, size);
    const data = imageData.data;
    const centerX = size/2, centerY = size/2;
    const rotRad = (appState.anisotropyRotation * Math.PI) / 180;
    
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const idx = (y * size + x) * 4;
            let tangentX, tangentY;
            
            if (appState.anisotropyPattern === 'linear') {
                tangentX = Math.cos(rotRad);
                tangentY = Math.sin(rotRad);
            } else {
                const angle = Math.atan2(y - centerY, x - centerX);
                tangentX = Math.cos(angle + Math.PI / 2 + rotRad);
                tangentY = Math.sin(angle + Math.PI / 2 + rotRad);
            }
            
            data[idx] = Math.floor((tangentX * 0.5 + 0.5) * 255);
            data[idx+1] = Math.floor((tangentY * 0.5 + 0.5) * 255);
            data[idx+2] = 128;
            data[idx+3] = 255;
        }
    }
    ctx.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    // 🚀 VRAM 優化：釋放舊的 anisotropyMap，避免每次滑動都洩漏紋理
    if (appState.currentMaterial.anisotropyMap) appState.currentMaterial.anisotropyMap.dispose();
    appState.currentMaterial.anisotropyMap = texture;
    appState.currentMaterial.needsUpdate = true;
}

// ⬇️ 新增這 2 行 ⬇️
let batchTimeout;
// ⬆️ 新增結束 ⬆️

export function setupMaterialUIEvents() {
    document.getElementById('materialSelect').addEventListener('change', selectMaterial);
    
    const sliders = ['roughness', 'metallic', 'normalScale', 'aoIntensity', 'lightMapIntensity', 'emissiveIntensity', 'sheen', 'sheenRoughness', 'clearcoat', 'clearcoatRoughness', 'anisotropy', 'anisotropyRotation'];
    sliders.forEach(id => {
        const elem = document.getElementById(id);
        elem.addEventListener('input', () => updateMaterial(id, parseFloat(elem.value)));
    });
                
    document.getElementById('baseColor').addEventListener('input', (e) => { if (appState.currentMaterial) appState.currentMaterial.color.set(e.target.value); });
    document.getElementById('emissiveColor').addEventListener('input', (e) => { if (appState.currentMaterial) appState.currentMaterial.emissive.set(e.target.value); });
    document.getElementById('sheenColor').addEventListener('input', (e) => { if (appState.currentMaterial && appState.currentMaterial.sheenColor) appState.currentMaterial.sheenColor.set(e.target.value); });

    document.getElementById('anisotropyPattern').addEventListener('change', (e) => { appState.anisotropyPattern = e.target.value; updateAnisotropyTexture(); });
    document.getElementById('anisotropyRotation').addEventListener('input', (e) => { appState.anisotropyRotation = parseFloat(e.target.value); document.getElementById('anisotropyRotationVal').textContent = appState.anisotropyRotation.toFixed(0) + '°'; updateAnisotropyTexture(); });
    
    const textureMaps = { 'baseColorMap': 'map', 'roughnessMap': 'roughnessMap', 'metalnessMap': 'metalnessMap', 'normalMap': 'normalMap', 'aoMap': 'aoMap', 'lightMap': 'lightMap', 'emissiveMap': 'emissiveMap', 'alphaMap': 'alphaMap', 'transmissionMap': 'transmissionMap' };
    Object.entries(textureMaps).forEach(([inputId, mapName]) => {
        document.getElementById(inputId).addEventListener('change', (e) => loadTexture(e.target.files[0], mapName));
    });

    // Batch
    document.getElementById('enableBatchColor').addEventListener('change', (e) => { document.getElementById('batchColorControls').style.display = e.target.checked ? 'block' : 'none'; applyBatchAdjustments(true); });
    document.getElementById('batchOpacity').addEventListener('input', (e) => document.getElementById('batchOpacityVal').textContent = e.target.value + '%');
    document.getElementById('batchRoughness').addEventListener('input', (e) => document.getElementById('batchRoughnessVal').textContent = '×' + parseFloat(e.target.value).toFixed(2));
    document.getElementById('batchNormalScale').addEventListener('input', (e) => document.getElementById('batchNormalScaleVal').textContent = parseFloat(e.target.value).toFixed(1));
    document.getElementById('resetBatchBtn').addEventListener('click', resetBatchAdjustments);
    document.getElementById('enableBatchPreview').addEventListener('change', (e) => e.target.checked ? applyBatchAdjustments(true) : resetBatchAdjustments());
    // ⬇️ 完整替換為以下 7 行 ⬇️
    ['batchColor', 'batchBlendMode', 'batchOpacity', 'batchRoughness', 'batchNormalScale'].forEach(id => {
        const elem = document.getElementById(id);
        elem.addEventListener('input', () => {
            clearTimeout(batchTimeout);
            batchTimeout = setTimeout(() => applyBatchAdjustments(true), 150);
        });
        elem.addEventListener('change', () => applyBatchAdjustments(true));
    });
    // ⬆️ 替換結束 ⬆️

    // ⬇️ 完整替換為以下 2 行 ⬇️
    appState.renderer.domElement.removeEventListener('mousedown', _onViewportMouseDown);
    appState.renderer.domElement.removeEventListener('click', _onViewportClickGuarded);
    appState.renderer.domElement.addEventListener('mousedown', _onViewportMouseDown);
    appState.renderer.domElement.addEventListener('click', _onViewportClickGuarded);
    // ⬆️ 替換結束 ⬆️
}