# TODO list

## Features

- General map
  - Switch to 3D cause camera to be underground and then jump to random location. Move
    camera to required height before mode map mode switch

- Improve browser satellite render fallback
  - Try to find alternative/better datasource to avoid browser render
  - Remove timeout completly
  - Improve error message
  - Add progress/queue bar
  - Sometimes it makes whole map blank
  - Satelite image change should unload current image right away even after render swap

- URL sharing & state saving
  - Disable persistent 3D mode
  - Share only 2D as regular link
  - For 3D mode share give another option in right click menu with camera position as
    url param
  - Satellite iamge sharing shares wrong image
  - Do not persist satellite in localstorage, only as url sharing param
  - Shared satellite should open datallite pane with scene card right away

- GPX upload
  - Attach GPX track names to search

- Simple markers
  - Attach markers to search

- Calendar
  - Spinner causes text shift
  - Allow month switch during load
  - Add small pause after month switch before loading ssatellites meta data

## Other

- Run full code review
- Try to run agent to compact code and reduce slop
