import * as THREE from 'three';
import { appState } from './state.js';

export function showWarning(message, items = [], isError = false) {
    const oldWarning = document.querySelector('.warning-banner');
    if (oldWarning) oldWarning.remove();
    
    const banner = document.createElement('div');
    banner.className = 'fixed top-5 left-1/2 -translate-x-1/2 px-6 py-4 rounded-lg shadow-lg z-[1000] max-w-lg text-center font-bold text-sm ' + (isError ? 'bg-error text-error-content' : 'bg-warning text-warning-content');
    
    let html = `<div>${message}</div>`;
    if (items.length > 0) {
        html += '<ul>';
        items.forEach(item => {
            html += `<li>${item}</li>`;
        });
        html += '</ul>';
    }
    banner.innerHTML = html;
    
    document.body.appendChild(banner);
    
    setTimeout(() => {
        banner.style.opacity = '0';
        banner.style.transition = 'opacity 0.5s';
        setTimeout(() => banner.remove(), 500);
    }, 5000);
}

export function centerCamera(object) {
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = appState.camera.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 2;
    
    appState.camera.position.set(center.x + cameraZ, center.y, center.z);
    appState.camera.lookAt(center);
    appState.controls.target.copy(center);
}

export function onWindowResize() {
    const width = window.innerWidth - 320;
    const height = window.innerHeight;
    
    appState.camera.aspect = width / height;
    appState.camera.updateProjectionMatrix();
    appState.renderer.setSize(width, height);
    
    // 🚀 VRAM 優化：後期處理使用較低解析度
    if (appState.composer) {
        const composerWidth = Math.floor(width * 0.75);
        const composerHeight = Math.floor(height * 0.75);
        appState.composer.setSize(composerWidth, composerHeight);
        
        if (appState.gtaoPass) {
            const aoWidth = Math.floor(width * 0.5);
            const aoHeight = Math.floor(height * 0.5);
            appState.gtaoPass.setSize(aoWidth, aoHeight);
        }
        if (appState.smaaPass) appState.smaaPass.setSize(composerWidth, composerHeight);
    }
}

export function blendColors(base, blend, mode, opacity) {
    const r1 = base.r, g1 = base.g, b1 = base.b;
    const r2 = blend.r, g2 = blend.g, b2 = blend.b;
    let r, g, b;
    
    const clamp = (val) => Math.max(0, Math.min(1, val));
    
    switch(mode) {
        case 'normal': r = r2; g = g2; b = b2; break;
        case 'multiply': r = r1 * r2; g = g1 * g2; b = b1 * b2; break;
        case 'screen': r = 1 - (1 - r1) * (1 - r2); g = 1 - (1 - g1) * (1 - g2); b = 1 - (1 - b1) * (1 - b2); break;
        case 'overlay':
            r = r1 < 0.5 ? 2 * r1 * r2 : 1 - 2 * (1 - r1) * (1 - r2);
            g = g1 < 0.5 ? 2 * g1 * g2 : 1 - 2 * (1 - g1) * (1 - g2);
            b = b1 < 0.5 ? 2 * b1 * b2 : 1 - 2 * (1 - b1) * (1 - b2);
            break;
        default: r = r2; g = g2; b = b2;
    }
    
    const alpha = opacity / 100;
    r = clamp(r1 * (1 - alpha) + r * alpha);
    g = clamp(g1 * (1 - alpha) + g * alpha);
    b = clamp(b1 * (1 - alpha) + b * alpha);
    
    return new THREE.Color(r, g, b);
}