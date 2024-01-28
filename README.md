# Desmos to 3D Model

Export graphs created in [Desmos 3D Graphing Calculator](https://www.desmos.com/3d) to 3D models in formats like GLTF, OBJ, and STL that can be used for animation (eg. in Blender) and 3D printing.

![](screenshot-3d.jpg)

## How to use

- Open a 3D Desmos graph
- Zoom / Resize window for desired shape and point/line size/thickness
- Paste `main-3d.js` into F12 JS console
- Follow the prompt to download model
- You can change the 3D model format by changing `download(GLB|OBJ|STL)()` at the end of the script

## To-do

- Support domain restriction `[expression] {x > #}`
- Vertex color for small objects
- Test on more graphs
- Fix script when Desmos update breaks it

## How it works

Thanks user `ronwnor` on Unofficial Desmos Discord server for pointing out `Calc.controller.grapher3d.webglLayer.surfaces` in Desmos 3D graphing calculator. Prior to this, the script `main-3d-webgl.js` creates a wrapper for WebGL that logs 3D model information like geometry and color.
