import {describe, expect, it} from "vitest"
import {tensor} from "./Tensor"

describe("Tensor", () => {
    it("constructs a float32 tensor", () => {
        const data = new Float32Array([1, 2, 3, 4])
        const t = tensor("float32", data, [2, 2])
        expect(t.type).toBe("float32")
        expect(t.data).toBe(data)
        expect(t.dims).toEqual([2, 2])
    })

    it("constructs an int32 tensor", () => {
        const data = new Int32Array([10, 20, 30])
        const t = tensor("int32", data, [3])
        expect(t.type).toBe("int32")
        expect(t.data).toBe(data)
        expect(t.dims).toEqual([3])
    })

    it("constructs an int64 tensor with BigInt64Array", () => {
        const data = new BigInt64Array([1n, 2n])
        const t = tensor("int64", data, [2])
        expect(t.type).toBe("int64")
        expect(t.data).toBe(data)
    })

    it("preserves multi-dimensional shapes", () => {
        const data = new Float32Array(2 * 3 * 4)
        const t = tensor("float32", data, [2, 3, 4])
        expect(t.dims).toEqual([2, 3, 4])
        expect(t.data.length).toBe(24)
    })
})
