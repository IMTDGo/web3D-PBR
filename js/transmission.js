/**
 * js/transmission.js
 * 處理透明度、折射率 (IOR) 與物理玻璃透射的材質通道
 * Handles Opacity, IOR, and physical Transmission (glass mode) material channels
 */

/**
 * 初始化透明/折射材質通道控制項
 * Initialize Opacity / IOR / Transmission channel controls
 * @param {THREE.Material} material - 目前選中的材質
 */
export function setupMaterialChannels(material) {
    const opacityInput = document.getElementById('opacity');
    const opacityVal = document.getElementById('opacityVal');
    
    const iorInput = document.getElementById('ior');
    const iorVal = document.getElementById('iorVal');
    
    if (!material) return;

    // 預設 Thickness 為 1 (依需求)
    if (material.thickness === undefined || material.thickness === 0) {
        material.thickness = 1.0;
    }

    // 輔助函數：根據 IOR 和 Opacity 滑桿值更新材質
    const updateMaterialState = (sliderOpacity, sliderIOR) => {
        material.ior = sliderIOR;
        material.thickness = 1.0; // 強制 Thickness 為 1

        if (sliderIOR > 1.0) {
            // === 玻璃模式 (Glass Mode) ===
            // IOR > 1 時，Opacity 滑桿控制 Transmission
            // 滑桿 1.0 (不透明) -> Transmission 0.0
            // 滑桿 0.0 (全透明) -> Transmission 1.0
            material.transmission = 1.0 - sliderOpacity;
            
            // 物理玻璃必須是實體 (Opacity 1) 且關閉 Alpha 混合 (Transparent false)
            material.opacity = 1.0;
            material.transparent = false;
        } else {
            // === 傳統透明模式 (Alpha Mode) ===
            // IOR = 1 時，Opacity 滑桿控制 Opacity
            material.transmission = 0.0;
            material.opacity = sliderOpacity;
            
            // 啟用 Alpha 混合
            material.transparent = true;
        }
        material.needsUpdate = true;
    };

    // 初始化 UI 值 (Sync UI with material)
    if (iorInput) {
        const currentIOR = material.ior !== undefined ? material.ior : 1.0;
        iorInput.value = currentIOR;
        if (iorVal) iorVal.textContent = currentIOR;
    }

    if (opacityInput) {
        // 根據目前的模式反推 Opacity 滑桿應該顯示的值
        let displayOpacity = 1.0;
        if (material.ior > 1.0) {
            // 玻璃模式：滑桿顯示 (1 - transmission)
            displayOpacity = 1.0 - (material.transmission || 0);
        } else {
            // 透明模式：滑桿顯示 opacity
            displayOpacity = material.opacity;
        }
        // 修正浮點數誤差
        displayOpacity = Math.max(0, Math.min(1, displayOpacity));
        
        opacityInput.value = displayOpacity;
        if (opacityVal) opacityVal.textContent = displayOpacity.toFixed(2);
    }

    // 1. Opacity (透明度) 事件
    if (opacityInput) {
        opacityInput.oninput = (e) => {
            const opacityV = parseFloat(e.target.value);
            const iorV = parseFloat(iorInput.value);
            
            if (opacityVal) opacityVal.textContent = opacityV;
            updateMaterialState(opacityV, iorV);
        };
    }

    // 2. IOR (折射率) 事件
    if (iorInput) {
        iorInput.oninput = (e) => {
            const iorV = parseFloat(e.target.value);
            const opacityV = parseFloat(opacityInput.value);
            
            if (iorVal) iorVal.textContent = iorV;
            updateMaterialState(opacityV, iorV);
        };
    }
}

/**
 * 當 Base Color 貼圖載入後呼叫此函數
 * 處理 Opacity 預設讀取 Alpha 的邏輯
 * Call this function when Base Color texture is loaded
 * @param {THREE.Material} material 
 */
export function onBaseColorLoaded(material) {
    if (!material) return;

    // M10 修正：若目前是玻璃模式 (IOR>1 且已有 transmission)，保持其態，
    // 不要強制覆寫 transparent/opacity/transmission 而破壞玻璃設定。
    const isGlassMode = material.ior > 1.0 && material.transmission > 0;
    if (isGlassMode) {
        material.needsUpdate = true;
        return;
    }

    // 還原為傳統透明模式 (Alpha blending) 的預設
    material.transparent = true;
    material.opacity = 1.0;
    material.transmission = 0.0;
    material.needsUpdate = true;

    // 同步更新 UI
    const opacityInput = document.getElementById('opacity');
    const opacityVal = document.getElementById('opacityVal');

    if (opacityInput) opacityInput.value = "1.0";
    if (opacityVal) opacityVal.textContent = "1.0";
}
