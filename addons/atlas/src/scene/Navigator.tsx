/**
 * Video-game navigation over the six strict cameras (`views.ts`):
 *   Q / E          turn the isometric view a quarter (back to iso from top or front)
 *   I / T / V      isometric, top, front
 *   W A S D        move over the view's plane: the ground for iso and top, upright for front
 *   middle drag    the same move with the mouse (left drag on empty space too, for trackpads)
 *   wheel          iso: zoom; top and front: scroll up/down, shift or sideways scroll across;
 *                  ctrl/⌘ + wheel zooms anywhere (a trackpad pinch sends this)
 * Zooming an iso view right in drops to the front view; out past the far edge rises to the top
 * view. A flat lens holds the front view. It stands in for the orbit controls the camera rig
 * drives: a target, `update()` and a `start` event when the person moves.
 */
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import { MathUtils, PerspectiveCamera, Vector3 } from 'three';

import { useStore } from '../state.tsx';
import { useScene } from './shared.ts';
import { viewDirection, viewPlane, viewQuaternion, viewUp, type ViewState } from './views.ts';

/** How much of the way to its view's direction the camera turns each frame. */
const TURN = 0.14;
/** WASD speed: distances per second, scaled by how far away the camera is. */
const PAN_SPEED = 0.9;
const ZOOM_PER_PIXEL = 0.0015;
const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 2400;
/** Iso zoomed this close drops to the front view; this far rises to the top view. */
const ISO_TO_FRONT = 6;
const ISO_TO_TOP = 900;
const MOVE_KEYS = new Set(['w', 'a', 's', 'd']);

interface NavControls {
  readonly target: Vector3;
  readonly up: Vector3;
  enabled: boolean;
  enableRotate: boolean;
  update: () => void;
  addEventListener: (type: 'start', fn: () => void) => void;
  removeEventListener: (type: 'start', fn: () => void) => void;
  started: () => void;
}

export function Navigator({ flat }: { readonly flat: boolean }) {
  const { state, dispatch } = useStore();
  const { shared } = useScene();
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const set = useThree((s) => s.set);
  const view: ViewState = flat ? { mode: 'front', turn: 0 } : state.view;
  const viewRef = useRef(view);
  viewRef.current = view;
  const blocked = useRef(false);
  blocked.current = state.expanded !== null;

  const nav = useMemo<NavControls>(() => {
    const listeners = new Set<() => void>();
    const controls: NavControls = {
      target: new Vector3(),
      up: new Vector3(0, 1, 0),
      enabled: true,
      enableRotate: false,
      update: () => {
        camera.up.copy(controls.up);
        camera.lookAt(controls.target);
      },
      addEventListener: (_type, fn) => listeners.add(fn),
      removeEventListener: (_type, fn) => listeners.delete(fn),
      started: () => listeners.forEach((fn) => fn()),
    };
    return controls;
  }, [camera]);
  useEffect(() => {
    set({ controls: nav as unknown as never });
    return () => set({ controls: null });
  }, [nav, set]);

  const modeQuat = useMemo(() => viewQuaternion(view), [view.mode, view.turn]);
  useEffect(() => {
    shared.modeQuat.copy(modeQuat);
  }, [shared, modeQuat]);

  const worldPerPixel = (): number => (2 * camera.position.distanceTo(nav.target) * Math.tan(MathUtils.degToRad(camera.fov / 2))) / gl.domElement.clientHeight;
  const move = (right: number, forward: number): void => {
    const plane = viewPlane(viewRef.current);
    const step = plane.right.clone().multiplyScalar(right).add(plane.forward.clone().multiplyScalar(forward));
    nav.target.add(step);
    camera.position.add(step);
    nav.started();
  };
  const zoomTo = (length: number): void => {
    const offset = camera.position.clone().sub(nav.target);
    camera.position.copy(nav.target).addScaledVector(offset.normalize(), MathUtils.clamp(length, MIN_DISTANCE, MAX_DISTANCE));
    nav.started();
  };

  // Keys: modes, turns, and the held WASD set.
  const held = useRef(new Set<string>());
  useEffect(() => {
    const typing = (e: KeyboardEvent): boolean => e.target instanceof HTMLInputElement && !['range', 'checkbox', 'radio'].includes(e.target.type)
      || e.target instanceof HTMLSelectElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent): void => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (MOVE_KEYS.has(key)) {
        held.current.add(key);
        e.preventDefault();
        return;
      }
      if (blocked.current || flat) return;
      if (key === 'q') dispatch({ type: 'view-turn', by: 1 });
      else if (key === 'e') dispatch({ type: 'view-turn', by: -1 });
      else if (key === 'i') dispatch({ type: 'view-mode', mode: 'iso' });
      else if (key === 't') dispatch({ type: 'view-mode', mode: 'top' });
      else if (key === 'v') dispatch({ type: 'view-mode', mode: 'front' });
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent): void => {
      held.current.delete(e.key.toLowerCase());
    };
    const clear = (): void => held.current.clear();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', clear);
    };
  }, [dispatch, flat]);

  // Wheel and drag on the canvas.
  useEffect(() => {
    const el = gl.domElement;
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      if (!nav.enabled) return;
      const v = viewRef.current;
      const length = camera.position.distanceTo(nav.target);
      if (v.mode === 'iso' || e.ctrlKey || e.metaKey) {
        const next = length * Math.exp(e.deltaY * ZOOM_PER_PIXEL);
        zoomTo(next);
        if (v.mode === 'iso' && !flat && !blocked.current) {
          if (e.deltaY < 0 && next < ISO_TO_FRONT) dispatch({ type: 'view-mode', mode: 'front' });
          if (e.deltaY > 0 && next > ISO_TO_TOP) dispatch({ type: 'view-mode', mode: 'top' });
        }
        return;
      }
      const across = e.shiftKey ? e.deltaY : e.deltaX;
      const along = e.shiftKey ? 0 : e.deltaY;
      const k = worldPerPixel();
      move(across * k, -along * k);
    };
    let drag: { x: number; y: number; id: number } | null = null;
    const pointerDown = (e: PointerEvent): void => {
      // A die marks its press after this listener runs (R3F listens on the parent), so the move checks it.
      if (!nav.enabled) return;
      if (e.button !== 1 && e.button !== 0) return;
      drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
      if (e.button === 1) e.preventDefault();
    };
    const pointerMove = (e: PointerEvent): void => {
      if (!drag || e.pointerId !== drag.id) return;
      if (shared.pressingNode || shared.dragging) {
        drag = null;
        return;
      }
      const k = worldPerPixel();
      move(-(e.clientX - drag.x) * k, (e.clientY - drag.y) * k);
      drag = { ...drag, x: e.clientX, y: e.clientY };
    };
    const pointerUp = (e: PointerEvent): void => {
      if (drag && e.pointerId === drag.id) drag = null;
    };
    el.addEventListener('wheel', wheel, { passive: false });
    el.addEventListener('pointerdown', pointerDown);
    window.addEventListener('pointermove', pointerMove);
    window.addEventListener('pointerup', pointerUp);
    return () => {
      el.removeEventListener('wheel', wheel);
      el.removeEventListener('pointerdown', pointerDown);
      window.removeEventListener('pointermove', pointerMove);
      window.removeEventListener('pointerup', pointerUp);
    };
    // `move` and `zoomTo` read refs and the camera only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gl, nav, camera, shared, dispatch, flat]);

  useFrame((_, delta) => {
    const v = viewRef.current;
    // Turn toward the view's direction and up, keeping the distance.
    const offset = camera.position.clone().sub(nav.target);
    const length = offset.length() || 60;
    const dir = offset.normalize().lerp(viewDirection(v), TURN).normalize();
    camera.position.copy(nav.target).addScaledVector(dir, length);
    nav.up.lerp(viewUp(v), TURN).normalize();
    if (nav.enabled && held.current.size > 0) {
      const k = length * PAN_SPEED * delta;
      const h = held.current;
      move(((h.has('d') ? 1 : 0) - (h.has('a') ? 1 : 0)) * k, ((h.has('w') ? 1 : 0) - (h.has('s') ? 1 : 0)) * k);
    }
    nav.update();
  });

  return null;
}
