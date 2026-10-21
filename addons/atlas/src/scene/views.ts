/**
 * The six strict cameras, video-game style. The brief's axes are Z-up with
 * the ground on XY; three.js is Y-up, so here the ground is the XZ plane
 * and "up" is +Y.
 *   iso    four fixed isometric angles, turned a quarter at a time (Q, E)
 *   top    straight down; X runs across the screen, the brief's Y runs up it
 *   front  from the front, level; X across, height up: the 2D views' camera
 * Each camera has a direction (target → camera), an up vector, and the
 * plane WASD and dragging move over.
 */
import { Matrix4, Quaternion, Vector3 } from 'three';

export type ViewMode = 'iso' | 'top' | 'front';

export interface ViewState {
  readonly mode: ViewMode;
  /** The isometric quarter turn, 0 to 3. */
  readonly turn: number;
}

/** The isometric elevation: the angle whose tangent is 1/√2, so the three axes foreshorten alike. */
const ISO_ELEVATION = Math.atan(1 / Math.SQRT2);

export function viewDirection(view: ViewState): Vector3 {
  if (view.mode === 'top') return new Vector3(0, 1, 0);
  if (view.mode === 'front') return new Vector3(0, 0, 1);
  const azimuth = Math.PI / 4 + (view.turn * Math.PI) / 2;
  return new Vector3(Math.cos(ISO_ELEVATION) * Math.sin(azimuth), Math.sin(ISO_ELEVATION), Math.cos(ISO_ELEVATION) * Math.cos(azimuth));
}

export function viewUp(view: ViewState): Vector3 {
  return view.mode === 'top' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
}

/** The camera's turn once it has arrived: what nets and 2D dice face. */
export function viewQuaternion(view: ViewState): Quaternion {
  return new Quaternion().setFromRotationMatrix(new Matrix4().lookAt(viewDirection(view), new Vector3(), viewUp(view)));
}

/**
 * The plane a view moves over, as the screen's "forward" (W) and "right" (D)
 * directions on it: the ground for iso and top, the upright XY plane for front.
 */
export function viewPlane(view: ViewState): { readonly forward: Vector3; readonly right: Vector3 } {
  if (view.mode === 'front') return { forward: new Vector3(0, 1, 0), right: new Vector3(1, 0, 0) };
  if (view.mode === 'top') return { forward: new Vector3(0, 0, -1), right: new Vector3(1, 0, 0) };
  const d = viewDirection(view);
  const forward = new Vector3(-d.x, 0, -d.z).normalize();
  return { forward, right: new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize() };
}

export const turnLabel = (view: ViewState): string => (view.mode === 'iso' ? `iso ${['NE', 'SE', 'SW', 'NW'][view.turn] ?? ''}` : view.mode);
