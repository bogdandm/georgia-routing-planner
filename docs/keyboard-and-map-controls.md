# Keyboard shortcuts and map controls

This document describes how the workspace is driven from the keyboard, the mouse, and
touch: the global keyboard shortcuts and the map's own camera controls. The
[features](./features.md) document owns what each feature does once it is open.

## Keyboard shortcuts

Shortcuts match the physical key position of a US keyboard, so they work in every
keyboard layout, including Russian, and with Option-modified characters on macOS. The
command modifier is Cmd on macOS and Ctrl on Windows and Linux; the other key of that
pair must not be held. Ctrl+F, Ctrl+E, and Ctrl+O stay text-editing keys on macOS.

| Windows and Linux | macOS           | Action                                                                                                                                                                             | Does nothing when                                                          |
| ----------------- | --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Ctrl+F, `/`       | ⌘F, `/`         | Focuses and selects the map search; on phones the open workspace closes first                                                                                                      | Focus is already in the map search, so the browser's own find opens        |
| `[`               | `[`             | Collapses or expands the desktop navigation, or opens or closes the phone workspace                                                                                                | —                                                                          |
| `T`               | `T`             | Opens Tracks and starts **Plan route**                                                                                                                                             | Map routing data is not configured                                         |
| `P`               | `P`             | Opens Markers and starts placing a new marker, like **New marker**                                                                                                                 | The map or the saved markers are not ready                                 |
| `W`               | `W`             | Opens Weather and starts or cancels forecast-point selection                                                                                                                       | —                                                                          |
| `S`               | `S`             | Leaves Mosaic, searches Sentinel scenes at the current viewport center, and opens Satellite                                                                                        | —                                                                          |
| `M`               | `M`             | Fits the camera to the open track, the multi-track selection, or the route or edit draft                                                                                           | Nothing is open                                                            |
| `N`               | `N`             | Turns the map north; 2D also resets the pitch, 3D keeps the 45° pitch of a track fit                                                                                               | —                                                                          |
| `O`               | `O`             | Switches between 2D and 3D                                                                                                                                                         | Terrain is changing, the map is loading, or Mosaic blocks 3D               |
| `R`               | `R`             | Turns the ruler on or off                                                                                                                                                          | —                                                                          |
| `L`, Home         | `L`, Home       | Finds my location                                                                                                                                                                  | —                                                                          |
| `1`–`6`           | `1`–`6`         | Vector OSM, Google Satellite, Bing Aerial, Esri World Imagery, NAPR Orthophoto, Soviet Topographic                                                                                 | The map layers are not ready                                               |
| `7`               | `7`             | Shows Sentinel-2                                                                                                                                                                   | No scene or mosaic is loaded; it never opens Satellite                     |
| `8`               | `8`             | Turns the OSM overlay on or off                                                                                                                                                    | The overlay is unavailable, as on Vector OSM                               |
| `0`               | `0`             | Next basemap of `1`–`6`, wrapping around                                                                                                                                           | The map layers are not ready                                               |
| Shift+`0`         | ⇧`0`            | Previous basemap of `1`–`6`, wrapping around                                                                                                                                       | The map layers are not ready                                               |
| Ctrl+Z            | ⌘Z              | Undoes the last route-plan or track edit                                                                                                                                           | No path is being edited                                                    |
| Ctrl+S            | ⌘S              | Saves the route plan, the import preview or shared track, or the saved-track edit; never the browser's **Save page**                                                               | Nothing can be saved                                                       |
| Ctrl+O            | ⌘O              | Opens the track file picker                                                                                                                                                        | —                                                                          |
| Ctrl+E            | ⌘E              | Downloads the open saved track as GPX                                                                                                                                              | No saved track is open, or it is being edited                              |
| Ctrl+C            | ⌘C              | Copies a link to the current map view with the stored **Share** choices, without opening the dialog, and shows the copied link in a short notice                                   | Focus is in a text field or page text is selected, so the native copy runs |
| ←, ↑, →, ↓        | ←, ↑, →, ↓      | Pans the map by 100 pixels                                                                                                                                                         | —                                                                          |
| Shift+←, Shift+→  | ⇧←, ⇧→          | Rotates the map by 15 degrees                                                                                                                                                      | —                                                                          |
| Shift+↑, Shift+↓  | ⇧↑, ⇧↓          | Pitches the map by 10 degrees, up to 75 degrees                                                                                                                                    | —                                                                          |
| `+` or `=`, `-`   | `+` or `=`, `-` | Zooms in or out by one level; Shift does not change the step                                                                                                                       | —                                                                          |
| Escape            | Escape          | Cancels marker placement and forecast-point selection, ends the ruler, and ends point insertion or a point move; in the map search, also moves focus out of it and keeps the query | —                                                                          |

Shortcuts are inactive while focus is in a text field, except Ctrl/⌘+F, S, O, and E, and
inside a modal dialog, including the onboarding tour. Inside menus and listboxes, plain
and Shift shortcuts are inactive so type-to-select and arrow navigation keep working,
while Ctrl/⌘ shortcuts still work. The map-layer chooser is the exception: the digit
keys keep switching layers while it has focus. Controls that handle a key themselves,
such as tabs with their arrows, keep it. Everywhere else the camera keys move the map
wherever focus is, so the arrows do not scroll a focused panel. Map shortcuts are
inactive while the map is hidden behind the phone workspace or the desktop comparison
grid. Auto-repeated keys are ignored, except the camera keys, which keep moving the map
while held. Ctrl/⌘+S never opens the browser's **Save page**, even where shortcuts are
inactive.

Buttons with a shortcut show its keys as keycaps in their tooltip: 2D and 3D, the layer
chooser, the ruler, **Plan route**, **New marker**, forecast-point selection, **Undo**,
**Save** and **Save a copy**, **Browse track file**, **Download GPX**, and the
navigation collapse and restore buttons. MapLibre's own zoom, compass, and **Find my
location** buttons use the same tooltip instead of the browser's, with `+`, `−`, N, and
L. Every tooltip of the map control column opens to the left of its button, vertically
centered on it. The layer-chooser menu shows each row's key in one column at its right
edge, and the empty map search shows Ctrl/⌘+F. The map's right-click menu hints
Ctrl/⌘+C, P, S, and W beside **Copy link**, **Create marker here**, **Search satellite
scenes here**, and **Show weather forecast**; these are reminders of the related global
shortcuts, which act on the current view, through the next map click, or at the map
center, not keys of the menu. Devices whose primary pointer is coarse, such as phones
and tablets, usually have no keyboard and show no keycaps. The
[help screen](./features.md#help-screen) lists every shortcut with its keys.

## Map controls

### Mouse

Left drag pans, with an inertia that covers MapLibre's default distance in half its
time. Middle drag or Shift+left drag rotates and pitches in 3D around the terrain point
under the press, marked by a small pivot ring. Ctrl+left drag in 3D turns and tilts the
view in place, like looking around from the camera position, which stays fixed; the view
follows the drag, keeping a point grabbed near the screen center roughly under the
pointer, so dragging right turns left and dragging down raises the view toward the
horizon. Middle, Shift, and Ctrl drags released while still moving coast on briefly with
fading speed; the next press or wheel stops the coast. The wheel zooms. Box zoom and
right drag are off; pitch is capped at 75 degrees.

Right-click opens the point actions described in
[persistent map controls](./features.md#persistent-map-controls).

### Touch

Two fingers pinch-zoom, twist to rotate, and drag vertically to pitch. Rotation starts
only after a twist of at least 15 degrees that clearly outweighs the pinch and drag; a
pinch or drag that wins first never rotates until the fingers lift. A tap opens the
point details and actions in a bottom sheet.

### Comparison panes

The desktop comparison grid keeps MapLibre's own keys, which work only after a pane is
clicked: the arrows pan by 100 pixels and `+` or `=` and `-` zoom, by one level or two
with Shift. The panes never rotate or pitch.

### Control column

The right edge of the map stacks zoom in and zoom out; the compass, which shows the
bearing and pitch and resets north on click; **Find my location**; the 2D and 3D switch,
where 2D also resets pitch and bearing; the map-layer chooser; on desktop, the image
comparison; and the ruler.
