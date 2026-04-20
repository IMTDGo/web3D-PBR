import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { appState } from './state.js';

const ColorCorrectionShader = {
    uniforms: {
        'tDiffuse': { value: null },
        'contrast': { value: 1.0 },
        'saturation': { value: 1.0 }
    },
    vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }
    `,
    fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float contrast;
        uniform float saturation;
        varying vec2 vUv;
        void main() {
            vec4 texel = texture2D( tDiffuse, vUv );
            vec3 color = texel.rgb;
            // Contrast
            color = (color - 0.5) * contrast + 0.5;
            // Saturation
            vec3 gray = vec3(dot(color, vec3(0.2126, 0.7152, 0.0722)));
            color = mix(gray, color, saturation);
            gl_FragColor = vec4( color, texel.a );
        }
    `
};

export function setupPostProcessing() {
    // 🚀 VRAM 優化：後期處理使用 0.75 倍解析度（視覺差異極小但性能提升顯著）
    const width = Math.floor((window.innerWidth - 320) * 0.75);
    const height = Math.floor(window.innerHeight * 0.75);
    
    appState.composer = new EffectComposer(appState.renderer);
    appState.composer.setSize(width, height);
    
    appState.renderPass = new RenderPass(appState.scene, appState.camera);

    appState.smaaPass = new SMAAPass(width, height);

    appState.colorCorrectionPass = new ShaderPass(ColorCorrectionShader);

    appState.outputPass = new OutputPass();
    
    // 初始建構 Composer
    rebuildComposer();
}

// 動態重建 Composer，只加入已啟用的 Pass，並銷毀未使用的 Pass 以釋放 VRAM
export function rebuildComposer() {
    // 1. 清空目前的 Pass 列表
    appState.composer.passes = [];

    // 2. 基礎渲染 (必須)
    appState.composer.addPass(appState.renderPass);

    // 🚀 VRAM 優化：AO 使用更低解析度（0.5 倍）視覺差異小但性能提升巨大
    if (appState.aoEnabled) {
        if (!appState.gtaoPass) {
            const aoWidth = Math.floor((window.innerWidth - 320) * 0.5);
            const aoHeight = Math.floor(window.innerHeight * 0.5);
            appState.gtaoPass = new GTAOPass(appState.scene, appState.camera, aoWidth, aoHeight);
            appState.gtaoPass.output = GTAOPass.OUTPUT.Default;
            updateAO(); // 套用目前的 UI 數值
        }
        appState.composer.addPass(appState.gtaoPass);
    } else {
        // 若停用，則銷毀 Pass 釋放記憶體
        if (appState.gtaoPass) {
            appState.gtaoPass.dispose();
            appState.gtaoPass = null;
        }
    }

    // 6. 加入輕量級 Pass (SMAA, Vignette, Color, Output)
    appState.composer.addPass(appState.smaaPass);
    appState.composer.addPass(appState.colorCorrectionPass);
    appState.composer.addPass(appState.outputPass);
    
    // 標記需要重新渲染
    appState.needsRender = true;
}

export function updateAO() {
    if (!appState.gtaoPass) return;
    const radius = parseFloat(document.getElementById('aoRadius').value);
    // 修正：移除對 aoIntensity 的讀取，避免與材質 AO 設定衝突。改為預設值 1.0
    const intensity = 1.0; 
    appState.gtaoPass.updateGtaoMaterial({ radius: radius });
    appState.gtaoPass.blendIntensity = intensity;
}

export function setupPostProcessingUIEvents() {
    // AO (GTAO)
    document.getElementById('aoEnabled').addEventListener('change', (e) => {
        appState.aoEnabled = e.target.checked;
        rebuildComposer();
        document.getElementById('aoControls').style.display = e.target.checked ? 'block' : 'none';
    });
    document.getElementById('aoRadius').addEventListener('input', (e) => { document.getElementById('aoRadiusVal').textContent = e.target.value; updateAO(); });
    // 移除 aoIntensity 監聽器，因為該 ID 屬於材質設定，不應控制後期處理

    // Render & Tone
    document.getElementById('toneMapping').addEventListener('change', (e) => {
        const map = {
            'aces': THREE.ACESFilmicToneMapping,
            'agx': THREE.AgXToneMapping,
            'reinhard': THREE.ReinhardToneMapping,
            'cineon': THREE.CineonToneMapping,
            'linear': THREE.NoToneMapping
        };
        appState.renderer.toneMapping = map[e.target.value];
        appState.materials.forEach(m => m.material.needsUpdate = true);
    });
    document.getElementById('exposure').addEventListener('input', (e) => {
        document.getElementById('exposureVal').textContent = e.target.value;
        appState.renderer.toneMappingExposure = parseFloat(e.target.value);
    });
    document.getElementById('contrast').addEventListener('input', (e) => {
        document.getElementById('contrastVal').textContent = e.target.value;
        if (appState.colorCorrectionPass) appState.colorCorrectionPass.uniforms.contrast.value = parseFloat(e.target.value);
    });
    document.getElementById('saturation').addEventListener('input', (e) => {
        document.getElementById('saturationVal').textContent = e.target.value;
        if (appState.colorCorrectionPass) appState.colorCorrectionPass.uniforms.saturation.value = parseFloat(e.target.value);
    });
}