import css from "./SpikeTestPage.sass?inline"
import {createElement, PageFactory} from "@opendaw/lib-jsx"
import {Html} from "@opendaw/lib-dom"
import {asDefined, isDefined} from "@opendaw/lib-std"
import {Promises} from "@opendaw/lib-runtime"
import {Colors} from "@opendaw/studio-enums"
import {Button} from "@/ui/components/Button"
import {StudioService} from "@/service/StudioService"

const className = Html.adoptStyleSheet(css, "SpikeTestPage")

interface ModelCandidate {
    readonly key: string
    readonly label: string
    readonly url: string
    readonly bytes: number
    readonly sha256?: string                         // optional; only verified when present
    readonly license: string
}

const MODEL_CANDIDATES: ReadonlyArray<ModelCandidate> = [
    {
        key: "opendaw",
        label: "assets.opendaw.studio htdemucs v4 (304 MB, MIT) — DEFAULT",
        url: "https://assets.opendaw.studio/models/htdemucs/v4/model.onnx",
        bytes: 304_321_552,
        sha256: "d2b401f322558cd57d67a752ed7be3fa55178a0626011eda8ac7bb74e17280c0",
        license: "MIT"
    },
    {
        key: "smank",
        label: "smank/htdemucs-onnx via Hugging Face (304 MB, MIT) — fallback / known-good",
        url: "https://huggingface.co/smank/htdemucs-onnx/resolve/469b019bf7ac20e03dc68a8fa791323434862390/htdemucs.onnx",
        bytes: 304_321_552,
        sha256: "d2b401f322558cd57d67a752ed7be3fa55178a0626011eda8ac7bb74e17280c0",
        license: "MIT"
    },
    {
        key: "jackjiangxinfa",
        label: "jackjiangxinfa/demucs-onnx via Hugging Face (304 MB, Apache-2.0) — alternate",
        url: "https://huggingface.co/jackjiangxinfa/demucs-onnx/resolve/49fcb820b3fa39937e955dda5cef1ad35dec1f7c/model.onnx",
        bytes: 304_330_587,
        license: "Apache-2.0"
    },
    {
        key: "modernmube",
        label: "ModernMube/HTDemucs_onnx (174 MB, MIT) — KNOWN FAIL: shape mismatch",
        url: "https://huggingface.co/ModernMube/HTDemucs_onnx/resolve/edd8347a8191d6b73635675688d01e125d3ae336/htdemucs.onnx",
        bytes: 174_490_597,
        sha256: "ac056d976fbcf300dbc9e5ae6c1e7c8e7eb9a0ee9000e0449d993e3edef797d6",
        license: "MIT"
    }
]

const SAMPLE_RATE = 44100
const SEGMENT_SECONDS = 7.8
const SEGMENT_SAMPLES = Math.round(SAMPLE_RATE * SEGMENT_SECONDS)

const sha256Hex = async (bytes: Uint8Array): Promise<string> => {
    const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource)
    return Array.from(new Uint8Array(digest))
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("")
}

const buildSyntheticInput = (channels: number, samples: number): Float32Array => {
    const data = new Float32Array(channels * samples)
    for (let channel = 0; channel < channels; channel++) {
        for (let i = 0; i < samples; i++) {
            data[channel * samples + i] = 0.2 * Math.sin(2 * Math.PI * 440 * (i / SAMPLE_RATE))
        }
    }
    return data
}

const tensorStats = (data: Float32Array | Int32Array | BigInt64Array): {min: number, max: number, rms: number} => {
    if (data instanceof BigInt64Array) {
        let min = Number.POSITIVE_INFINITY
        let max = Number.NEGATIVE_INFINITY
        let sumSq = 0
        for (let i = 0; i < data.length; i++) {
            const value = Number(data[i])
            if (value < min) {min = value}
            if (value > max) {max = value}
            sumSq += value * value
        }
        return {min, max, rms: Math.sqrt(sumSq / data.length)}
    }
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let sumSq = 0
    for (let i = 0; i < data.length; i++) {
        const value = data[i]
        if (value < min) {min = value}
        if (value > max) {max = value}
        sumSq += value * value
    }
    return {min, max, rms: Math.sqrt(sumSq / data.length)}
}

type LoadedSession = {
    readonly session: import("onnxruntime-web").InferenceSession
    readonly ort: typeof import("onnxruntime-web")
    readonly cacheKey: string
}

const STEM_NAMES = ["drums", "bass", "other", "vocals"] as const
type StemName = typeof STEM_NAMES[number]

const planChunks = (length: number, windowSize: number, overlap: number):
    {starts: ReadonlyArray<number>, padded: number} => {
    if (windowSize <= overlap) {throw new Error("windowSize must exceed overlap")}
    const stride = windowSize - overlap
    if (length === 0) {return {starts: [], padded: 0}}
    const starts: Array<number> = []
    let position = 0
    while (position + windowSize <= length) {
        starts.push(position)
        position += stride
    }
    if (starts.length === 0 || starts[starts.length - 1] + windowSize < length) {
        starts.push(Math.max(0, length - windowSize))
    }
    const padded = starts[starts.length - 1] + windowSize
    return {starts, padded: Math.max(padded, length)}
}

const stitch = (
    windows: ReadonlyArray<Float32Array>,
    starts: ReadonlyArray<number>,
    windowLen: number,
    totalLength: number
): Float32Array => {
    const out = new Float32Array(totalLength)
    if (windows.length === 0) {return out}
    const last = windows.length - 1
    for (let w = 0; w < windows.length; w++) {
        const win = windows[w]
        const start = starts[w]
        const leftOverlap = w === 0 ? 0
            : Math.max(0, Math.min(windowLen, starts[w - 1] + windowLen - start))
        const rightOverlap = w === last ? 0
            : Math.max(0, Math.min(windowLen, start + windowLen - starts[w + 1]))
        for (let i = 0; i < win.length; i++) {
            const target = start + i
            if (target < 0 || target >= totalLength) {continue}
            const inLeft  = leftOverlap  > 0 && i < leftOverlap
            const inRight = rightOverlap > 0 && i >= win.length - rightOverlap
            if (inLeft) {
                const weight = i / leftOverlap
                out[target] += win[i] * weight
            } else if (inRight) {
                const offset = i - (win.length - rightOverlap)
                const weight = 1 - offset / rightOverlap
                out[target] += win[i] * weight
            } else {
                out[target] = win[i]
            }
        }
    }
    return out
}

const encodeWav16 = (planar: Float32Array, channels: number, sampleRate: number): Blob => {
    const numFrames = Math.floor(planar.length / channels)
    const dataSize = numFrames * channels * 2
    const buffer = new ArrayBuffer(44 + dataSize)
    const view = new DataView(buffer)
    let offset = 0
    const writeStr = (str: string) => {
        for (let i = 0; i < str.length; i++) {view.setUint8(offset + i, str.charCodeAt(i))}
        offset += str.length
    }
    writeStr("RIFF")
    view.setUint32(offset, 36 + dataSize, true); offset += 4
    writeStr("WAVE")
    writeStr("fmt ")
    view.setUint32(offset, 16, true); offset += 4
    view.setUint16(offset, 1, true); offset += 2
    view.setUint16(offset, channels, true); offset += 2
    view.setUint32(offset, sampleRate, true); offset += 4
    view.setUint32(offset, sampleRate * channels * 2, true); offset += 4
    view.setUint16(offset, channels * 2, true); offset += 2
    view.setUint16(offset, 16, true); offset += 2
    writeStr("data")
    view.setUint32(offset, dataSize, true); offset += 4
    for (let i = 0; i < numFrames; i++) {
        for (let c = 0; c < channels; c++) {
            const value = planar[c * numFrames + i]
            const clamped = Math.max(-1, Math.min(1, value))
            view.setInt16(offset, Math.round(clamped * 0x7fff), true)
            offset += 2
        }
    }
    return new Blob([buffer], {type: "audio/wav"})
}

let cachedSession: LoadedSession | null = null

export const SpikeTestPage: PageFactory<StudioService> = ({lifecycle}) => {
    const logEl: HTMLPreElement = <pre/> as HTMLPreElement
    const statusEl: HTMLSpanElement = <span className="status">Ready</span>
    const dlBar: HTMLProgressElement = <progress max="1" value="0"/> as HTMLProgressElement
    const dlText: HTMLSpanElement = <span className="dim">idle</span>
    const epSelect: HTMLSelectElement = (
        <select>
            <option value="webgpu">webgpu (with wasm fallback)</option>
            <option value="wasm">wasm only</option>
        </select>
    ) as HTMLSelectElement
    const modelSelect: HTMLSelectElement = (
        <select>
            {MODEL_CANDIDATES.map(model =>
                <option value={model.key}>{model.label}</option>)}
        </select>
    ) as HTMLSelectElement
    const fileInput: HTMLInputElement = <input type="file" accept="audio/*"/> as HTMLInputElement
    const sepBar: HTMLProgressElement = <progress max="1" value="0"/> as HTMLProgressElement
    const sepText: HTMLSpanElement = <span className="dim">idle</span>
    const stemsContainer: HTMLDivElement = <div className="stems"/> as HTMLDivElement
    let runButton: HTMLInputElement | null = null
    let separateButton: HTMLInputElement | null = null
    let running: boolean = false

    const ts = (): string => new Date().toISOString().split("T")[1].replace("Z", "")
    const log = (msg: string, kind?: "ok" | "bad" | "dim") => {
        const span: HTMLSpanElement = <span/>
        if (isDefined(kind)) {span.className = kind}
        span.textContent = `[${ts()}] ${msg}\n`
        logEl.appendChild(span)
        logEl.scrollTop = logEl.scrollHeight
    }
    const setRunning = (active: boolean) => {
        running = active
        if (isDefined(runButton)) {runButton.disabled = active}
        if (isDefined(separateButton)) {separateButton.disabled = active}
    }

    const downloadModel = async (model: ModelCandidate): Promise<Uint8Array> => {
        log(`Fetching model: ${model.label}`)
        log(`URL: ${model.url}`)
        const t0 = performance.now()
        const response = await fetch(model.url, {mode: "cors", credentials: "omit"})
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} ${response.statusText}`)
        }
        const total = parseInt(response.headers.get("Content-Length") ?? `${model.bytes}`)
        const reader = asDefined(response.body, "Empty response body").getReader()
        const chunks: Array<Uint8Array> = []
        let loaded = 0
        while (true) {
            const {done, value} = await reader.read()
            if (done) {break}
            chunks.push(value)
            loaded += value.length
            if (total > 0) {
                const fraction = loaded / total
                dlBar.value = fraction
                dlText.textContent = `${(fraction * 100).toFixed(1)}% (${(loaded / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`
            }
        }
        const bytes = new Uint8Array(loaded)
        let offset = 0
        for (const chunk of chunks) {
            bytes.set(chunk, offset)
            offset += chunk.length
        }
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        log(`Downloaded ${(loaded / 1e6).toFixed(1)} MB in ${elapsed}s`)
        return bytes
    }

    const verifyHash = async (bytes: Uint8Array, model: ModelCandidate): Promise<void> => {
        if (!isDefined(model.sha256)) {
            log("No SHA-256 pinned for this candidate; computing for the record...", "dim")
            const hex = await sha256Hex(bytes)
            log(`Observed SHA-256: ${hex}`, "dim")
            return
        }
        log("Verifying SHA-256...")
        const t0 = performance.now()
        const hex = await sha256Hex(bytes)
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        if (hex === model.sha256) {
            log(`SHA-256 match (${elapsed}s)`, "ok")
        } else {
            log(`SHA-256 MISMATCH: expected ${model.sha256}, got ${hex}`, "bad")
            throw new Error("SHA-256 mismatch")
        }
    }

    const createSession = async (bytes: Uint8Array,
                                  primaryEP: string,
                                  cacheKey: string): Promise<LoadedSession> => {
        if (cachedSession !== null && cachedSession.cacheKey === cacheKey) {
            log("Reusing cached session.", "ok")
            return cachedSession
        }
        log(`Importing onnxruntime-web (lazy)...`)
        const ort = await import("onnxruntime-web")
        // ORT-Web auto-resolves WASM paths relative to its own .mjs; once
        // Vite stops pre-bundling onnxruntime-web (optimizeDeps.exclude),
        // those siblings live at /node_modules/onnxruntime-web/dist/ which
        // Vite serves natively.
        log(`Creating InferenceSession (provider order: ${primaryEP}, wasm)...`)
        const t0 = performance.now()
        const providers = primaryEP === "wasm" ? ["wasm" as const] : [primaryEP as "webgpu", "wasm" as const]
        const session = await ort.InferenceSession.create(bytes, {executionProviders: providers})
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        log(`Session created in ${elapsed}s`, "ok")
        log(`  inputNames:  ${JSON.stringify(session.inputNames)}`)
        log(`  outputNames: ${JSON.stringify(session.outputNames)}`)
        const loaded: LoadedSession = {session, ort, cacheKey}
        cachedSession = loaded
        return loaded
    }

    const runInference = async (
        session: import("onnxruntime-web").InferenceSession,
        ort: typeof import("onnxruntime-web")
    ): Promise<void> => {
        const inputName = session.inputNames[0]
        const trials = [
            {channels: 2, samples: SEGMENT_SAMPLES, dims: [1, 2, SEGMENT_SAMPLES]},
            {channels: 1, samples: SEGMENT_SAMPLES, dims: [1, 1, SEGMENT_SAMPLES]}
        ]
        for (const trial of trials) {
            log(`Trying input shape ${JSON.stringify(trial.dims)} on '${inputName}'...`)
            const data = buildSyntheticInput(trial.channels, trial.samples)
            const tensor = new ort.Tensor("float32", data, trial.dims)
            const t0 = performance.now()
            const result = await Promises.tryCatch(session.run({[inputName]: tensor}))
            if (result.status === "rejected") {
                const reason = result.error
                const message = reason instanceof Error ? reason.message : String(reason)
                log(`  rejected: ${message}`, "dim")
                continue
            }
            const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
            log(`Inference completed in ${elapsed}s`, "ok")
            for (const name of session.outputNames) {
                const ortTensor = result.value[name]
                if (!isDefined(ortTensor)) {
                    log(`  output ${name}: missing`, "bad")
                    continue
                }
                const tensorData = ortTensor.data
                if (tensorData instanceof Float32Array
                    || tensorData instanceof Int32Array
                    || tensorData instanceof BigInt64Array) {
                    const stats = tensorStats(tensorData)
                    log(`  output ${name}: dims=${JSON.stringify(ortTensor.dims)} type=${ortTensor.type} `
                        + `min=${stats.min.toExponential(2)} max=${stats.max.toExponential(2)} rms=${stats.rms.toExponential(2)}`)
                } else {
                    log(`  output ${name}: dims=${JSON.stringify(ortTensor.dims)} type=${ortTensor.type} (unsupported data type for stats)`, "dim")
                }
            }
            return
        }
        throw new Error("No tested input shape was accepted by the model")
    }

    const runSpike = async () => {
        if (running) {return}
        setRunning(true)
        dlBar.value = 0
        dlText.textContent = ""
        log(`crossOriginIsolated: ${self.crossOriginIsolated}`)
        log(`hardwareConcurrency: ${navigator.hardwareConcurrency}`)
        log(`WebGPU available: ${"gpu" in navigator}`)
        const candidate = MODEL_CANDIDATES.find(model => model.key === modelSelect.value)
        if (!isDefined(candidate)) {
            log("No model selected", "bad")
            setRunning(false)
            return
        }
        const result = await Promises.tryCatch((async () => {
            const bytes = await downloadModel(candidate)
            await verifyHash(bytes, candidate)
            const {session, ort} = await createSession(bytes, epSelect.value, `${candidate.key}:${epSelect.value}`)
            await runInference(session, ort)
            log("Spike complete.", "ok")
        })())
        if (result.status === "rejected") {
            const reason = result.error
            const message = reason instanceof Error
                ? (reason.stack ?? reason.message)
                : String(reason)
            log(`FAILED: ${message}`, "bad")
        }
        setRunning(false)
    }

    const ensureSession = async (): Promise<LoadedSession> => {
        const candidate = MODEL_CANDIDATES.find(model => model.key === modelSelect.value)
        if (!isDefined(candidate)) {throw new Error("No model selected")}
        const cacheKey = `${candidate.key}:${epSelect.value}`
        if (cachedSession !== null && cachedSession.cacheKey === cacheKey) {
            return cachedSession
        }
        const bytes = await downloadModel(candidate)
        await verifyHash(bytes, candidate)
        return createSession(bytes, epSelect.value, cacheKey)
    }

    const decodeAudioFile = async (file: File): Promise<{audio: Float32Array, channels: 1 | 2, frames: number}> => {
        log(`Decoding ${file.name} (${(file.size / 1e6).toFixed(2)} MB)...`)
        const t0 = performance.now()
        const arrayBuffer = await file.arrayBuffer()
        const ctx = new AudioContext({sampleRate: SAMPLE_RATE})
        const decoded = await ctx.decodeAudioData(arrayBuffer)
        await ctx.close()
        const channels: 1 | 2 = decoded.numberOfChannels >= 2 ? 2 : 1
        const frames = decoded.length
        const planar = new Float32Array(channels * frames)
        for (let c = 0; c < channels; c++) {
            const sourceChannel = decoded.numberOfChannels >= 2 ? decoded.getChannelData(c) : decoded.getChannelData(0)
            planar.set(sourceChannel, c * frames)
        }
        const elapsed = ((performance.now() - t0) / 1000).toFixed(2)
        log(`Decoded ${(frames / SAMPLE_RATE).toFixed(2)}s of ${channels === 2 ? "stereo" : "mono"} audio in ${elapsed}s`)
        if (decoded.sampleRate !== SAMPLE_RATE) {
            log(`(Resampled from ${decoded.sampleRate} Hz to ${SAMPLE_RATE} Hz by AudioContext)`, "dim")
        }
        return {audio: planar, channels, frames}
    }

    const extractWindow = (planar: Float32Array, channels: number, frames: number, start: number, windowLen: number): Float32Array => {
        const out = new Float32Array(channels * windowLen)
        for (let c = 0; c < channels; c++) {
            for (let i = 0; i < windowLen; i++) {
                const sourceIndex = start + i
                out[c * windowLen + i] = sourceIndex < frames ? planar[c * frames + sourceIndex] : 0
            }
        }
        return out
    }

    const collectStemWindow = (
        result: import("onnxruntime-web").InferenceSession.OnnxValueMapType,
        outputNames: ReadonlyArray<string>,
        windowLen: number,
        channels: number
    ): Record<StemName, Float32Array> => {
        const stems: Record<string, Float32Array> = {}
        if (outputNames.length === 1) {
            // Single tensor [1, 4, channels, samples] (or [1, channels, 4, samples])
            const tensor = result[outputNames[0]]
            const data = tensor.data as Float32Array
            const dims = tensor.dims
            // Try to find the stem axis (size 4) and channel axis (size 1 or 2)
            const stemAxisLen = dims[1] === 4 ? 4 : (dims[2] === 4 ? 4 : -1)
            if (stemAxisLen !== 4) {
                throw new Error(`Cannot interpret single output of shape ${JSON.stringify(dims)}`)
            }
            const stride = data.length / 4
            for (let s = 0; s < 4; s++) {
                stems[STEM_NAMES[s]] = data.slice(s * stride, (s + 1) * stride)
            }
        } else {
            // Multiple outputs, one per stem
            for (let s = 0; s < Math.min(STEM_NAMES.length, outputNames.length); s++) {
                const tensor = result[outputNames[s]]
                stems[STEM_NAMES[s]] = (tensor.data as Float32Array).slice()
            }
        }
        // Sanity: each stem should have channels*windowLen samples
        for (const name of Object.keys(stems)) {
            if (stems[name].length !== channels * windowLen) {
                log(`  warning: stem "${name}" has ${stems[name].length} samples, expected ${channels * windowLen}`, "dim")
            }
        }
        return stems as Record<StemName, Float32Array>
    }

    const renderStems = (stems: Record<StemName, Float32Array>, channels: number, frames: number) => {
        Html.empty(stemsContainer)
        for (const name of STEM_NAMES) {
            const data = stems[name]
            if (!isDefined(data)) {continue}
            const blob = encodeWav16(data.slice(0, channels * frames), channels, SAMPLE_RATE)
            const url = URL.createObjectURL(blob)
            const downloadLink: HTMLAnchorElement = (
                <a href={url} download={`stem-${name}.wav`}>download</a>
            ) as HTMLAnchorElement
            const player = document.createElement("audio")
            player.controls = true
            player.src = url
            stemsContainer.appendChild(
                <div className="stem">
                    <span className="stem-name">{name}</span>
                    {player}
                    {downloadLink}
                </div>
            )
        }
    }

    const separateFile = async () => {
        if (running) {return}
        const file = fileInput.files?.[0]
        if (!isDefined(file)) {
            log("No file selected.", "bad")
            return
        }
        setRunning(true)
        const result = await Promises.tryCatch((async () => {
            const {session, ort} = await ensureSession()
            const {audio, channels, frames} = await decodeAudioFile(file)
            const inputName = session.inputNames[0]
            const plan = planChunks(frames, SEGMENT_SAMPLES, Math.round(0.25 * SAMPLE_RATE))
            log(`Planning ${plan.starts.length} chunk(s) of ${SEGMENT_SAMPLES} samples (${SEGMENT_SECONDS.toFixed(2)} s) with overlap.`)
            const stemWindows: Record<StemName, Array<Float32Array>> = {drums: [], bass: [], other: [], vocals: []}
            const tInfStart = performance.now()
            sepBar.value = 0
            sepText.textContent = `0/${plan.starts.length} chunks`
            for (let i = 0; i < plan.starts.length; i++) {
                const start = plan.starts[i]
                log(`  chunk ${i + 1}/${plan.starts.length} at ${(start / SAMPLE_RATE).toFixed(2)}s...`)
                const chunkData = extractWindow(audio, channels, frames, start, SEGMENT_SAMPLES)
                const tensor = new ort.Tensor("float32", chunkData, [1, channels, SEGMENT_SAMPLES])
                const tChunk = performance.now()
                const output = await session.run({[inputName]: tensor})
                log(`    ${((performance.now() - tChunk) / 1000).toFixed(2)}s`, "dim")
                const stems = collectStemWindow(output, session.outputNames, SEGMENT_SAMPLES, channels)
                for (const name of STEM_NAMES) {
                    stemWindows[name].push(stems[name])
                }
                const fraction = (i + 1) / plan.starts.length
                sepBar.value = fraction
                sepText.textContent = `${i + 1}/${plan.starts.length} chunks (${(fraction * 100).toFixed(0)}%)`
            }
            const totalInf = ((performance.now() - tInfStart) / 1000).toFixed(2)
            log(`All ${plan.starts.length} chunk(s) inferred in ${totalInf}s.`, "ok")
            const stitched: Record<StemName, Float32Array> = {} as Record<StemName, Float32Array>
            for (const name of STEM_NAMES) {
                // Each window is planar [channels * SEGMENT_SAMPLES]; stitch per channel then re-pack.
                const windowsPerChannel: Array<Array<Float32Array>> = []
                for (let c = 0; c < channels; c++) {windowsPerChannel.push([])}
                for (const win of stemWindows[name]) {
                    for (let c = 0; c < channels; c++) {
                        windowsPerChannel[c].push(win.subarray(c * SEGMENT_SAMPLES, (c + 1) * SEGMENT_SAMPLES))
                    }
                }
                const stitchedPerChannel = windowsPerChannel.map(perChannel =>
                    stitch(perChannel, plan.starts, SEGMENT_SAMPLES, frames))
                const merged = new Float32Array(channels * frames)
                for (let c = 0; c < channels; c++) {
                    merged.set(stitchedPerChannel[c], c * frames)
                }
                stitched[name] = merged
            }
            log("Stitched. Encoding to WAV and rendering players...", "ok")
            renderStems(stitched, channels, frames)
            log("Done. Use the audio controls below.", "ok")
        })())
        if (result.status === "rejected") {
            const reason = result.error
            const message = reason instanceof Error
                ? (reason.stack ?? reason.message)
                : String(reason)
            log(`FAILED: ${message}`, "bad")
        }
        setRunning(false)
    }

    log("Ready. Click \"Run spike\" to begin.")

    return (
        <div className={className}>
            <h1>Inference Spike: htdemucs in onnxruntime-web</h1>
            <div className="description">
                <span>Smoke-tests whether a given <code>htdemucs.onnx</code> export loads and runs in
                    <code> onnxruntime-web</code>. Input is a synthetic 7.8 s sine wave at 44.1 kHz; the
                    goal is to confirm the session accepts it, the inference completes, and the output
                    tensors have plausible shapes for a 4-stem split.</span>
                <span>The default candidate is the openDAW-hosted copy (assets.opendaw.studio). The
                    Hugging Face fallbacks are kept around so the spike still functions if the openDAW
                    CDN is unreachable, and so the original "known fail" export remains documented as
                    a regression test for ORT-Web's strict shape validator.</span>
            </div>
            <div className="controls">
                <label>Model: {modelSelect}</label>
            </div>
            <div className="controls">
                <label>Execution provider: {epSelect}</label>
                <Button lifecycle={lifecycle}
                        appearance={{framed: true, color: Colors.blue}}
                        style={{fontSize: "0.85em"}}
                        onInit={el => {runButton = el as HTMLInputElement}}
                        onClick={runSpike}>Run spike</Button>
                {statusEl}
            </div>
            <div>
                Download:&nbsp;{dlBar}&nbsp;{dlText}
            </div>
            <h1 style={{marginTop: "16px"}}>Separate stems from a real audio file</h1>
            <div className="description">
                <span>Pick any audio file the browser can decode (mp3, wav, flac, m4a, ogg). The session loaded
                    above is reused. Audio is resampled to 44.1 kHz, chunked into 7.8 s windows with 0.25 s
                    overlap, run through the model, and the per-stem outputs are stitched with crossfade.</span>
                <span>For a 3-minute song expect ~25 chunks. Each chunk takes a few seconds on WebGPU; total
                    runtime scales linearly with file length.</span>
            </div>
            <div className="controls">
                {fileInput}
                <Button lifecycle={lifecycle}
                        appearance={{framed: true, color: Colors.green}}
                        style={{fontSize: "0.85em"}}
                        onInit={el => {separateButton = el as HTMLInputElement}}
                        onClick={separateFile}>Separate stems</Button>
            </div>
            <div>
                Separation:&nbsp;{sepBar}&nbsp;{sepText}
            </div>
            {stemsContainer}
            {logEl}
        </div>
    )
}
