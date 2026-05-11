// Stand-alone benchmark of the proposed block-copy optimisation for
// Playfield/SampleVoice's hot loop. Mirrors the per-output-sample shape of the
// real kernel (4 reads + 2 writes, linear interpolation, variable rate, stereo)
// without touching SampleVoice.ts or any device/audio-engine code.

export type SampleReadKernel = "direct" | "blockcopy"
export type SampleReadThread = "main" | "worker"

export type SampleReadTest = {
    readonly id: string
    readonly label: string
    readonly sizeMB: number       // total stereo source bytes per voice (e.g. 3.84 = 10 s @ 48 kHz stereo Float32)
    readonly rateRatio: number    // playback rate; >1 reads more source frames per output frame
    readonly voices: number       // simultaneous voices, each with its own source array
}

export type SampleReadResult = {
    readonly id: string
    readonly label: string
    readonly sizeMB: number
    readonly rateRatio: number
    readonly voices: number
    readonly thread: SampleReadThread
    readonly directNsPerSample: number
    readonly blockcopyNsPerSample: number
    readonly speedup: number
    readonly directBestMs: number
    readonly blockcopyBestMs: number
}

// Each row gets run twice (direct + blockcopy) on each thread (main + worker).
// Mix of small-sample (SoundFont-like, plan predicts wash), medium-sample
// (Playfield default, where the plan claims a big win on Linux), and large-
// sample / many-voice cases that exceed L2/L3 (worst case for direct read).
export const SAMPLE_READ_TESTS: ReadonlyArray<SampleReadTest> = [
    {id: "sf-1.0-1",  label: "Small  50 KB · 1.0× · 1 voice",  sizeMB: 0.05, rateRatio: 1.0, voices: 1},
    {id: "sf-2.0-1",  label: "Small  50 KB · 2.0× · 1 voice",  sizeMB: 0.05, rateRatio: 2.0, voices: 1},
    {id: "sf-4.0-4",  label: "Small  50 KB · 4.0× · 4 voices", sizeMB: 0.05, rateRatio: 4.0, voices: 4},
    {id: "pf-0.5-1",  label: "Playfield 3.84 MB · 0.5× · 1 voice",  sizeMB: 3.84, rateRatio: 0.5, voices: 1},
    {id: "pf-1.0-1",  label: "Playfield 3.84 MB · 1.0× · 1 voice",  sizeMB: 3.84, rateRatio: 1.0, voices: 1},
    {id: "pf-1.0-2",  label: "Playfield 3.84 MB · 1.0× · 2 voices", sizeMB: 3.84, rateRatio: 1.0, voices: 2},
    {id: "pf-1.0-4",  label: "Playfield 3.84 MB · 1.0× · 4 voices", sizeMB: 3.84, rateRatio: 1.0, voices: 4},
    {id: "pf-2.0-1",  label: "Playfield 3.84 MB · 2.0× · 1 voice",  sizeMB: 3.84, rateRatio: 2.0, voices: 1},
    {id: "pf-4.0-1",  label: "Playfield 3.84 MB · 4.0× · 1 voice",  sizeMB: 3.84, rateRatio: 4.0, voices: 1},
    {id: "pf-4.0-4",  label: "Playfield 3.84 MB · 4.0× · 4 voices", sizeMB: 3.84, rateRatio: 4.0, voices: 4},
    {id: "lg-1.0-1",  label: "Large  16 MB · 1.0× · 1 voice",  sizeMB: 16,   rateRatio: 1.0, voices: 1},
    {id: "lg-1.0-4",  label: "Large  16 MB · 1.0× · 4 voices", sizeMB: 16,   rateRatio: 1.0, voices: 4},
    {id: "lg-4.0-4",  label: "Large  16 MB · 4.0× · 4 voices", sizeMB: 16,   rateRatio: 4.0, voices: 4}
]

const QUANTUM = 128
const WARMUP_RUNS = 3
const TIMED_RUNS = 7
const TARGET_MS_PER_RUN = 50          // each timed run targets ~50 ms of work
const MAX_LOCAL_FRAMES = 8192          // safety cap for local block-copy buffers

let DCE_SINK = 0

const allocateSource = (sizeMB: number): { L: Float32Array, R: Float32Array, frames: number } => {
    const totalBytes = Math.max(1024, Math.round(sizeMB * 1024 * 1024))
    const stereoFrames = Math.max(QUANTUM * 2, Math.floor(totalBytes / (2 * 4)))
    const L = new Float32Array(stereoFrames)
    const R = new Float32Array(stereoFrames)
    // Cheap deterministic fill that doesn't compress to a constant in the JIT.
    for (let i = 0; i < stereoFrames; i++) {
        L[i] = ((i * 0.000123) % 1.0) - 0.5
        R[i] = ((i * 0.000231) % 1.0) - 0.5
    }
    return {L, R, frames: stereoFrames}
}

// Mirrors SampleVoice.ts:77 — direct reads from the (potentially multi-MB)
// source array each output sample. Envelope is folded into a constant `env`
// because the bench is about memory traffic, not branch-prediction.
const directKernel = (
    inpL: Float32Array,
    inpR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    startPosition: number,
    rateRatio: number,
    span: number,
    env: number
): number => {
    let position = startPosition
    let acc = 0.0
    for (let i = 0; i < span; i++) {
        const intPosition = position | 0
        const frac = position - intPosition
        const l = inpL[intPosition] * (1.0 - frac) + inpL[intPosition + 1] * frac
        const r = inpR[intPosition] * (1.0 - frac) + inpR[intPosition + 1] * frac
        outL[i] += l * env
        outR[i] += r * env
        acc += l + r
        position += rateRatio
    }
    return acc
}

// Same maths as directKernel, but the inner loop reads from L1-resident
// `localL` / `localR` after a single SIMD memcpy of the source window.
// See plans/optimise-memory-read.md for the rationale.
const blockcopyKernel = (
    inpL: Float32Array,
    inpR: Float32Array,
    outL: Float32Array,
    outR: Float32Array,
    localL: Float32Array,
    localR: Float32Array,
    startPosition: number,
    rateRatio: number,
    span: number,
    env: number
): number => {
    const startInt = startPosition | 0
    const samplesNeeded = Math.min(localL.length, Math.ceil(span * Math.abs(rateRatio)) + 2)
    localL.set(inpL.subarray(startInt, startInt + samplesNeeded))
    localR.set(inpR.subarray(startInt, startInt + samplesNeeded))
    let localPos = startPosition - startInt
    let acc = 0.0
    for (let i = 0; i < span; i++) {
        const intPos = localPos | 0
        const frac = localPos - intPos
        const l = localL[intPos] * (1.0 - frac) + localL[intPos + 1] * frac
        const r = localR[intPos] * (1.0 - frac) + localR[intPos + 1] * frac
        outL[i] += l * env
        outR[i] += r * env
        acc += l + r
        localPos += rateRatio
    }
    return acc
}

type Sources = ReadonlyArray<{ L: Float32Array, R: Float32Array, frames: number }>

const positionsFor = (sources: Sources): Float64Array => {
    const positions = new Float64Array(sources.length)
    for (let v = 0; v < sources.length; v++) {
        // Stagger so voices read different pages — reproduces the TLB pressure
        // multiple simultaneous Playfield voices put on a shared sample.
        positions[v] = (sources[v].frames * 0.13 * (v + 1)) | 0
    }
    return positions
}

const advanceWithWrap = (
    position: number,
    rateRatio: number,
    span: number,
    sourceFrames: number
): number => {
    const next = position + span * rateRatio
    const safeMax = sourceFrames - Math.abs(span * rateRatio) - 4
    if (next < 1 || next > safeMax) {return 1.0}
    return next
}

const median = (sorted: ReadonlyArray<number>): number => sorted[(sorted.length - 1) >> 1]

const measureKernel = (
    kernel: SampleReadKernel,
    sources: Sources,
    rateRatio: number,
    quantaPerRun: number
): { bestMs: number, medianMs: number, totalSamples: number } => {
    const outL = new Float32Array(QUANTUM)
    const outR = new Float32Array(QUANTUM)
    const localFrames = Math.min(MAX_LOCAL_FRAMES, Math.ceil(QUANTUM * Math.abs(rateRatio)) + 8)
    const localL = kernel === "blockcopy" ? new Float32Array(localFrames) : new Float32Array(0)
    const localR = kernel === "blockcopy" ? new Float32Array(localFrames) : new Float32Array(0)
    const env = 0.5
    const positions = positionsFor(sources)
    const runOnce = (): number => {
        let acc = 0.0
        for (let q = 0; q < quantaPerRun; q++) {
            for (let v = 0; v < sources.length; v++) {
                const src = sources[v]
                let position = positions[v]
                if (kernel === "direct") {
                    acc += directKernel(src.L, src.R, outL, outR, position, rateRatio, QUANTUM, env)
                } else {
                    acc += blockcopyKernel(src.L, src.R, outL, outR, localL, localR, position, rateRatio, QUANTUM, env)
                }
                positions[v] = advanceWithWrap(position, rateRatio, QUANTUM, src.frames)
            }
        }
        return acc
    }
    for (let w = 0; w < WARMUP_RUNS; w++) {DCE_SINK ^= runOnce() | 0}
    const samples: Array<number> = []
    for (let r = 0; r < TIMED_RUNS; r++) {
        const start = performance.now()
        const value = runOnce()
        const elapsed = performance.now() - start
        DCE_SINK ^= value | 0
        samples.push(elapsed)
    }
    samples.sort((a, b) => a - b)
    const totalSamples = quantaPerRun * sources.length * QUANTUM
    return {bestMs: samples[0], medianMs: median(samples), totalSamples}
}

const calibrateQuanta = (sources: Sources, rateRatio: number): number => {
    // Quick warm calibration so each timed run hits TARGET_MS_PER_RUN. We use
    // the direct kernel's first few quanta to estimate, then scale.
    const probe = measureKernel("direct", sources, rateRatio, Math.max(64, 1024 >> Math.max(0, sources.length - 1)))
    const nsPerSample = (probe.bestMs * 1_000_000) / probe.totalSamples
    const targetSamples = (TARGET_MS_PER_RUN * 1_000_000) / nsPerSample
    const samplesPerQuantum = sources.length * QUANTUM
    return Math.max(64, Math.ceil(targetSamples / samplesPerQuantum))
}

export const runSampleReadTest = (test: SampleReadTest, thread: SampleReadThread): SampleReadResult => {
    const sources: Sources = Array.from({length: test.voices}, () => allocateSource(test.sizeMB))
    const quantaPerRun = calibrateQuanta(sources, test.rateRatio)
    const direct    = measureKernel("direct",    sources, test.rateRatio, quantaPerRun)
    const blockcopy = measureKernel("blockcopy", sources, test.rateRatio, quantaPerRun)
    const directNsPerSample    = (direct.bestMs    * 1_000_000) / direct.totalSamples
    const blockcopyNsPerSample = (blockcopy.bestMs * 1_000_000) / blockcopy.totalSamples
    const speedup = blockcopyNsPerSample > 0 ? directNsPerSample / blockcopyNsPerSample : 0
    return {
        id: test.id,
        label: test.label,
        sizeMB: test.sizeMB,
        rateRatio: test.rateRatio,
        voices: test.voices,
        thread,
        directNsPerSample,
        blockcopyNsPerSample,
        speedup,
        directBestMs: direct.bestMs,
        blockcopyBestMs: blockcopy.bestMs
    }
}

export const consumeSink = (): number => DCE_SINK
