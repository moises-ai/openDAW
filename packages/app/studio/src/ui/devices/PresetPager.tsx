import css from "./PresetPager.sass?inline"
import {createElement} from "@moises-ai/lib-jsx"
import {Events, Html} from "@moises-ai/lib-dom"
import {IconSymbol} from "@moises-ai/studio-enums"
import {Icon} from "@/ui/components/Icon.tsx"
import {Lifecycle, ObservableValue, Procedure} from "@moises-ai/lib-std"
import {TextTooltip} from "@/ui/surface/TextTooltip"

const className = Html.adoptStyleSheet(css, "PresetPager")

type Construct = {
    lifecycle: Lifecycle
    visible: ObservableValue<boolean>
    onPresetNavigate: Procedure<-1 | 1>
}

export const PresetPager = ({lifecycle, visible, onPresetNavigate}: Construct) => {
    const attachHandler = (element: Element, delta: -1 | 1) => {
        lifecycle.ownAll(
            Events.subscribe(element, "pointerdown", event => {
                event.preventDefault()
                event.stopPropagation()
            }),
            Events.subscribe(element, "click", event => {
                event.preventDefault()
                onPresetNavigate(delta)
            }),
            TextTooltip.default(element, () => "Navigate presets")
        )
    }
    return (
        <div className={className} onInit={element => {
            const apply = () => element.classList.toggle("hidden", !visible.getValue())
            apply()
            lifecycle.own(visible.subscribe(apply))
        }}>
            <Icon symbol={IconSymbol.SelectUp}
                  onInit={element => attachHandler(element, -1)}
            />
            <Icon symbol={IconSymbol.SelectDown}
                  onInit={element => attachHandler(element, 1)}/>
        </div>
    )
}
