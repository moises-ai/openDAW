import {InstrumentFactory} from "@moises-ai/studio-adapters"
import {ProjectApi} from "@moises-ai/studio-core"

export namespace DefaultInstrumentFactory {
    export const create = (api: ProjectApi, factory: InstrumentFactory) => {
        api.createAnyInstrument(factory)
    }
}