import {asDefined, clampUnit, panic, unitValue} from "@opendaw/lib-std"
import {defineTask, ModelDescriptor, TaskDefinition, TaskEnvironment} from "../Task"
import {tensor, TensorMap} from "../Tensor"

export interface StemSeparationInput {
    /**
     * Audio samples in PLANAR layout: `[ch0_s0, ch0_s1, ..., ch0_sN-1,
     * ch1_s0, ch1_s1, ..., ch1_sN-1]`. This matches the layout produced by
     * concatenating `AudioBuffer.getChannelData(c)` for each channel and is
     * what htdemucs's `[1, channels, samples]` input expects directly.
     * Total length must be `channels * samplesPerChannel`.
     */
    readonly audio: Float32Array
    readonly channels: 1 | 2
    readonly sampleRate: number               // expected: 44100
}

export interface StemSeparationOutput {
    readonly drums: Float32Array
    readonly bass: Float32Array
    readonly other: Float32Array
    readonly vocals: Float32Array
    readonly sampleRate: number
    readonly channels: 1 | 2
}

const HTDEMUCS_SAMPLE_RATE = 44100
const HTDEMUCS_SEGMENT_SECONDS = 7.8
const HTDEMUCS_OVERLAP_SECONDS = 0.25
const STEM_ORDER = ["drums", "bass", "other", "vocals"] as const
type StemName = typeof STEM_ORDER[number]

const segmentSamples = (sampleRate: number) => Math.round(HTDEMUCS_SEGMENT_SECONDS * sampleRate)
const overlapSamples = (sampleRate: number) => Math.round(HTDEMUCS_OVERLAP_SECONDS * sampleRate)

/**
 * Split a single channel into overlapping windows of `windowSize` samples
 * with `overlap` samples shared between consecutive windows. The last
 * window is right-padded with zeros if the input length does not divide
 * evenly. Returns the list of window starts and the padded length so the
 * combiner can trim the result back to the original length.
 */
export const planChunks = (length: number,
                           windowSize: number,
                           overlap: number): {starts: ReadonlyArray<number>, padded: number} => {
    if (windowSize <= overlap) {return panic("windowSize must exceed overlap")}
    const stride = windowSize - overlap
    if (length === 0) {return {starts: [], padded: 0}}
    const starts: Array<number> = []
    let position = 0
    while (position + windowSize <= length) {
        starts.push(position)
        position += stride
    }
    if (starts.length === 0 || starts[starts.length - 1] + windowSize < length) {
        starts.push(Math.max(0, length - windowSize))
    }
    const padded = starts[starts.length - 1] + windowSize
    return {starts, padded: Math.max(padded, length)}
}

/**
 * Apply a triangular fade over the overlap region when stitching window N's
 * tail with window N+1's head. Returns a per-sample weight in 0..1 for
 * window N's samples in the overlap region.
 */
export const overlapFade = (overlap: number, indexInOverlap: number): unitValue =>
    overlap === 0 ? 1.0 : clampUnit(1.0 - indexInOverlap / overlap)

/**
 * Combine per-window stem outputs back into one continuous stream using
 * triangular cross-fade in the overlap regions. Each boundary's overlap
 * size is derived from the actual window starts (not assumed uniform),
 * so a shifted last window with a wider partial overlap is handled
 * correctly.
 */
export const combineWindows = (
    windows: ReadonlyArray<Float32Array>,
    starts: ReadonlyArray<number>,
    _hint: number,
    totalLength: number
): Float32Array => {
    const out = new Float32Array(totalLength)
    if (windows.length === 0) {return out}
    const last = windows.length - 1
    const leftOverlapOf = (windowIndex: number, length: number): number => {
        if (windowIndex === 0) {return 0}
        const prevStart = starts[windowIndex - 1]
        const prevEnd = prevStart + windows[windowIndex - 1].length
        return Math.max(0, Math.min(length, prevEnd - starts[windowIndex]))
    }
    const rightOverlapOf = (windowIndex: number, length: number): number => {
        if (windowIndex === last) {return 0}
        const currEnd = starts[windowIndex] + length
        const nextStart = starts[windowIndex + 1]
        return Math.max(0, Math.min(length, currEnd - nextStart))
    }
    for (let windowIndex = 0; windowIndex < windows.length; windowIndex++) {
        const window = windows[windowIndex]
        const start = starts[windowIndex]
        const leftOverlap = leftOverlapOf(windowIndex, window.length)
        const rightOverlap = rightOverlapOf(windowIndex, window.length)
        for (let i = 0; i < window.length; i++) {
            const target = start + i
            if (target < 0 || target >= totalLength) {continue}
            const inLeftOverlap = leftOverlap > 0 && i < leftOverlap
            const inRightOverlap = rightOverlap > 0 && i >= window.length - rightOverlap
            if (inLeftOverlap) {
                const weight = 1 - overlapFade(leftOverlap, i)
                out[target] += window[i] * weight
            } else if (inRightOverlap) {
                const offset = i - (window.length - rightOverlap)
                const weight = overlapFade(rightOverlap, offset)
                out[target] += window[i] * weight
            } else {
                out[target] = window[i]
            }
        }
    }
    return out
}

/**
 * Adapt the model's output to the canonical 4-stem array. The export may
 * emit either:
 *   - 1 stacked tensor of shape [1, 4, channels, samples] (stem axis at 1),
 *   - 4 separate tensors, each shaped [1, channels, samples].
 * The 4 stems are assumed to follow htdemucs's documented order:
 * drums, bass, other, vocals.
 */
const extractStems = (
    output: TensorMap,
    outputNames: ReadonlyArray<string>,
    channels: number,
    window: number
): Record<StemName, Float32Array> => {
    const expectedPerStem = channels * window
    if (outputNames.length === 1) {
        const t = asDefined(output[outputNames[0]], `Missing output: ${outputNames[0]}`)
        const data = t.data as Float32Array
        const stemAxis = t.dims[1]
        if (stemAxis !== 4) {
            return panic(`Cannot interpret single output of shape ${JSON.stringify(t.dims)}; expected stem axis of length 4 at position 1`)
        }
        const stride = data.length / 4
        return {
            drums:  data.slice(0 * stride, 1 * stride),
            bass:   data.slice(1 * stride, 2 * stride),
            other:  data.slice(2 * stride, 3 * stride),
            vocals: data.slice(3 * stride, 4 * stride)
        }
    }
    if (outputNames.length < 4) {
        return panic(`Expected at least 4 outputs, got ${outputNames.length}: ${JSON.stringify(outputNames)}`)
    }
    const stems: Partial<Record<StemName, Float32Array>> = {}
    for (let i = 0; i < 4; i++) {
        const name = outputNames[i]
        const t = asDefined(output[name], `Missing output: ${name}`)
        const data = t.data as Float32Array
        if (data.length !== expectedPerStem) {
            return panic(`Output "${name}" has ${data.length} samples, expected ${expectedPerStem}`)
        }
        stems[STEM_ORDER[i]] = data.slice()
    }
    return stems as Record<StemName, Float32Array>
}

const htdemucsRun = async (
    input: StemSeparationInput,
    env: TaskEnvironment
): Promise<StemSeparationOutput> => {
    if (input.sampleRate !== HTDEMUCS_SAMPLE_RATE) {
        return panic(`htdemucs requires ${HTDEMUCS_SAMPLE_RATE} Hz; got ${input.sampleRate}`)
    }
    if (env.inputNames.length === 0) {return panic("Model has no inputs")}
    if (env.outputNames.length === 0) {return panic("Model has no outputs")}
    const inputName = env.inputNames[0]
    const channels = input.channels
    const samplesPerChannel = input.audio.length / channels
    const window = segmentSamples(input.sampleRate)
    const overlap = overlapSamples(input.sampleRate)
    const plan = planChunks(samplesPerChannel, window, overlap)

    // Per-stem accumulators, one Float32Array per stem (planar layout
    // [channels * window] per chunk).
    const stemWindows: Record<StemName, Array<Float32Array>> = {
        drums: [], bass: [], other: [], vocals: []
    }

    for (let chunkIndex = 0; chunkIndex < plan.starts.length; chunkIndex++) {
        env.signal.match({
            none: () => {},
            // throwIfAborted re-throws `signal.reason` (e.g. `Errors.AbortError`
            // from the AiDemux cancel button) so callers can detect the
            // cancellation via `Errors.isAbort` instead of seeing a generic
            // `Error("Cancelled")`.
            some: (signal: AbortSignal) => signal.throwIfAborted()
        })
        const start = plan.starts[chunkIndex]
        const chunk = new Float32Array(channels * window)
        // Both `input.audio` and `chunk` use planar layout
        //   [c0_s0..c0_sN, c1_s0..c1_sN]
        // so we read with `c * samplesPerChannel + i` and write with
        // `c * window + i`.
        for (let c = 0; c < channels; c++) {
            for (let i = 0; i < window; i++) {
                const sourceIndex = start + i
                chunk[c * window + i] = sourceIndex < samplesPerChannel
                    ? input.audio[c * samplesPerChannel + sourceIndex]
                    : 0
            }
        }
        const feeds: TensorMap = {
            [inputName]: tensor("float32", chunk, [1, channels, window])
        }
        const output = await env.session(feeds)
        const perStem = extractStems(output, env.outputNames, channels, window)
        for (const stem of STEM_ORDER) {
            stemWindows[stem].push(perStem[stem])
        }
        env.progress(clampUnit((chunkIndex + 1) / plan.starts.length))
    }

    // Stitch each stem PER CHANNEL (using the original sample-frame
    // starts), then re-pack the channels into the planar output buffer.
    // Treating the planar window as one stream and scaling starts by
    // `channels` causes inter-channel data to overwrite each other and
    // produces a half-length, garbled signal.
    const stems: Record<string, Float32Array> = {}
    for (const stem of STEM_ORDER) {
        const windowsPerChannel: Array<Array<Float32Array>> = []
        for (let c = 0; c < channels; c++) {windowsPerChannel.push([])}
        for (const win of stemWindows[stem]) {
            for (let c = 0; c < channels; c++) {
                windowsPerChannel[c].push(win.subarray(c * window, (c + 1) * window))
            }
        }
        const merged = new Float32Array(channels * samplesPerChannel)
        for (let c = 0; c < channels; c++) {
            const stitched = combineWindows(windowsPerChannel[c], plan.starts, overlap, samplesPerChannel)
            merged.set(stitched, c * samplesPerChannel)
        }
        stems[stem] = merged
    }

    return {
        drums: stems.drums,
        bass: stems.bass,
        other: stems.other,
        vocals: stems.vocals,
        sampleRate: input.sampleRate,
        channels: input.channels
    }
}

const createHtdemucsTask = (key: string, model: ModelDescriptor): TaskDefinition<StemSeparationInput, StemSeparationOutput> =>
    defineTask<StemSeparationInput, StemSeparationOutput>({
        key,
        model,
        executionProviders: ["webgpu", "wasm"],
        run: htdemucsRun
    })

/**
 * htdemucs v4 from `smank/htdemucs-onnx` (MIT). Self-hosted on
 * assets.opendaw.studio. Verified working in ORT-Web (WebGPU + WASM EPs).
 */
export const StemSeparationTask = createHtdemucsTask("stem-separation", {
    url: "https://assets.opendaw.studio/models/htdemucs/v4/model.onnx",
    sha256: "d2b401f322558cd57d67a752ed7be3fa55178a0626011eda8ac7bb74e17280c0",
    bytes: 250_000_000,
    version: "v4-smank"
})

/**
 * htdemucs v4 from `jackjiangxinfa/demucs-onnx` (Apache-2.0). Same upstream
 * Demucs v4 architecture, different ONNX export. Useful for A/B comparing
 * separation quality. Self-hosted on assets.opendaw.studio.
 */
export const StemSeparationAltTask = createHtdemucsTask("stem-separation-alt", {
    url: "https://assets.opendaw.studio/models/htdemucs-jx/v4/model.onnx",
    sha256: "0cf9f378b3a736efacafe09b8c07aafbb3109568c274ffb7b963b540aa1978d2",
    bytes: 304_330_587,
    version: "v4-jx"
})
