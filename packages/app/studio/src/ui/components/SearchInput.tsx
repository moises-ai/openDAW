import css from "./SearchInput.sass?inline"
import {Lifecycle, MutableObservableValue} from "@moises-ai/lib-std"
import {Html} from "@moises-ai/lib-dom"
import {createElement} from "@moises-ai/lib-jsx"
import {Icon} from "@/ui/components/Icon"
import {IconSymbol} from "@moises-ai/studio-enums"

const className = Html.adoptStyleSheet(css, "SearchInput")

type Construct = {
    lifecycle: Lifecycle
    model: MutableObservableValue<string>
    placeholder?: string
    style?: Partial<CSSStyleDeclaration>
}

export const SearchInput = ({lifecycle, model, placeholder, style}: Construct) => {
    const input: HTMLInputElement = (
        <input type="search"
               value={model.getValue()}
               placeholder={placeholder}
               oninput={(event) => {
                   if (event.target instanceof HTMLInputElement) {
                       model.setValue(event.target.value)
                   }
               }}
               onConnect={element => {
                   // Intentionally NOT auto-focusing on mount: when the
                   // browser panel becomes visible, grabbing focus prevents
                   // Space from triggering transport play/pause until the
                   // user clicks somewhere else. Callers that need the
                   // input focused can call `element.focus()` on the
                   // returned wrapper.
                   lifecycle.own(model.subscribe(owner => element.value = owner.getValue()))
               }}/>
    )
    const element: HTMLElement = (
        <div className={className} style={style}>
            <Icon symbol={IconSymbol.Search}/>
            {input}
        </div>
    )
    element.focus = () => {
        input.blur()
        input.focus()
    }
    return element
}