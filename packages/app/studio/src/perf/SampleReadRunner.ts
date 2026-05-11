import {tryCatch} from "@opendaw/lib-std"
import SampleReadWorker from "./sample-read-worker.ts?worker"
import {SAMPLE_READ_TESTS, SampleReadResult, runSampleReadTest} from "./SampleReadBenchmark"

export type SampleReadProgress = { readonly current: string, readonly index: number, readonly total: number }
export type SampleReadWorkerError = { readonly kind: "worker-error", readonly message: string }

type WorkerMessage =
    | { readonly kind: "progress", readonly id: string, readonly label: string, readonly index: number, readonly total: number }
    | { readonly kind: "result", readonly result: SampleReadResult }
    | { readonly kind: "test-error", readonly id: string, readonly label: string, readonly message: string }
    | { readonly kind: "done" }

const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

export const runSampleReadBenchmarks = async (
    onProgress: (progress: SampleReadProgress) => void,
    onResult: (result: SampleReadResult) => void,
    onWorkerError?: (error: SampleReadWorkerError) => void
): Promise<void> => {
    const total = SAMPLE_READ_TESTS.length * 2
    let step = 0
    for (const test of SAMPLE_READ_TESTS) {
        onProgress({current: `${test.label} (main)`, index: step, total})
        await yieldToEventLoop()
        const outcome = tryCatch(() => runSampleReadTest(test, "main"))
        if (outcome.status === "success") {
            onResult(outcome.value)
        } else {
            onWorkerError?.({kind: "worker-error", message: `${test.label} (main): ${errorMessage(outcome.error)}`})
        }
        step++
    }
    let worker: Worker
    try {
        worker = new SampleReadWorker()
    } catch (error: unknown) {
        const message = errorMessage(error)
        console.warn("Sample-read worker construction failed:", message)
        onWorkerError?.({kind: "worker-error", message: `worker construct: ${message}`})
        return
    }
    try {
        await new Promise<void>((resolve) => {
            worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
                const message = event.data
                if (message.kind === "progress") {
                    onProgress({
                        current: `${message.label} (worker)`,
                        index: step + message.index,
                        total
                    })
                } else if (message.kind === "result") {
                    onResult(message.result)
                } else if (message.kind === "test-error") {
                    onWorkerError?.({kind: "worker-error", message: `${message.label} (worker): ${message.message}`})
                } else if (message.kind === "done") {
                    resolve()
                }
            }
            worker.onerror = (event: ErrorEvent) => {
                event.preventDefault()
                const message = event.message || event.filename || "unknown worker error"
                console.warn("Sample-read worker error:", message)
                onWorkerError?.({kind: "worker-error", message: `worker error: ${message}`})
                resolve()
            }
            worker.onmessageerror = () => {
                onWorkerError?.({kind: "worker-error", message: "worker messageerror (structured clone failed)"})
                resolve()
            }
            try {
                worker.postMessage({kind: "run", tests: SAMPLE_READ_TESTS})
            } catch (error: unknown) {
                const message = errorMessage(error)
                onWorkerError?.({kind: "worker-error", message: `postMessage: ${message}`})
                resolve()
            }
        })
    } finally {
        worker.terminate()
    }
}
