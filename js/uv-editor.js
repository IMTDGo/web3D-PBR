import * as THREE from 'three';
import { appState } from './state.js';

const seamlessUniforms = {
    seamlessOffsetX: { value: 0.5 },
    seamlessOffsetY: { value: 0.5 },
    seamlessScale: { value: 1.0 },
    seamlessBlendStrength: { value: 1.0 },
    seamlessBlendWidth: { value: 0.15 }
};

export function setupUVEditorUI() {
    // UI is now static in HTML
}

export function setupUVEditorEvents() {
    // Standard UVs
    const updateVal = (id, val, suffix = '') => document.getElementById(id + 'Val').textContent = parseFloat(val).toFixed(2) + suffix;
    
    document.getElementById('uvOffsetX').addEventListener('input', (e) => { updateVal('uvOffsetX', e.target.value); updateUVs(); });
    document.getElementById('uvOffsetY').addEventListener('input', (e) => { updateVal('uvOffsetY', e.target.value); updateUVs(); });
    document.getElementById('uvRotation').addEventListener('input', (e) => { updateVal('uvRotation', e.target.value, '°'); updateUVs(); });
    
    document.getElementById('uvScaleUniform').addEventListener('input', (e) => {
        const val = e.target.value;
        updateVal('uvScaleUniform', val);
        document.getElementById('uvScaleX').value = val;
        document.getElementById('uvScaleY').value = val;
        updateVal('uvScaleX', val);
        updateVal('uvScaleY', val);
        updateUVs();
    });

    document.getElementById('uvScaleX').addEventListener('input', (e) => { updateVal('uvScaleX', e.target.value); updateUVs(); });
    document.getElementById('uvScaleY').addEventListener('input', (e) => { updateVal('uvScaleY', e.target.value); updateUVs(); });

    // Seamless
    document.getElementById('enableSeamless').addEventListener('change', (e) => {
        document.getElementById('seamlessControls').style.display = e.target.checked ? 'block' : 'none';
        updateSeamlessShader();
    });

    document.getElementById('seamlessBlendStrength').addEventListener('input', (e) => {
        updateVal('seamlessBlendStrength', e.target.value);
        updateSeamlessUniforms();
    });
    document.getElementById('seamlessBlendWidth').addEventListener('input', (e) => {
        updateVal('seamlessBlendWidth', e.target.value);
        updateSeamlessUniforms();
    });

    document.getElementById('resetUVBtn').addEventListener('click', resetUVs);
}

export function updateUVEditorFromMaterial() {
    if (!appState.currentMaterial) return;
    
    const map = appState.currentMaterial.map || appState.currentMaterial.normalMap || appState.currentMaterial.roughnessMap;
    if (map && map.isTexture) {
        document.getElementById('uvScaleX').value = map.repeat.x;
        document.getElementById('uvScaleXVal').textContent = map.repeat.x.toFixed(2);
        document.getElementById('uvScaleY').value = map.repeat.y;
        document.getElementById('uvScaleYVal').textContent = map.repeat.y.toFixed(2);
        document.getElementById('uvScaleUniform').value = map.repeat.x; // Sync uniform to X
        document.getElementById('uvScaleUniformVal').textContent = map.repeat.x.toFixed(2);
        
        document.getElementById('uvOffsetX').value = map.offset.x;
        document.getElementById('uvOffsetXVal').textContent = map.offset.x.toFixed(2);
        document.getElementById('uvOffsetY').value = map.offset.y;
        document.getElementById('uvOffsetYVal').textContent = map.offset.y.toFixed(2);
        
        const deg = Math.round(THREE.MathUtils.radToDeg(map.rotation));
        document.getElementById('uvRotation').value = deg;
        document.getElementById('uvRotationVal').textContent = deg + '°';
    }
    
    // Check if seamless shader is active
    const isSeamless = !!appState.currentMaterial.userData.isSeamless;
    document.getElementById('enableSeamless').checked = isSeamless;
    document.getElementById('seamlessControls').style.display = isSeamless ? 'block' : 'none';
}

function updateSeamlessUniforms() {
    seamlessUniforms.seamlessBlendStrength.value = parseFloat(document.getElementById('seamlessBlendStrength').value);
    seamlessUniforms.seamlessBlendWidth.value = parseFloat(document.getElementById('seamlessBlendWidth').value);
    // Uniforms are updated by reference, no need to recompile shader
}

function updateSeamlessShader() {
    if (!appState.currentMaterial) return;
    const enabled = document.getElementById('enableSeamless').checked;
    
    if (enabled) {
        appState.currentMaterial.userData.isSeamless = true;
        appState.currentMaterial.onBeforeCompile = (shader) => {
            shader.uniforms.seamlessOffsetX = seamlessUniforms.seamlessOffsetX;
            shader.uniforms.seamlessOffsetY = seamlessUniforms.seamlessOffsetY;
            shader.uniforms.seamlessScale = seamlessUniforms.seamlessScale;
            shader.uniforms.seamlessBlendStrength = seamlessUniforms.seamlessBlendStrength;
            shader.uniforms.seamlessBlendWidth = seamlessUniforms.seamlessBlendWidth;

            // Inject uniform declarations
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <common>',
                `#include <common>
                uniform float seamlessOffsetX;
                uniform float seamlessOffsetY;
                uniform float seamlessScale;
                uniform float seamlessBlendStrength;
                uniform float seamlessBlendWidth;

                float smoothEdge(float x, float width) {
                    return smoothstep(0.0, width, x) * smoothstep(0.0, width, 1.0 - x);
                }

                vec4 sampleSeamless(sampler2D tex, vec2 uv, float scale, float offX, float offY, float strength, float width) {
                    vec2 scaledUV = uv * scale;
                    vec2 baseUV = fract(scaledUV);
                    vec2 offsetUV = fract(baseUV + vec2(offX, offY));
                    
                    vec2 uv1 = offsetUV;
                    vec2 uv2 = fract(offsetUV + vec2(0.5, 0.0));
                    vec2 uv3 = fract(offsetUV + vec2(0.0, 0.5));
                    vec2 uv4 = fract(offsetUV + vec2(0.5, 0.5));
                    
                    vec4 c1 = texture2D(tex, uv1);
                    vec4 c2 = texture2D(tex, uv2);
                    vec4 c3 = texture2D(tex, uv3);
                    vec4 c4 = texture2D(tex, uv4);
                    
                    float edgeX = smoothEdge(offsetUV.x, width);
                    float edgeY = smoothEdge(offsetUV.y, width);
                    float f = strength;
                    
                    vec4 mx1 = mix(c2, c1, edgeX * f + (1.0 - f));
                    vec4 mx2 = mix(c4, c3, edgeX * f + (1.0 - f));
                    vec4 final = mix(mx2, mx1, edgeY * f + (1.0 - f));
                    
                    float center = (1.0 - edgeX) * (1.0 - edgeY) * width * 2.0;
                    final = mix(final, c4, center * f * 0.3);
                    
                    return final;
                }
                `
            );

            // Replace Map Fragment (Base Color)
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <map_fragment>',
                `
                #ifdef USE_MAP
                    vec4 texelColor = sampleSeamless(map, vMapUv, seamlessScale, seamlessOffsetX, seamlessOffsetY, seamlessBlendStrength, seamlessBlendWidth);
                    diffuseColor *= texelColor;
                #endif
                `
            );

            // Replace Roughness Fragment
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <roughnessmap_fragment>',
                `
                float roughnessFactor = roughness;
                #ifdef USE_ROUGHNESSMAP
                    vec4 texelRoughness = sampleSeamless(roughnessMap, vRoughnessMapUv, seamlessScale, seamlessOffsetX, seamlessOffsetY, seamlessBlendStrength, seamlessBlendWidth);
                    roughnessFactor *= texelRoughness.g;
                #endif
                `
            );

            // Replace Normal Map Fragment (Simplified Linear Blend)
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <normal_fragment_maps>',
                `
                #ifdef USE_NORMALMAP
                    #ifdef OBJECTSPACE_NORMALMAP
                        normal = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;
                        #ifdef FLIP_SIDED
                            normal = - normal;
                        #endif
                        #ifdef DOUBLE_SIDED
                            normal = normal * faceDirection;
                        #endif
                        normal = normalize( normalMatrix * normal );
                    #else
                        vec4 texelNormal = sampleSeamless(normalMap, vNormalMapUv, seamlessScale, seamlessOffsetX, seamlessOffsetY, seamlessBlendStrength, seamlessBlendWidth);
                        vec3 mapN = texelNormal.xyz * 2.0 - 1.0;
                        
                        mapN.xy *= normalScale;
                        #ifdef USE_TANGENT
                            mat3 vTBN = mat3( tangent, bitangent, normal );
                            normal = normalize( vTBN * mapN );
                        #else
                            normal = perturbNormal2Arb( - vViewPosition, normal, mapN, faceDirection );
                        #endif
                    #endif
                #endif
                `
            );
        };
    } else {
        // ⬇️ 完整替換為以下 3 行 ⬇️
        delete appState.currentMaterial.userData.isSeamless;
        delete appState.currentMaterial.onBeforeCompile;
        appState.currentMaterial.customProgramCacheKey = () => '';
        // ⬆️ 替換結束 ⬆️
    }
    
    appState.currentMaterial.needsUpdate = true;
    updateSeamlessUniforms(); // Ensure uniforms are set
}

function updateUVs() {
    if (!appState.currentMaterial) return;

    const scaleX = parseFloat(document.getElementById('uvScaleX').value);
    const scaleY = parseFloat(document.getElementById('uvScaleY').value);
    const offX = parseFloat(document.getElementById('uvOffsetX').value);
    const offY = parseFloat(document.getElementById('uvOffsetY').value);
    const rot = THREE.MathUtils.degToRad(parseFloat(document.getElementById('uvRotation').value));
    
    // Standard wrapping
    const wrapMode = THREE.RepeatWrapping;

    const textureMaps = ['map', 'roughnessMap', 'metalnessMap', 'normalMap', 'aoMap', 'lightMap', 'emissiveMap', 'sheenColorMap', 'sheenRoughnessMap', 'clearcoatMap', 'clearcoatRoughnessMap', 'clearcoatNormalMap', 'anisotropyMap', 'alphaMap', 'transmissionMap'];
    
    textureMaps.forEach(mapName => {
        const texture = appState.currentMaterial[mapName];
        if (texture && texture.isTexture) {
            texture.wrapS = texture.wrapT = wrapMode;
            texture.repeat.set(scaleX, scaleY);
            texture.offset.set(offX, offY);
            texture.rotation = rot;
            texture.center.set(0.5, 0.5); // Rotate around center
            texture.needsUpdate = true;
        }
    });
    appState.currentMaterial.needsUpdate = true;
}

function resetUVs() {
    document.getElementById('uvScaleUniform').value = 1;
    document.getElementById('uvScaleX').value = 1;
    document.getElementById('uvScaleY').value = 1;
    document.getElementById('uvOffsetX').value = 0;
    document.getElementById('uvOffsetY').value = 0;
    document.getElementById('uvRotation').value = 0;
    document.getElementById('enableSeamless').checked = false;
    document.getElementById('seamlessBlendStrength').value = 1.0;
    document.getElementById('seamlessBlendWidth').value = 0.15;
    document.getElementById('seamlessControls').style.display = 'none';
    
    ['uvScaleUniformVal', 'uvScaleXVal', 'uvScaleYVal'].forEach(id => document.getElementById(id).textContent = "1.00");
    ['uvOffsetXVal', 'uvOffsetYVal'].forEach(id => document.getElementById(id).textContent = "0.00");
    document.getElementById('seamlessBlendStrengthVal').textContent = "1.00";
    document.getElementById('seamlessBlendWidthVal').textContent = "0.15";
    document.getElementById('uvRotationVal').textContent = "0°";
    
    updateUVs();
    updateSeamlessShader();
}