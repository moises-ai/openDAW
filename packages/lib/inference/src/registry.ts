import {StemSeparationAltTask, StemSeparationTask} from "./tasks/StemSeparationTask"
import {BasicPitchTask, TempoDetectionTask} from "./tasks"

export const TaskRegistry = {
    "stem-separation":     StemSeparationTask,
    "stem-separation-alt": StemSeparationAltTask,
    "audio-to-midi":       BasicPitchTask,
    "tempo-detection":     TempoDetectionTask
} as const

export type TaskKey = keyof typeof TaskRegistry

// Extract I and O directly from each task's `run` function signature.
//
// We deliberately avoid `extends TaskDefinition<infer I, unknown>` because
// `TaskDefinition<I, O>`'s `run: (input: I, env) => Promise<O>` puts I in
// contravariant position and O in covariant. The conditional inference then
// collapses TaskInput to `unknown` and TaskOutput to `never`, forcing every
// caller into `as never` / `as unknown as ...` casts. Reading directly from
// the function's parameter / return type sidesteps the variance dance.
export type TaskInput<K extends TaskKey> =
    Parameters<typeof TaskRegistry[K]["run"]>[0]

export type TaskOutput<K extends TaskKey> =
    Awaited<ReturnType<typeof TaskRegistry[K]["run"]>>
