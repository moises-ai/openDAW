import {tryCatch} from "@moises-ai/lib-std"
import {MemoryTest, runMemoryTest} from "./MemoryBenchmark"

type IncomingMessage = { readonly kind: "run", readonly tests: ReadonlyArray<MemoryTest> }

const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error)

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
    const data = event.data
    if (data.kind !== "run") {return}
    const tests = data.tests
    for (let index = 0; index < tests.length; index++) {
        const test = tests[index]
        self.postMessage({kind: "progress", id: test.id, label: test.label, index, total: tests.length})
        const outcome = tryCatch(() => runMemoryTest(test, "worker"))
        if (outcome.status === "success") {
            self.postMessage({kind: "result", result: outcome.value})
        } else {
            self.postMessage({kind: "test-error", id: test.id, label: test.label, message: errorMessage(outcome.error)})
        }
    }
    self.postMessage({kind: "done"})
}
