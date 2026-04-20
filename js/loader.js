import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { TGALoader } from 'three/addons/loaders/TGALoader.js';
import { appState } from './state.js';
import { showWarning, centerCamera } from './utils.js';
import { updateMaterialSelect, updateAllTexturePreviews } from './materials.js';

export function loadFBX(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('loading').style.display = 'block';
    const reader = new FileReader();
    
    reader.onload = function(e) {
        const manager = new THREE.LoadingManager();
        manager.addHandler(/\.tga$/i, new TGALoader());
        const loader = new FBXLoader(manager);

        try {
            const object = loader.parse(e.target.result, '');
            
            if (appState.currentModel) {
                // --- VRAM 優化關鍵：徹底銷毀舊模型的 GPU 資源 ---
                appState.currentModel.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry) child.geometry.dispose();
                        if (child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => {
                                // 遍歷材質的所有屬性，若為貼圖則釋放 (排除共用的 envMap)
                                Object.keys(m).forEach(key => {
                                    if (m[key] && m[key].isTexture && key !== 'envMap') {
                                        m[key].dispose();
                                    }
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
            appState.scene.add(object);

            // ⬇️ 新增這 1 行 ⬇️
            appState.meshCache = [];
            // ⬆️ 新增結束 ⬆️

            object.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // ⬇️ 新增這 1 行 ⬇️
                    appState.meshCache.push(child);
                    // ⬆️ 新增結束 ⬆️
                    
                    // 處理多重材質 (Array) 或單一材質
                    const oldMaterials = Array.isArray(child.material) ? child.material : [child.material];
                    const newMaterials = [];

                    oldMaterials.forEach(originalMaterial => {
                        // 1. 讀取 FBX 原始數值 (Roughness, Metalness, Color)
                        let initRoughness = 0.5;
                        let initMetalness = 0;
                        let initColor = originalMaterial.color || new THREE.Color(0xffffff);
                        
                        // 嘗試從不同屬性讀取 Roughness
                        if (originalMaterial.userData && originalMaterial.userData.roughness !== undefined) {
                            initRoughness = parseFloat(originalMaterial.userData.roughness);
                        } else if (originalMaterial.roughness !== undefined) {
                            initRoughness = originalMaterial.roughness;
                        } else if (originalMaterial.shininess !== undefined) {
                            // Phong Shininess (0-100) 轉換為 Roughness (0-1)
                            // 經驗公式：Roughness = 1 - (Shininess / 100)
                            initRoughness = 1.0 - (Math.min(originalMaterial.shininess, 100) / 100.0);
                        } else if (originalMaterial.isMeshLambertMaterial) {
                            // Lambert 材質沒有高光，視為全粗糙 (Roughness = 1.0)
                            initRoughness = 1.0;
                        }

                        if (originalMaterial.metalness !== undefined) {
                            initMetalness = originalMaterial.metalness;
                        }

                        const mat = new THREE.MeshPhysicalMaterial({
                            color: initColor,
                            roughness: Math.max(0, Math.min(1.5, initRoughness)),
                            metalness: Math.max(0, Math.min(1, initMetalness)),
                            envMapIntensity: 1,
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
                            if (tex && tex.isTexture) {
                                tex.anisotropy = 2; // 從預設 4 降到 2
                                tex.generateMipmaps = true;
                            }
                        };
                        
                        // 嘗試從不同屬性讀取 Roughness Map
                        let foundRoughnessMap = false;
                        if (originalMaterial.roughnessMap) { mat.roughnessMap = originalMaterial.roughnessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
                        else if (originalMaterial.specularMap) { mat.roughnessMap = originalMaterial.specularMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
                        else if (originalMaterial.shininessMap) { mat.roughnessMap = originalMaterial.shininessMap; foundRoughnessMap = true; optimizeTexture(mat.shininessMap); }
                        else if (originalMaterial.glossinessMap) { mat.roughnessMap = originalMaterial.glossinessMap; foundRoughnessMap = true; optimizeTexture(mat.glossinessMap); }
                        // Fallback: 檢查 userData (某些導出器可能會將貼圖放在這裡)
                        else if (originalMaterial.userData && originalMaterial.userData.roughnessMap) { mat.roughnessMap = originalMaterial.userData.roughnessMap; foundRoughnessMap = true; optimizeTexture(mat.roughnessMap); }
                        
                        // 智能搜尋：若仍未找到，嘗試透過貼圖名稱搜尋 (解決 FBXLoader 未正確對應屬性的問題)
                        // 這是針對 "Roughness Tip" 的強力解法：只要貼圖名稱含有 'roughness'，就強制抓取
                        if (!foundRoughnessMap) {
                            const searchTextureByName = (obj, keywords, excludeTextures = []) => {
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
                            };
                            
                            const exclude = [originalMaterial.map, originalMaterial.normalMap, originalMaterial.aoMap, originalMaterial.emissiveMap].filter(t => t);
                            const roughTex = searchTextureByName(originalMaterial, ['roughness', 'rough', 'rgh'], exclude);
                            if (roughTex) { mat.roughnessMap = roughTex; foundRoughnessMap = true; }
                        }

                        if (mat.roughnessMap) {
                            mat.roughnessMap.colorSpace = THREE.NoColorSpace;
                            mat.roughnessMap.needsUpdate = true;
                        }

                        // 修正：若有 Roughness 貼圖，且沒有透過 userData 指定數值，則預設為 1.0
                        // 這是因為 Three.js 會將 Roughness 數值與貼圖相乘 (Roughness * Map)
                        // 若保留 Blender 預設的 0.5，會導致貼圖效果減半，看起來過於光滑
                        if (foundRoughnessMap && (!originalMaterial.userData || originalMaterial.userData.roughness === undefined)) {
                            mat.roughness = 1.0;
                        }

                        if (originalMaterial.metalnessMap) { 
                            mat.metalnessMap = originalMaterial.metalnessMap; 
                            mat.metalnessMap.colorSpace = THREE.NoColorSpace;
                            mat.metalnessMap.needsUpdate = true;
                            mat.metalness = 1.0; 
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
                                
                                // 🚀 VRAM 優化：開啟 Mipmaps 但降低 Anisotropy
                                mat[mapName].generateMipmaps = true;
                                mat[mapName].minFilter = THREE.LinearMipmapLinearFilter;
                                mat[mapName].anisotropy = 2; // 從 4 降到 2 節省 VRAM
                                
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

                    child.material = Array.isArray(child.material) ? newMaterials : newMaterials[0];
                }
            });

            updateMaterialSelect();
            centerCamera(object);
            
            // Check for issues
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
            
        } catch (error) {
            console.error(error);
            alert('FBX 載入失敗: ' + error.message);
            document.getElementById('loading').style.display = 'none';
        }
    };
    reader.readAsArrayBuffer(file);
}

export function setupLoaderUIEvents() {
    document.getElementById('fbxUpload').addEventListener('change', loadFBX);
}