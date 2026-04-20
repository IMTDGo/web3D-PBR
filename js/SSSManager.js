import * as THREE from 'three';
import { appState } from './state.js';

export function setupSSSEvents() {
    const enabledControl = document.getElementById('sssEnabled');
    const transmissionControl = document.getElementById('sssTransmission');
    const thicknessControl = document.getElementById('sssThickness');
    const distanceControl = document.getElementById('sssAttenuationDistance');
    const colorControl = document.getElementById('sssAttenuationColor');
    
    const transmissionVal = document.getElementById('sssTransmissionVal');
    const thicknessVal = document.getElementById('sssThicknessVal');
    const distanceVal = document.getElementById('sssAttenuationDistanceVal');

    if (enabledControl) {
        enabledControl.addEventListener('change', (e) => {
            if (!appState.currentMaterial) return;
            const enabled = e.target.checked;
            
            if (enabled) {
                // 啟用 SSS：確保有厚度、有透光、且 IOR > 1
                if (appState.currentMaterial.thickness === 0) appState.currentMaterial.thickness = 10.0;
                if (appState.currentMaterial.transmission === 0) appState.currentMaterial.transmission = 0.6;
                if (appState.currentMaterial.ior <= 1.0) appState.currentMaterial.ior = 1.5;
                appState.currentMaterial.transparent = false; // 物理體積渲染通常不需要傳統透明混合
            } else {
                // 關閉 SSS：將厚度歸零 (這是關閉體積效果的標準做法)
                appState.currentMaterial.thickness = 0;
                appState.currentMaterial.transmission = 0;
            }
            appState.currentMaterial.needsUpdate = true;
            updateSSSUIFromMaterial();
        });
    }

    if (transmissionControl) {
        transmissionControl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (transmissionVal) transmissionVal.textContent = val.toFixed(2);
            if (appState.currentMaterial) {
                appState.currentMaterial.transmission = val;
                
                // 當調整透光度時，自動套用 SSS 預設參數 (因為 UI 已隱藏)
                if (val > 0) {
                    if (appState.currentMaterial.thickness === 0) appState.currentMaterial.thickness = 10.0; // 預設厚度
                    if (appState.currentMaterial.attenuationDistance === Infinity) appState.currentMaterial.attenuationDistance = 5.0; // 預設散射距離
                    if (appState.currentMaterial.ior <= 1.0) appState.currentMaterial.ior = 1.5; // 預設 IOR
                    // 修正「自發光」問題：若衰減顏色為純白，設為微弱的暖色調，模擬物理吸收
                    if (appState.currentMaterial.attenuationColor.getHexString() === 'ffffff') {
                        appState.currentMaterial.attenuationColor.set(0xffdddd); 
                    }
                    appState.currentMaterial.transparent = false; // 關閉 Alpha 混合以啟用物理傳輸
                }
                appState.currentMaterial.needsUpdate = true;
                updateSSSUIFromMaterial(); // 更新其他連動 UI
            }
        });
    }

    if (thicknessControl) {
        thicknessControl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (thicknessVal) thicknessVal.textContent = val.toFixed(1);
            if (appState.currentMaterial) {
                appState.currentMaterial.thickness = val;
                appState.currentMaterial.needsUpdate = true;
            }
        });
    }

    if (distanceControl) {
        distanceControl.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (distanceVal) distanceVal.textContent = val.toFixed(1);
            if (appState.currentMaterial) {
                appState.currentMaterial.attenuationDistance = val;
                appState.currentMaterial.needsUpdate = true;
            }
        });
    }

    if (colorControl) {
        colorControl.addEventListener('input', (e) => {
            if (appState.currentMaterial) {
                appState.currentMaterial.attenuationColor.set(e.target.value);
                appState.currentMaterial.needsUpdate = true;
            }
        });
    }
}

export function updateSSSUIFromMaterial() {
    if (!appState.currentMaterial) return;
    
    const mat = appState.currentMaterial;
    const enabledControl = document.getElementById('sssEnabled');
    const transmissionControl = document.getElementById('sssTransmission');
    const thicknessControl = document.getElementById('sssThickness');
    const distanceControl = document.getElementById('sssAttenuationDistance');
    const colorControl = document.getElementById('sssAttenuationColor');
    
    const transmissionVal = document.getElementById('sssTransmissionVal');
    const thicknessVal = document.getElementById('sssThicknessVal');
    const distanceVal = document.getElementById('sssAttenuationDistanceVal');

    // 判斷 SSS 是否「啟用」：只要厚度 > 0 且 透光 > 0
    const isSSSEnabled = (mat.thickness > 0 && mat.transmission > 0);
    if (enabledControl) enabledControl.checked = isSSSEnabled;

    if (transmissionControl) {
        const val = mat.transmission || 0;
        transmissionControl.value = val;
        if (transmissionVal) transmissionVal.textContent = val.toFixed(2);
    }

    if (thicknessControl) {
        const val = mat.thickness || 0;
        thicknessControl.value = val;
        if (thicknessVal) thicknessVal.textContent = val.toFixed(1);
    }

    if (distanceControl) {
        let val = mat.attenuationDistance;
        if (val === Infinity || val === undefined) val = parseFloat(distanceControl.max);
        distanceControl.value = val;
        if (distanceVal) distanceVal.textContent = val.toFixed(1);
    }

    if (colorControl && mat.attenuationColor) {
        colorControl.value = '#' + mat.attenuationColor.getHexString();
    }
}