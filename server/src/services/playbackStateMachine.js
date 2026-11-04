'use strict';

/**
 * Authoritative room playback state machine.
 *
 * The Host's client sends *intent* (play / pause / seek / buffer / ready); the
 * server owns the clock. Participants never write playback state — they only
 * report their local position for drift measurement.
 *
 * Statuses: idle -> playing <-> paused, with transient seeking and buffering
 * states that resume to the status they came from.
 */

const STATUS = Object.freeze({
  IDLE: 'idle',
  PLAYING: 'playing',
  PAUSED: 'paused',
  SEEKING: 'seeking',
  BUFFERING: 'buffering',
});

const ACTIONS = Object.freeze(['play', 'pause', 'seek', 'seekEnd', 'buffer', 'ready', 'end']);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function createPlaybackState({ durationSeconds = 0, now = Date.now() } = {}) {
  return {
    status: STATUS.IDLE,
    positionSeconds: 0,
    durationSeconds,
    updatedAt: now,
    resumeStatus: null,
    revision: 0,
    lastAction: 'init',
    lastIssuedBy: null,
  };
}

/** Position the room believes it is at, right now. */
function positionAt(state, now = Date.now()) {
  const base = state.positionSeconds || 0;
  if (state.status !== STATUS.PLAYING) {
    return clamp(base, 0, state.durationSeconds || Infinity);
  }
  const elapsed = Math.max(0, now - state.updatedAt) / 1000;
  return clamp(base + elapsed, 0, state.durationSeconds || Infinity);
}

function transition(state, action, options = {}) {
  if (!ACTIONS.includes(action)) {
    throw new Error(`Unknown playback action: ${action}`);
  }
  const now = options.now ?? Date.now();
  const durationSeconds =
    options.durationSeconds !== undefined ? options.durationSeconds : state.durationSeconds;
  const current = positionAt(state, now);
  const requested = Number.isFinite(options.positionSeconds)
    ? options.positionSeconds
    : current;
  const target = clamp(requested, 0, durationSeconds || Infinity);

  const next = {
    ...state,
    durationSeconds,
    updatedAt: now,
    revision: state.revision + 1,
    lastAction: action,
    lastIssuedBy: options.issuedBy || state.lastIssuedBy || null,
  };

  switch (action) {
    case 'play': {
      if (state.status === STATUS.PLAYING) {
        return { ...next, revision: state.revision, positionSeconds: target };
      }
      return {
        ...next,
        status: STATUS.PLAYING,
        positionSeconds: target,
        resumeStatus: null,
      };
    }
    case 'pause': {
      return {
        ...next,
        status: STATUS.PAUSED,
        positionSeconds: current,
        resumeStatus: null,
      };
    }
    case 'seek': {
      // Transient seeking state: the clock is frozen at the target until the
      // Host's video confirms the seek completed (seekEnd).
      const wasPlaying = state.status === STATUS.PLAYING;
      return {
        ...next,
        status: STATUS.SEEKING,
        positionSeconds: target,
        resumeStatus: wasPlaying ? STATUS.PLAYING : STATUS.PAUSED,
      };
    }
    case 'seekEnd': {
      const resume = state.resumeStatus || STATUS.PAUSED;
      return {
        ...next,
        status: resume === STATUS.PLAYING ? STATUS.PLAYING : STATUS.PAUSED,
        positionSeconds: state.positionSeconds,
        resumeStatus: null,
      };
    }
    case 'buffer': {
      const resume =
        state.status === STATUS.PLAYING || state.status === STATUS.SEEKING
          ? STATUS.PLAYING
          : state.resumeStatus || STATUS.PAUSED;
      return {
        ...next,
        status: STATUS.BUFFERING,
        positionSeconds: current,
        resumeStatus: resume,
      };
    }
    case 'ready': {
      const resume = state.resumeStatus || STATUS.PAUSED;
      return {
        ...next,
        status: resume === STATUS.PLAYING ? STATUS.PLAYING : STATUS.PAUSED,
        positionSeconds: state.positionSeconds,
        resumeStatus: null,
      };
    }
    case 'end': {
      return {
        ...next,
        status: STATUS.PAUSED,
        positionSeconds: durationSeconds,
        resumeStatus: null,
      };
    }
    /* istanbul ignore next */
    default:
      return next;
  }
}

function snapshot(state, now = Date.now()) {
  return {
    status: state.status,
    positionSeconds: Number(positionAt(state, now).toFixed(3)),
    durationSeconds: state.durationSeconds,
    revision: state.revision,
    updatedAt: state.updatedAt,
    resumeStatus: state.resumeStatus,
    lastAction: state.lastAction,
    serverNow: now,
  };
}

/** Positive drift = the participant is behind the room. */
function computeDriftMs(authoritativePositionSeconds, clientPositionSeconds) {
  return Math.round((authoritativePositionSeconds - clientPositionSeconds) * 1000);
}

/**
 * Decide how a participant should correct its local player.
 * - under soft threshold: leave it alone
 * - soft: nudge playbackRate so the client catches up without a visible jump
 * - hard: seek (participant is unrecoverably out of sync, e.g. after a stall)
 */
function correctionFor({
  driftMs,
  softMs = 250,
  hardMs = 1200,
  authoritativePositionSeconds,
  clientPositionSeconds,
}) {
  const abs = Math.abs(driftMs);
  if (abs <= softMs) {
    return {
      apply: false,
      mode: 'none',
      driftMs,
      targetPositionSeconds: clientPositionSeconds,
      targetRate: 1,
    };
  }
  if (abs <= hardMs) {
    // Cap the rate change at 5% so audio pitch and motion stay natural.
    const targetRate = driftMs > 0 ? 1.05 : 0.95;
    return {
      apply: true,
      mode: 'soft',
      driftMs,
      targetPositionSeconds: authoritativePositionSeconds,
      targetRate,
    };
  }
  return {
    apply: true,
    mode: 'hard',
    driftMs,
    targetPositionSeconds: authoritativePositionSeconds,
    targetRate: 1,
  };
}

module.exports = {
  STATUS,
  ACTIONS,
  createPlaybackState,
  positionAt,
  transition,
  snapshot,
  computeDriftMs,
  correctionFor,
  clamp,
};
