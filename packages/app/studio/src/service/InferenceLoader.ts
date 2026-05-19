import {isNull, Nullable} from "@opendaw/lib-std"
import type * as InferenceLib from "@opendaw/lib-inference"
import {Workers} from "@opendaw/studio-core"

type InferenceModule = typeof InferenceLib

let cached: Nullable<InferenceModule> = null

/**
 * Lazy-load `@opendaw/lib-inference` and install it (once) on first use.
 * Keeps the lib-inference chunk out of the studio's boot bundle. Safe to
 * call from any feature that needs to run an inference task.
 */
export const ensureInference = async (): Promise<typeof InferenceLib.Inference> => {
    if (isNull(cached)) {
        cached = await import("@opendaw/lib-inference")
        cached.Inference.install({opfs: Workers.Opfs})
    }
    return cached.Inference
}
