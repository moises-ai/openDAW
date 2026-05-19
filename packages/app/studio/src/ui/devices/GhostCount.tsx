import css from "./GhostCount.sass?inline"
import {Color} from "@moises-ai/lib-std"
import {createElement} from "@moises-ai/lib-jsx"
import {Html} from "@moises-ai/lib-dom"

const className = Html.adoptStyleSheet(css, "GhostCount")

type Construct = {
    count: number
    color: Color
}

export const GhostCount = ({count, color}: Construct): HTMLElement => (
    <div className={className}>
        <div className="badge" style={{backgroundColor: color.toString()}}>{count}</div>
    </div>
)
