export type TensorElementType = "float32" | "int32" | "int64"

export type TensorData = Float32Array | Int32Array | BigInt64Array

export interface Tensor {
    readonly type: TensorElementType
    readonly data: TensorData
    readonly dims: ReadonlyArray<number>
}

export type TensorMap = Readonly<Record<string, Tensor>>

export type SessionRun = (feeds: TensorMap) => Promise<TensorMap>

export const tensor = (type: TensorElementType,
                       data: TensorData,
                       dims: ReadonlyArray<number>): Tensor => ({type, data, dims})
