import { useEffect, useRef } from "react";
import * as THREE from "three";

const DOT_COUNT = 760;
const MAX_PIXEL_RATIO = 1.5;
const FIELD_WIDTH = 18;
const FIELD_HEIGHT = 12;
const POINTER_RADIUS = 2.8;
const POINTER_STRENGTH = 0.52;
const AMBIENT_DRIFT_X = 0.08;
const AMBIENT_DRIFT_Y = 0.06;
const AMBIENT_DRIFT_Z = 0.14;

type DotPositionInput = {
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly elapsed: number;
  readonly index: number;
  readonly pointerX: number;
  readonly pointerY: number;
};

type DotField = {
  readonly basePositions: Float32Array;
  readonly geometry: THREE.BufferGeometry;
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
};

export function calculateDotPosition({
  baseX,
  baseY,
  baseZ,
  elapsed,
  index,
  pointerX,
  pointerY,
}: DotPositionInput): { readonly x: number; readonly y: number; readonly z: number } {
  const deltaX = baseX - pointerX;
  const deltaY = baseY - pointerY;
  const distance = Math.hypot(deltaX, deltaY);
  const influence = Math.max(0, 1 - distance / POINTER_RADIUS);
  const phase = index * 0.17;

  return {
    x: baseX + Math.sin(elapsed * 0.35 + phase) * AMBIENT_DRIFT_X + deltaX * influence * POINTER_STRENGTH,
    y: baseY + Math.cos(elapsed * 0.28 + phase) * AMBIENT_DRIFT_Y + deltaY * influence * POINTER_STRENGTH,
    z: baseZ + Math.sin(elapsed * 0.7 + phase) * AMBIENT_DRIFT_Z * (1 + influence),
  };
}

function createDotField(scene: THREE.Scene): DotField {
  const basePositions = new Float32Array(DOT_COUNT * 3);
  const colors = new Float32Array(DOT_COUNT * 3);

  for (let index = 0; index < DOT_COUNT; index += 1) {
    const offset = index * 3;
    const row = Math.floor(index / 38);
    const column = index % 38;
    const jitter = Math.sin(index * 19.73) * 0.14;
    basePositions[offset] = (column / 37 - 0.5) * FIELD_WIDTH + jitter;
    basePositions[offset + 1] = (row / 19 - 0.5) * FIELD_HEIGHT + Math.cos(index * 13.17) * 0.12;
    basePositions[offset + 2] = -1.8 + (index % 7) * 0.28;
    const opacity = index % 9 === 0 ? 0.82 : 0.52;
    colors[offset] = 0.16 * opacity;
    colors[offset + 1] = 0.45 * opacity;
    colors[offset + 2] = 0.83 * opacity;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(basePositions.slice(), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 0.045,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.88,
    vertexColors: true,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  scene.add(points);
  return { basePositions, geometry, points };
}

export function AdminLoginBackground(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvasElement = canvasRef.current;
    if (!canvasElement || typeof WebGLRenderingContext === "undefined") return;
    const canvas = canvasElement as HTMLCanvasElement;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    } catch {
      return;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
    camera.position.z = 10;
    const dotField = createDotField(scene);
    const pointer = new THREE.Vector2(20, 20);
    const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let frameId: number | null = null;

    function resize(): void {
      const { width, height } = canvas.getBoundingClientRect();
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function movePointer(event: PointerEvent): void {
      pointer.set(event.clientX / window.innerWidth * FIELD_WIDTH - FIELD_WIDTH / 2, -(event.clientY / window.innerHeight * FIELD_HEIGHT - FIELD_HEIGHT / 2));
    }

    function render(time: number): void {
      const positions = dotField.geometry.getAttribute("position") as THREE.BufferAttribute;
      const elapsed = time / 1000;
      for (let index = 0; index < DOT_COUNT; index += 1) {
        const offset = index * 3;
        const baseX = dotField.basePositions[offset] ?? 0;
        const baseY = dotField.basePositions[offset + 1] ?? 0;
        const position = calculateDotPosition({
          baseX,
          baseY,
          baseZ: dotField.basePositions[offset + 2] ?? 0,
          elapsed,
          index,
          pointerX: pointer.x,
          pointerY: pointer.y,
        });
        positions.setXYZ(index, position.x, position.y, position.z);
      }
      positions.needsUpdate = true;
      renderer.render(scene, camera);
      if (!prefersReducedMotion) frameId = window.requestAnimationFrame(render);
    }

    resize();
    window.addEventListener("resize", resize);
    if (!prefersReducedMotion) window.addEventListener("pointermove", movePointer, { passive: true });
    render(0);

    return () => {
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", movePointer);
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      scene.remove(dotField.points);
      dotField.geometry.dispose();
      dotField.points.material.dispose();
      scene.clear();
      renderer.dispose();
    };
  }, []);

  return (
    <div className="admin-login-background" aria-hidden="true" data-testid="admin-login-background">
      <canvas ref={canvasRef} role="presentation" data-engine="three.js r180" />
    </div>
  );
}
