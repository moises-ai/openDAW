import {describe, expect, it} from "vitest"
import {TaskRegistry} from "./registry"

describe("TaskRegistry", () => {
    it("contains stem-separation", () => {
        expect(TaskRegistry["stem-separation"]).toBeDefined()
        expect(TaskRegistry["stem-separation"].key).toBe("stem-separation")
        expect(TaskRegistry["stem-separation"].model.version).toMatch(/^v4/)
    })

    it("contains stem-separation-alt", () => {
        expect(TaskRegistry["stem-separation-alt"]).toBeDefined()
        expect(TaskRegistry["stem-separation-alt"].key).toBe("stem-separation-alt")
        expect(TaskRegistry["stem-separation-alt"].model.version).toMatch(/^v4/)
    })

    it("contains audio-to-midi", () => {
        expect(TaskRegistry["audio-to-midi"]).toBeDefined()
        expect(TaskRegistry["audio-to-midi"].key).toBe("audio-to-midi")
        expect(TaskRegistry["audio-to-midi"].model.version).toBe("v0.4.0")
    })

    it("each task declares at least one execution provider", () => {
        for (const key of Object.keys(TaskRegistry) as Array<keyof typeof TaskRegistry>) {
            expect(TaskRegistry[key].executionProviders.length).toBeGreaterThan(0)
        }
    })

    it("each task's model URL is an absolute self-hosted URL", () => {
        for (const key of Object.keys(TaskRegistry) as Array<keyof typeof TaskRegistry>) {
            const url = TaskRegistry[key].model.url
            expect(url).toMatch(/^https:\/\/assets\.opendaw\.studio\/models\//)
        }
    })

    it("each task declares a non-zero byte length and a 64-char SHA-256", () => {
        for (const key of Object.keys(TaskRegistry) as Array<keyof typeof TaskRegistry>) {
            const model = TaskRegistry[key].model
            expect(model.bytes).toBeGreaterThan(0)
            expect(model.sha256).toMatch(/^[0-9a-f]{64}$/)
        }
    })
})
