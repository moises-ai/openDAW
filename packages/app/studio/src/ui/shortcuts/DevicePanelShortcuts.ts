import {Key, Shortcut, ShortcutDefinitions, ShortcutValidator} from "@opendaw/lib-dom"

export const DevicePanelShortcutsFactory = ShortcutValidator.validate({
    "delete-audio-unit": {
        shortcut: Shortcut.of(Key.DeleteAction),
        description: "Delete the focused audio unit (instrument + its effect chain)"
    }
})

export const DevicePanelShortcuts = ShortcutDefinitions.copy(DevicePanelShortcutsFactory)