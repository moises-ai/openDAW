import {BoxGraph, PointerField} from "@moises-ai/lib-box"
import {BoxIO, SelectionBox} from "@moises-ai/studio-boxes"

export const migrateSelectionBox = (boxGraph: BoxGraph<BoxIO.TypeMap>, box: SelectionBox): void => {
    const isInvalid = (pointer: PointerField): boolean =>
        pointer.targetAddress.match({
            none: () => true,
            some: address => boxGraph.findVertex(address).isEmpty()
        })
    if (isInvalid(box.selectable) || isInvalid(box.selection)) {
        console.debug("Migrate remove broken 'SelectionBox'")
        boxGraph.beginTransaction()
        box.delete()
        boxGraph.endTransaction()
    }
}
