import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { appState } from './state.js';
import { showWarning, centerCamera } from './utils.js';
import { updateMaterialSelect, updateAllTexturePreviews } from './materials.js';

export function loadFBX(event) {
    const file = event.target.files[0];
    if (!file) return;

    const loadingEl = document.getElementById('loading');
    loadingEl.textContent = '載入中...';
    loadingEl.style.display = 'block';

    const reader = new FileReader();
    reader.onload = function(e) {
        // 讓瀏覽器先渲染「載入中」畫面，再開始同步解析（避免畫面看起來直接卡死）
        requestAnimationFrame(() => _parseFBX(e.target.result));
    };
    reader.readAsArrayBuffer(file);
}

function _parseFBX(buffer) {
    const loadingEl = document.getElementById('loading');
    const manager = new THREE.LoadingManager();
    manager.addHandler(/\.tga$/i, new TGALoader());
    const loader = new FBXLoader(manager);

    // 🔑 關鍵修復：Three.js FBXLoader 只支援 Phong 模型，會丟棄 FBX 中的 Roughness/Metalness 等屬性。
    // 我們在它出手前，先從原始 buffer 擈出這些值，后續再套回到新建的 MeshPhysicalMaterial 。
    const fbxPBR = _extractFBXPBRData(buffer);
    appState._fbxPBRData = fbxPBR;
    if (fbxPBR.size > 0) {
        console.log(`🔍 FBX PBR parser 握到 ${fbxPBR.size} 個材質的 Roughness/Metalness 資料：`, 
            Object.fromEntries([...fbxPBR.entries()]));
    } else {
        console.log('ℹ️ FBX PBR parser 未找到額外的 Roughness/Metalness 資料（FBX 可能未內嵌 PBR 屬性）');
    }

    let object;
    try {
        object = loader.parse(buffer, '');
    } catch (error) {
        console.error(error);
        alert('FBX 載入失敗: ' + error.message);
        loadingEl.style.display = 'none';
        return;
    }

    // --- VRAM 優化關鍵：徹底銷毀舊模型的 GPU 資源 ---
    if (appState.currentModel) {
        appState.currentModel.traverse((child) => {
            if (child.isMesh) {
                if (child.geometry) child.geometry.dispose();
                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        Object.keys(m).forEach(key => {
                            if (m[key] && m[key].isTexture && key !== 'envMap') m[key].dispose();
                        });
                        m.dispose();
                    });
                }
            }
        });
        appState.scene.remove(appState.currentModel);
    }

    appState.currentModel = object;
    appState.materials = [];
    appState.originalMaterialData = [];
    appState.meshCache = [];
    appState.scene.add(object);

    // 收集所有 Mesh，準備分批轉換材質
    const meshes = [];
    object.traverse((child) => { if (child.isMesh) meshes.push(child); });

    if (meshes.length === 0) {
        _onLoadComplete(object);
        return;
    }

    // 每批處理 5 個 Mesh，批次間讓出一幀給瀏覽器刷新畫面（顯示進度、避免凍結）
    const BATCH_SIZE = 5;
    let idx = 0;
    function processBatch() {
        const end = Math.min(idx + BATCH_SIZE, meshes.length);
        for (; idx < end; idx++) _convertMesh(meshes[idx]);
        const pct = Math.round(idx / meshes.length * 100);
        loadingEl.textContent = `解析材質中... ${pct}%`;
        if (idx < meshes.length) {
            requestAnimationFrame(processBatch);
        } else {
            _onLoadComplete(object);
        }
    }
    requestAnimationFrame(processBatch);
}

function _convertMesh(child) {
    // C3 修正：依 UI shadowsEnabled 狀態初始化，避免模型載入後永遠開著陰影
    const shadowsCheckbox = document.getElementById('shadowsEnabled');
    const shadowsEnabled = shadowsCheckbox ? shadowsCheckbox.checked : false;
    child.castShadow = shadowsEnabled;
    child.receiveShadow = shadowsEnabled;
    appState.meshCache.push(child);

    const wasArray = Array.isArray(child.material);
    const oldMaterials = wasArray ? child.material : [child.material];
    const newMaterials = [];

    oldMaterials.forEach(originalMaterial => {
        // 1. 讀取 FBX 原始數值 (Roughness, Metalness, Color)
        let initRoughness = 0.5;
        let initMetalness = 0;
        let initColor = originalMaterial.color || new THREE.Color(0xffffff);

        if (originalMaterial.userData && originalMaterial.userData.roughness !== undefined) {
            initRoughness = parseFloat(originalMaterial.userData.roughness);
        } else if (originalMaterial.roughness !== undefined) {
            initRoughness = originalMaterial.roughness;
        } else if (originalMaterial.shininess !== undefined) {
            initRoughness = 1.0 - (Math.min(originalMaterial.shininess, 100) / 100.0);
        } else if (originalMaterial.isMeshLambertMaterial) {
            initRoughness = 1.0;
        }

        if (originalMaterial.metalness !== undefined) {
            initMetalness = originalMaterial.metalness;
        }

        // 🔑 套用自 FBX 原始 buffer 擈出的 PBR 值（優先最高）
        const pbrFromBuffer = appState._fbxPBRData && originalMaterial.name
            ? appState._fbxPBRData.get(originalMaterial.name)
            : null;
        let roughnessFromBuffer = false;
        let metalnessFromBuffer = false;
        let roughnessMapFromBuffer = null;
        let metalnessMapFromBuffer = null;
        if (pbrFromBuffer) {
            if (pbrFromBuffer.roughness !== undefined) {
                initRoughness = pbrFromBuffer.roughness;
                roughnessFromBuffer = true;
            }
            if (pbrFromBuffer.metalness !== undefined) {
                initMetalness = pbrFromBuffer.metalness;
                metalnessFromBuffer = true;
            }
            if (pbrFromBuffer.roughnessTexture) {
                roughnessMapFromBuffer = _createTextureFromPBREntry(pbrFromBuffer.roughnessTexture, false);
            }
            if (pbrFromBuffer.metalnessTexture) {
                metalnessMapFromBuffer = _createTextureFromPBREntry(pbrFromBuffer.metalnessTexture, false);
            }
            console.log(`  → 材質 "${originalMaterial.name}" 套用 FBX PBR:`, {
                roughness: roughnessFromBuffer ? initRoughness : '(未擈到)',
                metalness: metalnessFromBuffer ? initMetalness : '(未擈到)',
                roughnessMap: pbrFromBuffer.roughnessTexture
                    ? `${pbrFromBuffer.roughnessProp} → ${pbrFromBuffer.roughnessTexture.filename || '(內嵌)'}`
                    : '(無)',
                metalnessMap: pbrFromBuffer.metalnessTexture
                    ? `${pbrFromBuffer.metalnessProp} → ${pbrFromBuffer.metalnessTexture.filename || '(內嵌)'}`
                    : '(無)'
            });
        }

        const mat = new THREE.MeshPhysicalMaterial({
            color: initColor,
            roughness: Math.max(0, Math.min(1.5, initRoughness)),
            metalness: Math.max(0, Math.min(1, initMetalness)),
            envMapIntensity: 1,
            ior: 1.0,
            anisotropy: 0,
            anisotropyRotation: 0
        });

        // Map textures
        if (originalMaterial.map) {
            mat.map = originalMaterial.map;
            mat.map.colorSpace = THREE.SRGBColorSpace;
            mat.map.needsUpdate = true;
        }
        if (originalMaterial.normalMap) {
            mat.normalMap = originalMaterial.normalMap;
            mat.normalMap.colorSpace = THREE.NoColorSpace;
            mat.normalMap.needsUpdate = true;
            mat.normalScale = new THREE.Vector2(1, 1);
        }
        if (!mat.normalMap && originalMaterial.bumpMap) { mat.bumpMap = originalMaterial.bumpMap; mat.bumpScale = 1; }

        // 🚀 VRAM 優化：所有貼圖統一降低 Anisotropy
        const optimizeTexture = (tex) => {
            if (tex && tex.isTexture) { tex.anisotropy = 2; tex.generateMipmaps = true; }
        };

        // 嘗試從不同屬性讀取 Roughness Map
        let foundRoughnessMap = false;
        // 最高優先:自 FBX buffer 解析到的 ShininessExponent / Roughness 等連結貼圖
        if (roughnessMapFromBuffer) {
            mat.roughnessMap = roughnessMapFromBuffer;
            foundRoughnessMap = true;
        }
        else if (originalMaterial.roughnessMap) { mat.roughnessMap = originalMaterial.roughnessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
        else if (originalMaterial.specularMap) { mat.roughnessMap = originalMaterial.specularMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
        else if (originalMaterial.shininessMap) { mat.roughnessMap = originalMaterial.shininessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
        else if (originalMaterial.glossinessMap) { mat.roughnessMap = originalMaterial.glossinessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
        else if (originalMaterial.userData && originalMaterial.userData.roughnessMap) { mat.roughnessMap = originalMaterial.userData.roughnessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }

        // 智能搜尋：若仍未找到，嘗試透過貼圖名稱搜尋
        if (!foundRoughnessMap) {
            const exclude = [originalMaterial.map, originalMaterial.normalMap, originalMaterial.aoMap, originalMaterial.emissiveMap].filter(t => t);
            const roughTex = _searchTextureByName(originalMaterial, ['roughness', 'rough', 'rgh'], exclude);
            if (roughTex) { mat.roughnessMap = roughTex; foundRoughnessMap = true; }
        }

        if (mat.roughnessMap) {
            mat.roughnessMap.colorSpace = THREE.NoColorSpace;
            mat.roughnessMap.needsUpdate = true;
        }

        // 當找到 roughness 貼圖、且原始數值未從 FBX buffer 或 userData 擈到時，
        // 才強制設 roughness=1.0（避免貼圖被舉重）。
        // 若 FBX buffer 已擈到 scalar 值，則以其為主。
        if (foundRoughnessMap && !roughnessFromBuffer &&
            (!originalMaterial.userData || originalMaterial.userData.roughness === undefined)) {
            mat.roughness = 1.0;
        }

        if (originalMaterial.metalnessMap) {
            mat.metalnessMap = originalMaterial.metalnessMap;
            mat.metalnessMap.colorSpace = THREE.NoColorSpace;
            mat.metalnessMap.needsUpdate = true;
            if (!metalnessFromBuffer) mat.metalness = 1.0;
        } else if (metalnessMapFromBuffer) {
            // 從 FBX buffer 解析到的 metalness 貼圖
            mat.metalnessMap = metalnessMapFromBuffer;
            if (!metalnessFromBuffer) mat.metalness = 1.0;
        }

        if (originalMaterial.emissiveMap) {
            mat.emissiveMap = originalMaterial.emissiveMap;
            mat.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            mat.emissiveMap.needsUpdate = true;
            const origEmissive = originalMaterial.emissive;
            if (origEmissive && (origEmissive.r + origEmissive.g + origEmissive.b === 0)) {
                mat.emissive = new THREE.Color(0xffffff);
            } else {
                mat.emissive = origEmissive || new THREE.Color(0xffffff);
            }
            mat.emissiveIntensity = originalMaterial.emissiveIntensity || 1;
        }
        if (originalMaterial.aoMap) {
            mat.aoMap = originalMaterial.aoMap;
            mat.aoMap.colorSpace = THREE.NoColorSpace;
            mat.aoMap.needsUpdate = true;
            mat.aoMapIntensity = 1;
        }
        if (originalMaterial.lightMap) {
            mat.lightMap = originalMaterial.lightMap;
            mat.lightMap.colorSpace = THREE.NoColorSpace;
            mat.lightMap.needsUpdate = true;
            mat.lightMapIntensity = 1;
        }
        if (originalMaterial.alphaMap) {
            mat.alphaMap = originalMaterial.alphaMap;
            mat.alphaMap.colorSpace = THREE.NoColorSpace;
            mat.alphaMap.needsUpdate = true;
            mat.transparent = true;
        }
        if (originalMaterial.transparent) { mat.transparent = true; mat.opacity = originalMaterial.opacity || 1; }

        if (child.geometry.attributes.uv2) { /* exists */ }
        else if (child.geometry.attributes.uv) { child.geometry.setAttribute('uv2', child.geometry.attributes.uv.clone()); }

        // Set texture wrapping to repeat for UV scaling
        const textureMaps = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'lightMap', 'emissiveMap', 'alphaMap', 'transmissionMap', 'bumpMap'];
        textureMaps.forEach(mapName => {
            if (mat[mapName] && mat[mapName].isTexture) {
                mat[mapName].wrapS = mat[mapName].wrapT = THREE.RepeatWrapping;
                mat[mapName].generateMipmaps = true;
                mat[mapName].minFilter = THREE.LinearMipmapLinearFilter;
                mat[mapName].anisotropy = 2;
                mat[mapName].needsUpdate = true;
            }
        });

        newMaterials.push(mat);
        appState.materials.push({
            name: originalMaterial.name || `Material_${appState.materials.length}`,
            material: mat,
            originalMaterial: originalMaterial
        });
        appState.originalMaterialData.push({
            color: mat.color.clone(),
            roughness: mat.roughness,
            metalness: mat.metalness,
            normalScale: mat.normalMap ? mat.normalScale.clone() : null
        });
    });

    child.material = wasArray ? newMaterials : newMaterials[0];
}

// 模組層級函式（不在 forEach 內重複建立），透過貼圖名稱搜尋材質屬性
function _searchTextureByName(obj, keywords, excludeTextures = []) {
    if (!obj) return null;
    const seen = new Set();
    const traverse = (current) => {
        if (!current || typeof current !== 'object') return null;
        if (seen.has(current)) return null;
        seen.add(current);
        if (current.isTexture) {
            if (excludeTextures.includes(current)) return null;
            if (current.name && keywords.some(k => current.name.toLowerCase().includes(k))) return current;
            return null;
        }
        for (const key in current) {
            if (key === 'parent' || key === 'children' || key === 'geometry' || key === 'source') continue;
            const result = traverse(current[key]);
            if (result) return result;
        }
        return null;
    };
    return traverse(obj);
}

function _onLoadComplete(object) {
    updateMaterialSelect();
    centerCamera(object);

    const missingTextures = [];
    appState.materials.forEach((matInfo) => {
        const mat = matInfo.material;
        if (matInfo.originalMaterial) {
            const orig = matInfo.originalMaterial;
            ['map', 'normalMap', 'roughnessMap', 'metalnessMap'].forEach(type => {
                if (orig[type] && !mat[type]) missingTextures.push(`${matInfo.name}: ${type}`);
            });
        }
    });

    if (missingTextures.length > 0) showWarning(`⚠️ 偵測到 ${missingTextures.length} 個貼圖無法載入`, missingTextures.slice(0, 5), true);

    setTimeout(() => { if (appState.materials.length > 0 && appState.currentMaterial) updateAllTexturePreviews(); }, 500);
    document.getElementById('loading').style.display = 'none';
}

export function setupLoaderUIEvents() {
    document.getElementById('fbxUpload').addEventListener('change', loadFBX);
}

// ========================================================================
// FBX 原始 Buffer PBR 屬性 + 貼圖連結解析器
// ------------------------------------------------------------------------
// Three.js FBXLoader 只支援 Phong 模型。當 FBX 把 Roughness 貼圖接在
// ShininessExponent / Roughness / Metalness 等 slot 上時,FBXLoader 會
// 直接略過並印出 "ShininessExponent map is not supported" 警告。
//
// 此處在 FBXLoader 執行前自行解析 FBX,回傳
//   Map<materialName, {
//     roughness?: number,
//     metalness?: number,
//     roughnessTexture?: {filename, content: Uint8Array|null, mime},
//     metalnessTexture?: {...}
//   }>
// 支援 ASCII 與 Binary FBX。
// ========================================================================
function _extractFBXPBRData(buffer) {
    try {
        const u8 = new Uint8Array(buffer);
        const header = String.fromCharCode.apply(null, u8.subarray(0, Math.min(21, u8.length)));
        const isBinary = header.startsWith('Kaydara FBX Binary');
        if (isBinary) {
            const tree = _parseBinaryFBXTree(buffer);
            return _extractFromFBXTree(tree);
        }
        const text = new TextDecoder('utf-8').decode(u8);
        return _extractFromAsciiFBX(text);
    } catch (e) {
        console.warn('FBX PBR parser 失敗:', e);
        return new Map();
    }
}

// ---------- Binary FBX Tree Parser ----------
function _parseBinaryFBXTree(buffer) {
    const dv = new DataView(buffer);
    const u8 = new Uint8Array(buffer);
    let offset = 23; // "Kaydara FBX Binary  \0\x1a\0"
    const version = dv.getUint32(offset, true);
    offset += 4;
    const is64 = version >= 7500;
    const root = { name: '__root', props: [], children: [] };
    const decoder = new TextDecoder('utf-8');

    function readUInt() {
        if (is64) {
            const low = dv.getUint32(offset, true);
            const high = dv.getUint32(offset + 4, true);
            offset += 8;
            return high * 0x100000000 + low;
        }
        const v = dv.getUint32(offset, true);
        offset += 4;
        return v;
    }

    function readProp() {
        const type = String.fromCharCode(dv.getUint8(offset));
        offset += 1;
        switch (type) {
            case 'Y': { const v = dv.getInt16(offset, true); offset += 2; return v; }
            case 'C': { const v = dv.getUint8(offset); offset += 1; return !!v; }
            case 'I': { const v = dv.getInt32(offset, true); offset += 4; return v; }
            case 'F': { const v = dv.getFloat32(offset, true); offset += 4; return v; }
            case 'D': { const v = dv.getFloat64(offset, true); offset += 8; return v; }
            case 'L': {
                const low = dv.getUint32(offset, true);
                const high = dv.getInt32(offset + 4, true);
                offset += 8;
                return high * 0x100000000 + low;
            }
            case 'S': {
                const len = dv.getUint32(offset, true); offset += 4;
                const s = decoder.decode(u8.subarray(offset, offset + len));
                offset += len;
                return s;
            }
            case 'R': {
                const len = dv.getUint32(offset, true); offset += 4;
                const bytes = u8.slice(offset, offset + len); // copy
                offset += len;
                return bytes;
            }
            default: {
                // 陣列型別 f/i/d/l/b/c — 略過不解碼(我們只要 scalar/string/bytearray)
                if ('fidlbc'.indexOf(type) !== -1) {
                    const arrayLen = dv.getUint32(offset, true);
                    const encoding = dv.getUint32(offset + 4, true);
                    const compressedLen = dv.getUint32(offset + 8, true);
                    offset += 12;
                    const sizeMap = { f: 4, i: 4, d: 8, l: 8, b: 1, c: 1 };
                    offset += (encoding === 1 ? compressedLen : arrayLen * sizeMap[type]);
                    return null;
                }
                throw new Error('Unknown FBX prop type: ' + type + ' @' + (offset - 1));
            }
        }
    }

    function readNode() {
        const endOffset = readUInt();
        if (endOffset === 0) return null;
        const numProps = readUInt();
        readUInt(); // propListLen (未使用)
        const nameLen = dv.getUint8(offset); offset += 1;
        const name = decoder.decode(u8.subarray(offset, offset + nameLen));
        offset += nameLen;
        const props = [];
        for (let i = 0; i < numProps; i++) props.push(readProp());
        const children = [];
        const sentinelSize = is64 ? 25 : 13;
        while (offset < endOffset - sentinelSize) {
            const child = readNode();
            if (!child) break;
            children.push(child);
        }
        offset = endOffset; // 跳過 null sentinel
        return { name, props, children };
    }

    const bufEnd = dv.byteLength - (is64 ? 25 : 13);
    while (offset < bufEnd) {
        const node = readNode();
        if (!node) break;
        root.children.push(node);
    }
    return root;
}

// 從 FBX object name "Name\x00\x01Type" 中取出純 Name
function _extractFBXName(raw) {
    if (typeof raw !== 'string') return '';
    const parts = raw.split(/\x00\x01/);
    if (parts.length === 2) {
        const known = new Set(['Material', 'Texture', 'Video', 'Geometry', 'Model', 'Deformer',
            'NodeAttribute', 'AnimationCurve', 'AnimationCurveNode', 'AnimationLayer',
            'AnimationStack', 'Pose', 'CollectionExclusive', 'Implementation']);
        if (known.has(parts[1])) return parts[0];
        if (known.has(parts[0])) return parts[1];
        return parts[0];
    }
    return parts[0];
}

// 從 tree 結構中抽出 Material + Texture + Video + Connections,組成 PBR Map
function _extractFromFBXTree(tree) {
    const pbrMap = new Map();
    const objectsNode = tree.children.find(n => n.name === 'Objects');
    const connectionsNode = tree.children.find(n => n.name === 'Connections');
    if (!objectsNode || !connectionsNode) return pbrMap;

    const videos = new Map();     // id -> {filename, content}
    const textures = new Map();   // id -> {name, videoId, filename, content}
    const materials = new Map();  // id -> {name, scalars, texturesByProp}

    for (const child of objectsNode.children) {
        const id = child.props[0];
        const rawName = child.props[1];
        const name = _extractFBXName(rawName);

        if (child.name === 'Video') {
            let filename = '';
            let content = null;
            for (const sub of child.children) {
                if ((sub.name === 'RelativeFilename' || sub.name === 'Filename') && !filename) {
                    filename = String(sub.props[0] || '');
                } else if (sub.name === 'Content' && sub.props[0] instanceof Uint8Array && sub.props[0].length > 0) {
                    content = sub.props[0];
                }
            }
            videos.set(id, { filename, content, name });
        } else if (child.name === 'Texture') {
            let filename = '';
            for (const sub of child.children) {
                if ((sub.name === 'RelativeFilename' || sub.name === 'FileName' || sub.name === 'Filename') && !filename) {
                    filename = String(sub.props[0] || '');
                }
            }
            textures.set(id, { name, videoId: null, filename, content: null });
        } else if (child.name === 'Material') {
            const scalars = {};
            const props70 = child.children.find(n => n.name === 'Properties70');
            if (props70) {
                for (const p of props70.children) {
                    if (p.name !== 'P') continue;
                    const key = String(p.props[0] || '').toLowerCase();
                    // Properties70 P props 格式:["Key","Type","SubType","Flags",value...]
                    let val = null;
                    for (let i = 4; i < p.props.length; i++) {
                        if (typeof p.props[i] === 'number') { val = p.props[i]; break; }
                    }
                    if (val === null) continue;
                    if (key === 'roughness' || key.endsWith('|roughness')) {
                        scalars.roughness = Math.max(0, Math.min(1, val));
                    } else if (key === 'metalness' || key === 'metallic' ||
                               key.endsWith('|metalness') || key.endsWith('|metallic')) {
                        scalars.metalness = Math.max(0, Math.min(1, val));
                    }
                }
            }
            materials.set(id, { name, scalars, texturesByProp: {} });
        }
    }

    // 處理 Connections
    for (const c of connectionsNode.children) {
        if (c.name !== 'C') continue;
        const type = c.props[0];
        const srcId = c.props[1];
        const dstId = c.props[2];
        const propName = c.props[3];

        // Video → Texture (OO)
        if (type === 'OO' && videos.has(srcId) && textures.has(dstId)) {
            const tex = textures.get(dstId);
            if (tex.videoId === null) tex.videoId = srcId;
        }
        // Texture → Material (OP,property)
        else if (type === 'OP' && textures.has(srcId) && materials.has(dstId) && typeof propName === 'string') {
            const mat = materials.get(dstId);
            if (!mat.texturesByProp[propName]) mat.texturesByProp[propName] = srcId;
        }
    }

    // 判斷 Phong 貼圖 property 的意義:
    // - ShininessExponent / Shininess:多半實際為 roughness 或 gloss(3ds Max / Maya 匯出)
    // - Roughness / RoughnessMap:直接對應
    // - SpecularFactor / ReflectionFactor:進一步 fallback
    // - Metalness / Metallic / MetalnessMap:對應 metalness
    const roughKeys = ['Roughness', 'RoughnessMap', 'ShininessExponent', 'Shininess'];
    const metalKeys = ['Metalness', 'Metallic', 'MetalnessMap', 'MetallicMap', 'ReflectionFactor'];
    const fallbackGlossKeys = ['SpecularFactor']; // 罕見 fallback(比如某些 spec/gloss 工作流)

    for (const [, mat] of materials) {
        const entry = {};
        if (mat.scalars.roughness !== undefined) entry.roughness = mat.scalars.roughness;
        if (mat.scalars.metalness !== undefined) entry.metalness = mat.scalars.metalness;

        const pickTexture = (propList, storeKey, storePropKey) => {
            for (const prop of propList) {
                const texId = mat.texturesByProp[prop];
                if (!texId) continue;
                const tex = textures.get(texId);
                if (!tex) continue;
                const vid = tex.videoId !== null ? videos.get(tex.videoId) : null;
                const filename = vid && vid.filename ? vid.filename : tex.filename;
                const content = vid && vid.content ? vid.content : tex.content;
                entry[storeKey] = { filename, content };
                entry[storePropKey] = prop;
                return true;
            }
            return false;
        };

        pickTexture(roughKeys, 'roughnessTexture', 'roughnessProp') ||
            pickTexture(fallbackGlossKeys, 'roughnessTexture', 'roughnessProp');
        pickTexture(metalKeys, 'metalnessTexture', 'metalnessProp');

        if (Object.keys(entry).length > 0 && mat.name) {
            pbrMap.set(mat.name, entry);
        }
    }

    return pbrMap;
}

// ---------- ASCII FBX fallback(簡化版,僅抽 scalar) ----------
function _extractFromAsciiFBX(text) {
    const result = new Map();
    const materialRegex = /Material:\s*\d+\s*,\s*"Material::([^"]+)"\s*,\s*"[^"]*"\s*\{([\s\S]*?)\n\s*\}/g;
    let m;
    while ((m = materialRegex.exec(text)) !== null) {
        const name = m[1];
        const body = m[2];
        const props = {};
        const propBlock = /Properties70:\s*\{([\s\S]*?)\n\s*\}/.exec(body);
        const scanBody = propBlock ? propBlock[1] : body;
        const pRegex = /P:\s*"([^"]+)"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*"[^"]*"\s*,\s*([-\d.eE+]+)/g;
        let pm;
        while ((pm = pRegex.exec(scanBody)) !== null) {
            const key = pm[1].toLowerCase();
            const val = parseFloat(pm[2]);
            if (isNaN(val)) continue;
            if (key === 'roughness') props.roughness = Math.max(0, Math.min(1, val));
            else if (key === 'metalness' || key === 'metallic') props.metalness = Math.max(0, Math.min(1, val));
        }
        if (Object.keys(props).length > 0) result.set(name, props);
    }
    return result;
}

// 根據 filename 推斷 MIME,給內嵌貼圖的 Blob URL 使用
function _guessMimeFromFilename(filename) {
    const ext = (filename || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    if (!ext) return 'image/png';
    const map = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', bmp: 'image/bmp',
        webp: 'image/webp', gif: 'image/gif', tga: 'image/x-tga' };
    return map[ext[1]] || 'image/png';
}

// 從內嵌 content 或 filename 建立 THREE.Texture(非同步)
function _createTextureFromPBREntry(entry, isColor) {
    if (!entry) return null;
    const tex = new THREE.Texture();
    tex.colorSpace = isColor ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.anisotropy = 2;

    if (entry.content && entry.content.length > 0) {
        // 內嵌貼圖:用 Blob URL + Image 載入
        const mime = _guessMimeFromFilename(entry.filename);
        const blob = new Blob([entry.content], { type: mime });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
            tex.image = img;
            tex.needsUpdate = true;
            URL.revokeObjectURL(url);
            appState.needsRender = true;
        };
        img.onerror = () => {
            console.warn('內嵌貼圖載入失敗:', entry.filename);
            URL.revokeObjectURL(url);
        };
        img.src = url;
        return tex;
    }
    // 無內嵌資料 — 本地檔案無法從瀏覽器讀取,放棄
    return null;
}