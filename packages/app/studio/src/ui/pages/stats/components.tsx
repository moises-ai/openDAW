import {createElement, JsxValue} from "@moises-ai/lib-jsx"
import {isDefined} from "@moises-ai/lib-std"

type CardProps = {
    title?: string
    accent?: JsxValue
    className?: string
}

export const Card = ({title, accent, className}: CardProps, children: ReadonlyArray<JsxValue>) => (
    <div className={`card${isDefined(className) ? ` ${className}` : ""}`}>
        {(isDefined(title) || isDefined(accent)) && (
            <div className="card-head">
                {isDefined(title) && <h2>{title}</h2>}
                {isDefined(accent) && <div className="card-accent">{accent}</div>}
            </div>
        )}
        <div className="card-body">{children}</div>
    </div>
)
