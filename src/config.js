// Game tuning constants. All builders read from here — never hardcode.
export const CFG = {
  town: {
    residents: 60,
    pallbearers: 6,
    worldRadius: 90,        // meters, playable square half-extent
    blockSize: 18,          // street grid spacing
  },
  player: {
    speed: 4.2,             // m/s
    sprintMul: 1.6,
    radius: 0.4,
    interactRange: 1.4,     // kiss/kill trigger distance
  },
  hunger: {
    max: 100,
    decayPerSec: 0.35,
    killRestore: 34,        // feeding on a man
    convertCost: 22,        // converting a woman costs hunger
    rotRestore: 30,
  },
  rot: {
    max: 100,
    decayPerSec: 0.22,      // slow bodily decay
    starveAccel: 0.5,       // extra decay/sec at zero hunger
  },
  escalation: {
    // evidence thresholds → stage
    stages: ['oblivious', 'suspicious', 'armed', 'screening', 'cordon'],
    bodyEvidence: 1,
    witnessedKill: 3,
    witnessedConvert: 2,
    thresholds: [0, 4, 12, 24, 40],
  },
  take: {
    cutInSec: 0.22,         // hard cut to first person
    holdSec: 2.6,           // kill duration (uncomfortable)
    cutOutSec: 0.18,        // snap back out
    shakeAmp: 0.05,
  },
  camera: {
    fov: 55,
    thirdDist: 4.2,
    thirdHeight: 2.0,
    shoulder: 0.55,         // lateral offset
    firstHeight: 1.55,
    lerp: 6.0,
  },
  render: {
    ps1ResolutionScale: 0.5,   // low internal resolution, upscaled
    snapVertex: 1 / 220,       // vertex jitter quantization
    fogColor: 0x0a0b0c,
    fogDensity: 0.022,
    gradeTint: [1.55, 1.62, 1.46],  // desaturated, faint sick green
    exposure: 2.1,                   // lift for readable silhouettes
    ditherAmount: 1.0,
  },
  npc: {
    walkSpeed: 1.4,
    fleeSpeed: 3.4,
    sightRange: 16,
    sightFovDeg: 100,
    thinkHz: 5,              // staggered AI updates — CPU budget
    convertSpeed: 1.2,       // horde members seek victims
  },
  run: {
    targetMinutes: [20, 30],
  },
};

export const STAGES = CFG.escalation.stages;
