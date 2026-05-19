import {panic} from "@opendaw/lib-std"
import {defineTask} from "../Task"

export interface BasicPitchInput {
    readonly audio: Float32Array     // mono, 22050 Hz expected by Basic Pitch
    readonly sampleRate: number
}

export interface BasicPitchNote {
    readonly startSeconds: number
    readonly endSeconds: number
    readonly pitchMidi: number          // 21..108 (piano range)
    readonly velocity: number           // 0..1
    readonly pitchBendCents: number     // average, signed
}

export interface BasicPitchOutput {
    readonly notes: ReadonlyArray<BasicPitchNote>
    readonly sampleRate: number
}

export const BasicPitchTask = defineTask<BasicPitchInput, BasicPitchOutput>({
    key: "audio-to-midi",
    model: {
        // Self-hosted on assets.opendaw.studio. Source:
        // AEmotionStudio/basic-pitch-onnx-models (Apache-2.0).
        url: "https://assets.opendaw.studio/models/basic-pitch/v0.4.0/model.onnx",
        sha256: "2c3c1d144bfa61ad236e92e169c13535c880469a12a047d4e73451f2c059a0ec",
        bytes: 230_444,
        version: "v0.4.0"
    },
    executionProviders: ["webgpu", "wasm"],
    async run(_input, _env) {
        // The Basic Pitch model emits per-frame onset, contour, and note
        // probability tensors that need to be combined into discrete note
        // events via the published peak-picking and note-tracking algorithm.
        // Implementation deferred; the model file ships with the lib so the
        // download path is fully wired and the task can be filled in
        // without further infrastructure changes.
        return panic("BasicPitchTask.run not implemented yet")
    }
})
