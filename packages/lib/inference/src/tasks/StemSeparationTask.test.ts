import {describe, expect, it} from "vitest"
import {combineWindows, overlapFade, planChunks, StemSeparationTask} from "./StemSeparationTask"
import {Option} from "@opendaw/lib-std"
import {tensor, TensorMap} from "../Tensor"

describe("planChunks", () => {
    it("returns a single window when input is shorter than the window", () => {
        const plan = planChunks(1000, 4096, 256)
        expect(plan.starts).toEqual([0])
        expect(plan.padded).toBeGreaterThanOrEqual(4096)
    })

    it("strides by windowSize - overlap", () => {
        const plan = planChunks(10000, 4096, 256)
        const stride = 4096 - 256
        expect(plan.starts[0]).toBe(0)
        expect(plan.starts[1]).toBe(stride)
    })

    it("ensures the last window covers the end of the input", () => {
        const plan = planChunks(10000, 4096, 256)
        const last = plan.starts[plan.starts.length - 1]
        expect(last + 4096).toBeGreaterThanOrEqual(10000)
    })

    it("returns empty starts for empty input", () => {
        const plan = planChunks(0, 4096, 256)
        expect(plan.starts).toEqual([])
        expect(plan.padded).toBe(0)
    })
})

describe("overlapFade", () => {
    it("returns 1.0 at the start of the overlap region", () => {
        expect(overlapFade(100, 0)).toBe(1.0)
    })

    it("returns ~0 at the end of the overlap region", () => {
        expect(overlapFade(100, 99)).toBeCloseTo(0.01, 1)
    })

    it("is linear in between", () => {
        expect(overlapFade(100, 50)).toBeCloseTo(0.5, 5)
    })

    it("handles zero overlap by returning 1.0", () => {
        expect(overlapFade(0, 0)).toBe(1.0)
    })
})

describe("combineWindows", () => {
    it("produces a constant signal when all windows hold the same value", () => {
        const length = 1000
        const window = 256
        const overlap = 64
        const plan = planChunks(length, window, overlap)
        const fill = (value: number) => {
            const buffer = new Float32Array(window)
            buffer.fill(value)
            return buffer
        }
        const windows = plan.starts.map(() => fill(0.5))
        const combined = combineWindows(windows, plan.starts, overlap, length)
        // Sample well inside the signal (away from boundary effects)
        for (let i = 200; i < 800; i++) {
            expect(combined[i]).toBeCloseTo(0.5, 4)
        }
    })

    it("returns an empty buffer for an empty input", () => {
        const out = combineWindows([], [], 64, 0)
        expect(out.length).toBe(0)
    })
})

describe("StemSeparationTask integration (with mock session)", () => {
    it("calls the session once per chunk and stitches the outputs", async () => {
        const sampleRate = 44100
        const samplesPerChannel = sampleRate * 2 // 2 seconds
        const channels = 1 as const
        const audio = new Float32Array(samplesPerChannel * channels)
        for (let i = 0; i < audio.length; i++) {audio[i] = Math.sin(2 * Math.PI * 440 * (i / sampleRate))}

        let callCount = 0
        const fakeSession = async (feeds: TensorMap): Promise<TensorMap> => {
            callCount++
            const inputDims = feeds.mix.dims
            const window = inputDims[2]
            // Identity-ish: return the input as the "vocals" stem and zeros for others.
            const inputData = feeds.mix.data as Float32Array
            return {
                drums:  tensor("float32", new Float32Array(window), [1, channels, window]),
                bass:   tensor("float32", new Float32Array(window), [1, channels, window]),
                other:  tensor("float32", new Float32Array(window), [1, channels, window]),
                vocals: tensor("float32", inputData.slice(), [1, channels, window])
            }
        }

        const progressValues: Array<number> = []
        const result = await StemSeparationTask.run({audio, channels, sampleRate}, {
            session: fakeSession,
            progress: value => progressValues.push(value),
            signal: Option.None,
            inputNames: ["mix"],
            outputNames: ["drums", "bass", "other", "vocals"]
        })

        expect(callCount).toBeGreaterThan(0)
        expect(result.drums.length).toBe(audio.length)
        expect(result.vocals.length).toBe(audio.length)
        expect(result.sampleRate).toBe(sampleRate)
        expect(result.channels).toBe(1)
        // Drums was zero everywhere
        let drumsMax = 0
        for (let i = 0; i < result.drums.length; i++) {drumsMax = Math.max(drumsMax, Math.abs(result.drums[i]))}
        expect(drumsMax).toBeCloseTo(0, 5)
        // Progress reached the end
        expect(progressValues[progressValues.length - 1]).toBeCloseTo(1, 5)
    })

    it("rejects non-44100Hz input", async () => {
        await expect(StemSeparationTask.run(
            {audio: new Float32Array(48000), channels: 1, sampleRate: 48000},
            {
                session: async () => ({}),
                progress: () => {},
                signal: Option.None,
                inputNames: ["mix"],
                outputNames: ["drums", "bass", "other", "vocals"]
            }
        )).rejects.toThrow(/44100/)
    })
})
