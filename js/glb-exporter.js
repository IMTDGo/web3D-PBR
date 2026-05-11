/**
 * js/glb-exporter.js
 *
 * GLB 匯出器 — 三個核心流程：
 *
 * 1. 固定貼圖（Bake Textures）
 *    a) Seamless 四方連續：以 WebGL 渲染通道將自訂 GLSL seamless shader
 *       的混合效果烘焙成一張靜態貼圖，移除對 onBeforeCompile 的依賴。
 *    b) 改色（Color Tint）：將 material.color（Base Color Factor）
 *       乘入 Base Color 貼圖，烘焙後 color 重設為白色。
 *
 * 2. UV 座標反算（UV Shell Bake）
 *    讀取 texture.repeat / offset / rotation，套用相同的 UV 變換矩陣
 *    至 Geometry 的 UV Attribute，再將 texture 的變換重設為預設值。
 *    結果：模型 UV Shell 放大，貼圖以 repeat=1 鋪面，視覺完全一致。
 *
 * 3. 完整 PBR 通道打包
 *    透過 THREE.GLTFExporter 自動打包所有 MeshPhysicalMaterial 屬性：
 *    roughness、metalness、normal、AO、emissive、sheen、clearcoat、
 *    transmission（SSS）、volume、IOR、anisotropy、opacity … 等，
 *    以及對應 KHR 擴充（sheen, clearcoat, transmission, volume, ior,
 *    anisotropy, emissive_strength, texture_transform）。
 */

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { appState } from './state.js';

// ─────────────────────────────────────────────────────────────────────────────
// 常數定義
// ─────────────────────────────────────────────────────────────────────────────

/** 需要套用 Seamless 烘焙的貼圖槽（對應 uv-editor.js 中被 shader 替換的 #include） */
const SEAMLESS_BAKE_MAPS = new Set(['map', 'roughnessMap', 'normalMap']);

/** 使用 UV Channel 0（geometry.attributes.uv）的貼圖槽 */
const UV0_MAPS = [
    'map', 'roughnessMap', 'metalnessMap', 'normalMap',
    'emissiveMap', 'sheenColorMap', 'sheenRoughnessMap',
    'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap',
    'anisotropyMap', 'alphaMap', 'transmissionMap', 'thicknessMap',
];

/** 使用 UV Channel 1（geometry.attributes.uv1）的貼圖槽 */
const UV1_MAPS = ['aoMap', 'lightMap'];

/** 所有需要處理的貼圖槽 */
const ALL_TEXTURE_MAPS = [...UV0_MAPS, ...UV1_MAPS];

// ─────────────────────────────────────────────────────────────────────────────
// 公開 API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 綁定匯出按鈕的點擊事件
 * 在 main.js 的 setupEventListeners() 中呼叫
 */
export function setupGLBExportEvents() {
    const btn = document.getElementById('exportGLBBtn');
    if (btn) btn.addEventListener('click', exportGLB);
}

// ─────────────────────────────────────────────────────────────────────────────
// 主流程
// ─────────────────────────────────────────────────────────────────────────────

async function exportGLB() {
    if (!appState.currentModel) {
        alert('請先載入模型後再匯出！');
        return;
    }

    const statusEl = document.getElementById('glbExportStatus');
    const btn      = document.getElementById('exportGLBBtn');

    const setStatus = (msg) => {
        if (statusEl) statusEl.textContent = msg;
        console.log('[GLB Export]', msg);
    };

    if (btn) btn.disabled = true;

    try {
        // ── Step 1：深度複製（材質獨立，不影響場景中的原始材質）────────────
        setStatus('⏳ 複製模型中...');
        const exportRoot = _deepCloneForExport(appState.currentModel);

        // 蒐集對應的 mesh 列表（clone 與 original 順序一致）
        const origMeshes   = [];
        const clonedMeshes = [];
        appState.currentModel.traverse(c => { if (c.isMesh) origMeshes.push(c); });
        exportRoot.traverse(c => { if (c.isMesh) clonedMeshes.push(c); });

        // ── Step 2：逐 Mesh 固定貼圖 + UV 座標反算 ──────────────────────────
        const total = clonedMeshes.length;
        for (let i = 0; i < total; i++) {
            setStatus(`🖼️ 固定貼圖 + UV 反算 (${i + 1} / ${total})...`);
            await _processMesh(clonedMeshes[i], origMeshes[i]);
        }

        // ── Step 3：GLB 匯出 ─────────────────────────────────────────────────
        setStatus('📦 匯出 GLB 中...');
        await _doExport(exportRoot);

        // 釋放暫用 geometry（貼圖由 GLTFExporter 自行使用完再釋放）
        exportRoot.traverse(child => {
            if (child.isMesh && child.geometry) child.geometry.dispose();
        });

        setStatus('✅ 匯出完成！');
        setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 5000);

    } catch (err) {
        console.error('[GLB Export] 失敗:', err);
        setStatus('❌ 匯出失敗：' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 深度複製（材質獨立複製，避免修改影響場景中的原始物件）
// ─────────────────────────────────────────────────────────────────────────────

function _deepCloneForExport(source) {
    const root = source.clone(true);
    root.traverse(child => {
        if (!child.isMesh) return;
        if (Array.isArray(child.material)) {
            child.material = child.material.map(m => m.clone());
        } else if (child.material) {
            child.material = child.material.clone();
        }
    });
    return root;
}

// ─────────────────────────────────────────────────────────────────────────────
// 處理單一 Mesh
// ─────────────────────────────────────────────────────────────────────────────

async function _processMesh(clonedMesh, origMesh) {
    const origMats   = Array.isArray(origMesh.material)   ? origMesh.material   : [origMesh.material];
    const clonedMats = Array.isArray(clonedMesh.material) ? clonedMesh.material : [clonedMesh.material];

    // 讀取 UV 變換參數（所有貼圖共用相同設定，取第一個有效貼圖）
    let repeatX = 1, repeatY = 1, offsetX = 0, offsetY = 0, uvRotation = 0;
    for (const mat of origMats) {
        if (!mat) continue;
        const refTex = mat.map || mat.roughnessMap || mat.normalMap || mat.metalnessMap;
        if (refTex && refTex.isTexture) {
            repeatX    = refTex.repeat.x;
            repeatY    = refTex.repeat.y;
            offsetX    = refTex.offset.x;
            offsetY    = refTex.offset.y;
            uvRotation = refTex.rotation;
            break;
        }
    }

    // 材質烘焙
    for (let mi = 0; mi < clonedMats.length; mi++) {
        if (clonedMats[mi] && origMats[mi]) {
            await _bakeMaterial(clonedMats[mi], origMats[mi]);
        }
    }

    // UV 座標反算（只要任一變換非預設值就執行）
    const needsUVBake = repeatX !== 1 || repeatY !== 1 ||
                        offsetX !== 0 || offsetY !== 0 || uvRotation !== 0;
    if (needsUVBake) {
        clonedMesh.geometry = _bakeUVTransform(
            clonedMesh.geometry, repeatX, repeatY, offsetX, offsetY, uvRotation
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// 材質烘焙：Seamless、Color Tint、重設 UV 變換
// ─────────────────────────────────────────────────────────────────────────────

async function _bakeMaterial(clonedMat, origMat) {
    const isSeamless = !!origMat.userData.isSeamless;
    const seamlessU  = origMat.userData.seamlessUniforms;

    // 讀取原始 base color tint
    const baseColor      = origMat.color ? origMat.color.clone() : new THREE.Color(1, 1, 1);
    const isColorTinted  = !(
        Math.abs(baseColor.r - 1) < 0.001 &&
        Math.abs(baseColor.g - 1) < 0.001 &&
        Math.abs(baseColor.b - 1) < 0.001
    );

    for (const mapName of ALL_TEXTURE_MAPS) {
        const origTex = origMat[mapName];
        if (!origTex || !origTex.isTexture || !origTex.image) continue;

        let bakedTex = origTex;

        // ① Seamless 烘焙（僅對應槽位）
        if (isSeamless && seamlessU && SEAMLESS_BAKE_MAPS.has(mapName)) {
            bakedTex = await _bakeSeamlessTexture(bakedTex, seamlessU);
        }

        // ② Color Tint 烘焙（僅 base color map）
        if (mapName === 'map' && isColorTinted) {
            bakedTex = _applyColorTint(bakedTex, baseColor);
        }

        // 更新 cloned 材質並重設 UV 變換（UV 反算已由 Geometry 接手）
        clonedMat[mapName] = bakedTex;
        bakedTex.repeat.set(1, 1);
        bakedTex.offset.set(0, 0);
        bakedTex.rotation = 0;
        bakedTex.needsUpdate = true;
    }

    // 移除 seamless shader hook
    if (isSeamless) {
        delete clonedMat.onBeforeCompile;
        delete clonedMat.customProgramCacheKey;
        delete clonedMat.userData.isSeamless;
        delete clonedMat.userData.seamlessUniforms;
    }

    // base color 已烘焙進貼圖 → 重設為白色，保留 GLB 標準語義
    if (isColorTinted && origMat.map) {
        clonedMat.color.set(1, 1, 1);
    }

    clonedMat.needsUpdate = true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Seamless 貼圖烘焙：以 WebGL 渲染通道將 Seamless 混合效果固化成靜態貼圖
// ─────────────────────────────────────────────────────────────────────────────

function _bakeSeamlessTexture(srcTex, seamlessU) {
    return new Promise((resolve) => {
        const img  = srcTex.image;
        const size = Math.min(Math.max(img.width || 512, img.height || 512), 2048);

        // 暫存 renderer 狀態
        const renderer      = appState.renderer;
        const prevTarget    = renderer.getRenderTarget();
        const prevToneMap   = renderer.toneMapping;
        const prevAutoClear = renderer.autoClear;

        // 建立渲染目標（不需深度/模板緩衝）
        const renderTarget = new THREE.WebGLRenderTarget(size, size, {
            format:        THREE.RGBAFormat,
            type:          THREE.UnsignedByteType,
            depthBuffer:   false,
            stencilBuffer: false,
        });

        // 正交相機（完整覆蓋 NDC [-0.5, 0.5]）
        const orthoCamera = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0, 1);

        // 全螢幕四邊形 + Seamless shader（重現 uv-editor.js 的 GLSL 邏輯）
        const quadGeo = new THREE.PlaneGeometry(1, 1);
        const quadMat = new THREE.ShaderMaterial({
            uniforms: {
                tDiffuse:              { value: srcTex },
                seamlessOffsetX:       { value: seamlessU.seamlessOffsetX.value },
                seamlessOffsetY:       { value: seamlessU.seamlessOffsetY.value },
                seamlessBlendStrength: { value: seamlessU.seamlessBlendStrength.value },
                seamlessBlendWidth:    { value: seamlessU.seamlessBlendWidth.value },
            },
            vertexShader: /* glsl */`
                varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
            fragmentShader: /* glsl */`
                uniform sampler2D tDiffuse;
                uniform float seamlessOffsetX;
                uniform float seamlessOffsetY;
                uniform float seamlessBlendStrength;
                uniform float seamlessBlendWidth;
                varying vec2 vUv;

                float smoothEdge(float x, float w) {
                    return smoothstep(0.0, w, x) * smoothstep(0.0, w, 1.0 - x);
                }

                void main() {
                    // 套用 offset，製造跨象限混合（與 uv-editor.js 的 seamless 邏輯一致）
                    vec2 baseUV = fract(vUv + vec2(seamlessOffsetX, seamlessOffsetY));

                    vec2 uv1 = baseUV;
                    vec2 uv2 = fract(baseUV + vec2(0.5, 0.0));
                    vec2 uv3 = fract(baseUV + vec2(0.0, 0.5));
                    vec2 uv4 = fract(baseUV + vec2(0.5, 0.5));

                    vec4 c1 = texture2D(tDiffuse, uv1);
                    vec4 c2 = texture2D(tDiffuse, uv2);
                    vec4 c3 = texture2D(tDiffuse, uv3);
                    vec4 c4 = texture2D(tDiffuse, uv4);

                    float edgeX = smoothEdge(baseUV.x, seamlessBlendWidth);
                    float edgeY = smoothEdge(baseUV.y, seamlessBlendWidth);
                    float f = seamlessBlendStrength;

                    vec4 mx1    = mix(c2, c1, edgeX * f + (1.0 - f));
                    vec4 mx2    = mix(c4, c3, edgeX * f + (1.0 - f));
                    vec4 result = mix(mx2, mx1, edgeY * f + (1.0 - f));

                    float center = (1.0 - edgeX) * (1.0 - edgeY) * seamlessBlendWidth * 2.0;
                    result = mix(result, c4, center * f * 0.3);

                    gl_FragColor = result;
                }
            `,
            depthTest:  false,
            depthWrite: false,
        });

        const tmpScene = new THREE.Scene();
        tmpScene.add(new THREE.Mesh(quadGeo, quadMat));

        // 渲染到 RenderTarget（關閉 ToneMapping 避免干擾貼圖資料）
        renderer.toneMapping  = THREE.NoToneMapping;
        renderer.autoClear    = true;
        renderer.setRenderTarget(renderTarget);
        renderer.render(tmpScene, orthoCamera);

        // 讀取像素（WebGL 原始 Y 軸由下往上，需翻轉）
        const pixels = new Uint8Array(size * size * 4);
        renderer.readRenderTargetPixels(renderTarget, 0, 0, size, size, pixels);

        // 還原 renderer 狀態
        renderer.setRenderTarget(prevTarget);
        renderer.toneMapping  = prevToneMap;
        renderer.autoClear    = prevAutoClear;

        // 翻轉 Y 軸並寫入 Canvas
        const canvas = document.createElement('canvas');
        canvas.width  = size;
        canvas.height = size;
        const ctx       = canvas.getContext('2d');
        const imageData = ctx.createImageData(size, size);
        const stride    = size * 4;

        for (let y = 0; y < size; y++) {
            const srcOff = (size - 1 - y) * stride;
            const dstOff = y * stride;
            imageData.data.set(pixels.subarray(srcOff, srcOff + stride), dstOff);
        }
        ctx.putImageData(imageData, 0, 0);

        // 建立新貼圖（保留原始 colorSpace 設定）
        const baked = new THREE.CanvasTexture(canvas);
        baked.colorSpace      = srcTex.colorSpace;
        baked.wrapS           = baked.wrapT = THREE.RepeatWrapping;
        baked.generateMipmaps = true;
        baked.minFilter       = THREE.LinearMipmapLinearFilter;
        baked.anisotropy      = 2;

        // 釋放暫用 GPU 資源
        renderTarget.dispose();
        quadMat.dispose();
        quadGeo.dispose();

        resolve(baked);
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Color Tint 烘焙：Canvas 2D multiply 合成
// ─────────────────────────────────────────────────────────────────────────────

function _applyColorTint(srcTex, color) {
    const img = srcTex.image;
    if (!img) return srcTex;

    const w = img.width  || img.naturalWidth  || 1024;
    const h = img.height || img.naturalHeight || 1024;

    const canvas = document.createElement('canvas');
    canvas.width  = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // 先畫原貼圖
    ctx.drawImage(img, 0, 0, w, h);

    const r = Math.round(color.r * 255);
    const g = Math.round(color.g * 255);
    const b = Math.round(color.b * 255);

    // multiply 合成模式：result = src × color（在 [0,255] sRGB 空間近似 PBR 的乘法）
    if (r !== 255 || g !== 255 || b !== 255) {
        ctx.globalCompositeOperation = 'multiply';
        ctx.fillStyle = `rgb(${r},${g},${b})`;
        ctx.fillRect(0, 0, w, h);
        ctx.globalCompositeOperation = 'source-over';
    }

    const tinted = new THREE.CanvasTexture(canvas);
    tinted.colorSpace      = srcTex.colorSpace;
    tinted.wrapS           = tinted.wrapT = THREE.RepeatWrapping;
    tinted.generateMipmaps = true;
    tinted.minFilter       = THREE.LinearMipmapLinearFilter;
    tinted.anisotropy      = 2;

    return tinted;
}

// ─────────────────────────────────────────────────────────────────────────────
// UV 座標反算：將 Texture UV Transform 烘焙進 Geometry UV Attribute
//
// Three.js 貼圖 UV 變換矩陣（Matrix3.setUvTransform）：
//   u' = sx·cos·u + sx·sin·v + (−sx·(cos·cx+sin·cy) + cx + tx)
//   v' = −sy·sin·u + sy·cos·v + (−sy·(−sin·cx+cos·cy) + cy + ty)
//   其中 sx=repeatX, sy=repeatY, tx=offsetX, ty=offsetY, cx=cy=0.5
//
// 烘焙後將 texture.repeat/(1,1)、offset/(0,0)、rotation/0 重設，
// Geometry UV Shell 擴大，貼圖以 repeat=1 鋪面，視覺完全一致。
// ─────────────────────────────────────────────────────────────────────────────

function _bakeUVTransform(geometry, repeatX, repeatY, offsetX, offsetY, rotation) {
    const geo = geometry.clone();

    const cx = 0.5, cy = 0.5; // Three.js 預設 texture.center
    const c  = Math.cos(rotation);
    const s  = Math.sin(rotation);

    // 矩陣係數（對應 THREE.Matrix3.setUvTransform）
    const m00 = repeatX * c;
    const m01 = repeatX * s;
    const m02 = -repeatX * (c * cx + s * cy) + cx + offsetX;
    const m10 = -repeatY * s;
    const m11 =  repeatY * c;
    const m12 = -repeatY * (-s * cx + c * cy) + cy + offsetY;

    const applyTransform = (attr) => {
        if (!attr) return;
        const arr = attr.array;
        for (let i = 0; i < arr.length; i += 2) {
            const u = arr[i];
            const v = arr[i + 1];
            arr[i]     = m00 * u + m01 * v + m02;
            arr[i + 1] = m10 * u + m11 * v + m12;
        }
        attr.needsUpdate = true;
    };

    // UV Channel 0（主要 UV）
    applyTransform(geo.attributes.uv);
    // UV Channel 1（aoMap / lightMap 使用）
    applyTransform(geo.attributes.uv1);

    return geo;
}

// ─────────────────────────────────────────────────────────────────────────────
// GLTFExporter 匯出
//
// GLTFExporter 會自動打包 MeshPhysicalMaterial 的所有屬性，包含：
//   基礎：roughness, metalness, color (baseColorFactor), normal, AO, emissive
//   KHR_materials_sheen         → sheen, sheenRoughness, sheenColor
//   KHR_materials_clearcoat     → clearcoat, clearcoatRoughness
//   KHR_materials_transmission  → transmission, transmissionMap
//   KHR_materials_volume        → thickness, attenuationDistance, attenuationColor
//   KHR_materials_ior           → ior
//   KHR_materials_anisotropy    → anisotropy, anisotropyRotation, anisotropyMap
//   KHR_materials_emissive_strength → emissiveIntensity > 1
//   alpha                       → opacity, transparent, alphaMap
// ─────────────────────────────────────────────────────────────────────────────

function _doExport(root) {
    return new Promise((resolve, reject) => {
        const exporter = new GLTFExporter();
        exporter.parse(
            root,
            (glb) => {
                // 建立下載連結並自動觸發
                const blob = new Blob([glb], { type: 'application/octet-stream' });
                const url  = URL.createObjectURL(blob);
                const a    = document.createElement('a');
                a.href     = url;
                a.download = 'model_baked.glb';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                resolve();
            },
            (err) => reject(new Error(String(err))),
            {
                binary:       true,   // 輸出 .glb 二進位格式
                onlyVisible:  false,  // 包含所有物件（不過濾不可見）
                embedImages:  true,   // 貼圖內嵌於 GLB（無外部依賴）
                forceIndices: false,  // 保留原始 Geometry 索引格式
                // GLTFExporter 會自動偵測並啟用所有支援的 KHR 擴充
            }
        );
    });
}
