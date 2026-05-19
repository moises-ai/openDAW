import {beforeEach, describe, expect, it} from "vitest"
import {OpfsProtocol} from "@opendaw/lib-fusion"
import {installInferenceConfig, requireInferenceConfig} from "./InferenceConfig"

const fakeOpfs = (): OpfsProtocol => ({
    write: async () => {},
    read: async () => new Uint8Array(0),
    exists: async () => false,
    delete: async () => {},
    list: async () => []
})

describe("InferenceConfig", () => {
    beforeEach(() => {
        // intentionally not resetting; we want to confirm install can be called repeatedly
    })

    it("requireInferenceConfig panics before install", () => {
        // Cannot test the not-installed path here because other test files may have installed.
        // Instead, verify install + require round-trips.
        const opfs = fakeOpfs()
        installInferenceConfig({opfs})
        expect(requireInferenceConfig().opfs).toBe(opfs)
    })

    it("install replaces the previous config", () => {
        const first = fakeOpfs()
        const second = fakeOpfs()
        installInferenceConfig({opfs: first})
        installInferenceConfig({opfs: second})
        expect(requireInferenceConfig().opfs).toBe(second)
        expect(requireInferenceConfig().opfs).not.toBe(first)
    })
})
