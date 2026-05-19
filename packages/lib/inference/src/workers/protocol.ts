import {ExecutionProvider, ModelDescriptor} from "../Task"
import {TensorMap} from "../Tensor"

export type WorkerCallId = number

export type MainToWorker =
    | { kind: "load", id: WorkerCallId, taskKey: string, model: ModelDescriptor, modelBytes: Uint8Array, executionProviders: ReadonlyArray<ExecutionProvider> }
    | { kind: "run", id: WorkerCallId, taskKey: string, feeds: TensorMap }
    | { kind: "release", id: WorkerCallId, taskKey: string }
    | { kind: "shutdown", id: WorkerCallId }

export type WorkerToMain =
    | { kind: "ready" }
    | { kind: "ok", id: WorkerCallId }
    | { kind: "loaded", id: WorkerCallId, inputs: ReadonlyArray<string>, outputs: ReadonlyArray<string> }
    | { kind: "result", id: WorkerCallId, output: TensorMap }
    | { kind: "error", id: WorkerCallId, message: string }
