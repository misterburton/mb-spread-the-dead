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
    decayPerSec: 0.55,
    killRestore: 30,        // feeding on a man
    convertCost: 26,        // converting a woman costs hunger
    rotRestore: 26,
  },
  rot: {
    max: 100,
    decayPerSec: 0.28,      // slow bodily decay
    starveAccel: 0.6,       // extra decay/sec at zero hunger
  },
  escalation: {
    // evidence thresholds → stage
    stages: ['oblivious', 'suspicious', 'armed', 'screening', 'cordon'],
    bodyEvidence: 1,
    witnessedKill: 3,
    witnessedConvert: 2,
    thresholds: [0, 6, 18, 30, 48],
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
    fogColor: 0x2d2d2a,           // gray-green murk — fog IS the draw distance
    fogDensity: 0.030,
    gradeTint: [1.5, 1.58, 1.42],  // desaturated, faint sick green
    exposure: 1.9,                   // era grade lifts, doesn't wash
    ditherAmount: 1.0,
  },
  npc: {
    walkSpeed: 1.4,
    fleeSpeed: 3.4,
    sightRange: 16,
    sightFovDeg: 100,
    thinkHz: 5,              // staggered AI updates — CPU budget
    convertSpeed: 0.85,      // horde members seek victims (slower than a walker:
                             // converts happen by cornering, not chasing down)
    turnedFleeRadius: 4,     // living residents flee a turned closing within this
  },
  run: {
    targetMinutes: [20, 30],
  },
};

export const STAGES = CFG.escalation.stages;
