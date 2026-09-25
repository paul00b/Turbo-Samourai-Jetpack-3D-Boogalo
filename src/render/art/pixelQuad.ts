/**
 * Affichage du rendu pixel : la vue est dessinée dans une RenderTexture à la résolution de l'art
 * (1 texel = 1 px d'art), puis ce quad l'agrandit à l'écran.
 *
 * Échantillonnage « sharp bilinear » : chaque px d'art reste un bloc net, seuls ses bords sont
 * lissés sur un pixel écran. Résultat : aucun scintillement aux zooms non entiers (zoom dynamique
 * à 2 joueurs, écrans 125 %) et un défilement sous-pixel fluide (la caméra ne saute pas de 2 px).
 * Le mode Valeurs des planches (6 niveaux de gris) est appliqué ici, sur l'image finale.
 */
import { GlProgram, Mesh, MeshGeometry, Shader, UniformGroup, type Texture } from 'pixi.js';

const VERTEX = `#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec2 uTexSize;
uniform vec2 uUsed;
uniform float uValues;
uniform float uLevels;
void main() {
  vec2 p = vUV * uUsed;
  vec2 seam = floor(p + 0.5);
  vec2 d = max(fwidth(p), vec2(1e-5));
  p = seam + clamp((p - seam) / d, -0.5, 0.5);
  p = clamp(p, vec2(0.5), uUsed - vec2(0.5));
  vec4 c = texture(uTexture, p / uTexSize);
  if (uValues > 0.5) {
    float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    l = floor(l * (uLevels - 1.0) + 0.5) / (uLevels - 1.0);
    c = vec4(vec3(l), 1.0);
  }
  finalColor = c;
}`;

export class PixelQuad {
  readonly mesh: Mesh<MeshGeometry, Shader>;
  private readonly uniforms: UniformGroup;

  constructor(texture: Texture) {
    const geometry = new MeshGeometry({
      positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    });
    this.uniforms = new UniformGroup({
      uTexSize: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uUsed: { value: new Float32Array([1, 1]), type: 'vec2<f32>' },
      uValues: { value: 0, type: 'f32' },
      uLevels: { value: 6, type: 'f32' },
    });
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex: VERTEX, fragment: FRAGMENT, name: 'pixel-quad' }),
      resources: { uTexture: texture.source, pixelUniforms: this.uniforms },
    });
    this.mesh = new Mesh({ geometry, shader, texture });
  }

  /**
   * `used` : zone utile de la RenderTexture (texels) ; le quad fait `used * scale` px CSS et part de
   * (x, y) : le décalage sous-pixel de la caméra est passé par x et y.
   */
  set(texture: Texture, texW: number, texH: number, usedW: number, usedH: number, x: number, y: number, scale: number, values: boolean): void {
    const shader = this.mesh.shader;
    if (shader && shader.resources.uTexture !== texture.source) shader.resources.uTexture = texture.source;
    const u = this.uniforms.uniforms as { uTexSize: Float32Array; uUsed: Float32Array; uValues: number };
    u.uTexSize[0] = texW;
    u.uTexSize[1] = texH;
    u.uUsed[0] = usedW;
    u.uUsed[1] = usedH;
    u.uValues = values ? 1 : 0;
    this.mesh.position.set(x, y);
    this.mesh.scale.set(usedW * scale, usedH * scale);
  }
}
