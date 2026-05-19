import {Option, panic} from "@moises-ai/lib-std"
import {OpfsProtocol} from "@moises-ai/lib-fusion"

export interface InferenceConfig {
    readonly opfs: OpfsProtocol
}

let installed: Option<InferenceConfig> = Option.None

export const installInferenceConfig = (config: InferenceConfig): void => {
    installed = Option.wrap(config)
}

export const requireInferenceConfig = (): InferenceConfig =>
    installed.match({
        none: () => panic("Inference is not installed. Call Inference.install({opfs}) at startup."),
        some: config => config
    })
