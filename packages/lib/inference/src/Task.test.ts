import {describe, expect, it} from "vitest"
import {defineTask, TaskDefinition} from "./Task"

interface FakeInput {
    readonly audio: Float32Array
    readonly sampleRate: number
}

interface FakeOutput {
    readonly drums: Float32Array
}

const FakeTask = defineTask<FakeInput, FakeOutput>({
    key: "fake-task",
    model: {
        url: "https://example.com/fake.onnx",
        sha256: "0".repeat(64),
        bytes: 1024,
        version: "v0"
    },
    executionProviders: ["webgpu", "wasm"],
    async run(_input, _env) {
        return {drums: new Float32Array(0)}
    }
})

describe("Task type plumbing", () => {
    it("defineTask preserves the I/O generic parameters", () => {
        const task: TaskDefinition<FakeInput, FakeOutput> = FakeTask
        expect(task.key).toBe("fake-task")
        expect(task.executionProviders).toEqual(["webgpu", "wasm"])
        expect(task.model.bytes).toBe(1024)
    })

    it("type-level: registry derivation produces typed TaskInput and TaskOutput", () => {
        type LocalRegistry = {readonly "fake-task": typeof FakeTask}
        type DerivedInput = LocalRegistry["fake-task"] extends TaskDefinition<infer I, unknown> ? I : never
        type DerivedOutput = LocalRegistry["fake-task"] extends TaskDefinition<unknown, infer O> ? O : never
        const inputCheck: DerivedInput = {audio: new Float32Array(0), sampleRate: 44100}
        const outputCheck: DerivedOutput = {drums: new Float32Array(0)}
        expect(inputCheck.sampleRate).toBe(44100)
        expect(outputCheck.drums).toBeInstanceOf(Float32Array)
    })
})
