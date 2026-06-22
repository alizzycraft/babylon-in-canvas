import * as BABYLON from '@babylonjs/core';

export const BIC_DEPTH_SURFACE_CLEARANCE = 0.002;

export function getBicDepthMeshPosition(depth: number): number {
  return -(Math.max(depth, 0) / 2 + BIC_DEPTH_SURFACE_CLEARANCE);
}

export interface BicSpatialEffectValues {
  readonly depth: number;
  readonly glowRadius: number;
  readonly glowIntensity: number;
}

export function readBicSpatialEffectValues(element: HTMLElement): BicSpatialEffectValues {
  const style = getComputedStyle(element);

  return {
    depth: readNumber(style, '--bic-depth', 0),
    glowRadius: readNumber(style, '--bic-glow-radius', 18),
    glowIntensity: readNumber(style, '--bic-glow-intensity', 0),
  };
}

export class BicSurfaceEffects {
  private readonly depthMesh: BABYLON.Mesh;
  private readonly depthMaterial: BABYLON.StandardMaterial;
  private readonly glowLayer: BABYLON.GlowLayer;
  private lastSignature = '';

  constructor(
    scene: BABYLON.Scene,
    private readonly root: BABYLON.Mesh,
    private readonly renderMeshes: readonly BABYLON.Mesh[],
    private readonly host: HTMLElement,
    id: string,
    private readonly supportsDepth = true,
  ) {
    this.depthMesh = BABYLON.MeshBuilder.CreateBox(`${id}-depth`, {
      width: 1,
      height: 1,
      depth: 1,
    }, scene);
    this.depthMesh.parent = root;
    this.depthMesh.isPickable = false;

    this.depthMaterial = new BABYLON.StandardMaterial(`${id}-depth-material`, scene);
    this.depthMaterial.diffuseColor = new BABYLON.Color3(0.025, 0.04, 0.08);
    this.depthMaterial.emissiveColor = new BABYLON.Color3(0.015, 0.025, 0.055);
    this.depthMaterial.specularColor = BABYLON.Color3.Black();
    this.depthMesh.material = this.depthMaterial;

    this.glowLayer = new BABYLON.GlowLayer(`${id}-glow`, scene, {
      blurKernelSize: 18,
    });
    for (const mesh of renderMeshes) {
      this.glowLayer.addIncludedOnlyMesh(mesh);
    }
    this.glowLayer.customEmissiveColorSelector = (_mesh, _subMesh, _material, result) => {
      result.set(0.28, 0.58, 1, 1);
    };
  }

  update(): BicSpatialEffectValues {
    const values = readBicSpatialEffectValues(this.host);
    const signature = `${values.depth}:${values.glowRadius}:${values.glowIntensity}`;

    if (signature === this.lastSignature) {
      return values;
    }

    this.lastSignature = signature;
    this.depthMesh.setEnabled(this.supportsDepth && values.depth > 0);
    this.depthMesh.scaling.z = Math.max(values.depth, 0.0001);
    this.depthMesh.position.z = getBicDepthMeshPosition(values.depth);
    this.glowLayer.intensity = Math.max(values.glowIntensity, 0);
    this.glowLayer.blurKernelSize = Math.max(values.glowRadius, 1);
    this.glowLayer.isEnabled = values.glowIntensity > 0;

    this.host.dataset['bicDepth'] = String(values.depth);
    this.host.dataset['bicGlowRadius'] = String(values.glowRadius);
    this.host.dataset['bicGlowIntensity'] = String(values.glowIntensity);

    return values;
  }

  dispose(): void {
    this.glowLayer.dispose();
    this.depthMesh.dispose();
    this.depthMaterial.dispose();
  }
}

function readNumber(style: CSSStyleDeclaration, property: string, fallback: number): number {
  const raw = style.getPropertyValue(property).trim();

  if (raw === '') {
    return fallback;
  }

  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : fallback;
}
