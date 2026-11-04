'use strict';

const {
  STATUS,
  createPlaybackState,
  positionAt,
  transition,
  snapshot,
  computeDriftMs,
  correctionFor,
} = require('../src/services/playbackStateMachine');

const T0 = 1_700_000_000_000;

describe('authoritative playback state machine', () => {
  test('position only advances while playing', () => {
    let state = createPlaybackState({ durationSeconds: 600, now: T0 });
    expect(state.status).toBe(STATUS.IDLE);
    expect(positionAt(state, T0 + 10_000)).toBe(0);

    state = transition(state, 'play', { now: T0, positionSeconds: 30 });
    expect(state.status).toBe(STATUS.PLAYING);
    expect(positionAt(state, T0 + 5_000)).toBeCloseTo(35, 3);

    state = transition(state, 'pause', { now: T0 + 5_000 });
    expect(state.status).toBe(STATUS.PAUSED);
    expect(positionAt(state, T0 + 60_000)).toBeCloseTo(35, 3);
  });

  test('resuming does not lose the paused position', () => {
    let state = transition(createPlaybackState({ durationSeconds: 600, now: T0 }), 'play', {
      now: T0,
      positionSeconds: 12,
    });
    state = transition(state, 'pause', { now: T0 + 3_000 });
    state = transition(state, 'play', { now: T0 + 30_000 });
    expect(positionAt(state, T0 + 30_000)).toBeCloseTo(15, 3);
    expect(positionAt(state, T0 + 31_000)).toBeCloseTo(16, 3);
  });

  test('seeking freezes the clock and resumes the previous status', () => {
    let state = transition(createPlaybackState({ durationSeconds: 600, now: T0 }), 'play', {
      now: T0,
    });
    state = transition(state, 'seek', { now: T0 + 1_000, positionSeconds: 120 });
    expect(state.status).toBe(STATUS.SEEKING);
    expect(positionAt(state, T0 + 9_000)).toBeCloseTo(120, 3);

    state = transition(state, 'seekEnd', { now: T0 + 9_000 });
    expect(state.status).toBe(STATUS.PLAYING);
    expect(positionAt(state, T0 + 10_000)).toBeCloseTo(121, 3);
  });

  test('buffering resumes to playing, and ready restores the paused state', () => {
    let playing = transition(createPlaybackState({ durationSeconds: 60, now: T0 }), 'play', {
      now: T0,
    });
    playing = transition(playing, 'buffer', { now: T0 + 2_000 });
    expect(playing.status).toBe(STATUS.BUFFERING);
    playing = transition(playing, 'ready', { now: T0 + 4_000 });
    expect(playing.status).toBe(STATUS.PLAYING);

    let paused = transition(createPlaybackState({ durationSeconds: 60, now: T0 }), 'buffer', {
      now: T0,
    });
    paused = transition(paused, 'ready', { now: T0 + 1_000 });
    expect(paused.status).toBe(STATUS.PAUSED);
  });

  test('positions are clamped to the title duration and never negative', () => {
    const state = transition(createPlaybackState({ durationSeconds: 90, now: T0 }), 'seek', {
      now: T0,
      positionSeconds: 5_000,
    });
    expect(state.positionSeconds).toBe(90);

    const rewound = transition(state, 'seek', { now: T0 + 1, positionSeconds: -30 });
    expect(rewound.positionSeconds).toBe(0);
  });

  test('revisions increase on every accepted intent, snapshots round positions', () => {
    let state = createPlaybackState({ durationSeconds: 60, now: T0 });
    state = transition(state, 'play', { now: T0, positionSeconds: 0 });
    state = transition(state, 'seek', { now: T0 + 500, positionSeconds: 10.123456 });
    const snap = snapshot(state, T0 + 500);
    expect(state.revision).toBe(2);
    expect(snap.positionSeconds).toBe(10.123);
    expect(snap.serverNow).toBe(T0 + 500);
  });

  test('drift is positive when the participant is behind the room', () => {
    expect(computeDriftMs(12, 10)).toBe(2000);
    expect(computeDriftMs(10, 12.5)).toBe(-2500);
  });

  test('correction stays silent under the soft threshold and seeks when hard', () => {
    const quiet = correctionFor({
      driftMs: 120,
      softMs: 250,
      hardMs: 1200,
      authoritativePositionSeconds: 100,
      clientPositionSeconds: 99.88,
    });
    expect(quiet.mode).toBe('none');
    expect(quiet.apply).toBe(false);

    const soft = correctionFor({
      driftMs: 600,
      softMs: 250,
      hardMs: 1200,
      authoritativePositionSeconds: 100,
      clientPositionSeconds: 99.4,
    });
    expect(soft).toMatchObject({ apply: true, mode: 'soft', targetRate: 1.05 });

    const hard = correctionFor({
      driftMs: -2600,
      softMs: 250,
      hardMs: 1200,
      authoritativePositionSeconds: 100,
      clientPositionSeconds: 102.6,
    });
    expect(hard).toMatchObject({ apply: true, mode: 'hard', targetRate: 1 });
    expect(hard.targetPositionSeconds).toBe(100);
  });
});
