export type Vec2 = { x: number; y: number };
export type Vec3 = { x: number; y: number; z: number };

export type GameState =
  | 'boot'
  | 'menu'
  | 'calibrate'
  | 'countdown'
  | 'playing'
  | 'paused'
  | 'gameover';

export type EnemyKind = 'grunt' | 'darter' | 'tank' | 'boss';

export type PickupKind = 'weapon' | 'shield' | 'nova' | 'aegis';

/**
 * Which device the steering came from this frame. Surfaced in the HUD so the
 * player can tell whether the gyro actually attached or we fell back to touch.
 */
export type ControlMode = 'tilt' | 'touch' | 'none';

export interface InputFrame {
  /** -1..1 desired horizontal steering, already deadzoned and clamped. */
  x: number;
  /** -1..1 desired vertical steering, already deadzoned and clamped. */
  y: number;
  /** Edge-triggered: true only on the frame the fire input went down. */
  firePressed: boolean;
  /** Level-triggered: true while the fire input is held (or autofire is on). */
  fireHeld: boolean;
  mode: ControlMode;
  /** Raw signed degrees, for the calibration HUD. */
  rawTiltX: number;
  rawTiltY: number;
}

export const EMPTY_INPUT: InputFrame = {
  x: 0,
  y: 0,
  firePressed: false,
  fireHeld: false,
  mode: 'none',
  rawTiltX: 0,
  rawTiltY: 0,
};
