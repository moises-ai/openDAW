import {BoxSchema} from "@opendaw/lib-box-forge"
import {Pointers} from "@moises-ai/studio-enums"
import {DeviceFactory} from "../../std/DeviceFactory"

export const NoopInstrumentBox: BoxSchema<Pointers> =
    DeviceFactory.createInstrument("NoopInstrumentBox", "audio", {})
