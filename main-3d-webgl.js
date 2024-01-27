/*

## How to use

- Open a 3D Desmos graph
- Turn off slider and ticker animation
- Zoom / Resize window for desired shape and line thickness
- Copy the content of `main-3d.js` and paste into browser JS console
- Once the model re-loads fully, without changing graph viewport, call a function like `downloadGLB()`, `downloadOBJ()`, or `downloadSTL()` to prompt download the 3D model
- Refresh window before viewing/downloading a new graph

## Limitations / To-do

- Support exporting points, spheres, and ellipsoids (which are rendered separately in Desmos)
- Clip mesh parts outside view box (Desmos clips using shader tricks)
- Fix occassional lag/crash
- Fix script when Desmos update breaks it

*/

"use strict";


/******** WebGL Wrapper ********/

// https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/Constants
const GL_CONSTANTS = {
    0x0000: "POINTS", 0x0001: "LINES", 0x0002: "LINE_LOOP", 0x0003: "LINE_STRIP", 0x0004: "TRIANGLES", 0x0005: "TRIANGLE_STRIP", 0x0006: "TRIANGLE_FAN",
    0x88E4: "STATIC_DRAW", 0x88E0: "STREAM_DRAW", 0x88E8: "DYNAMIC_DRAW", 0x8892: "ARRAY_BUFFER", 0x8893: "ELEMENT_ARRAY_BUFFER", 0x8764: "BUFFER_SIZE", 0x8765: "BUFFER_USAGE",
    0x1400: "BYTE", 0x1401: "UNSIGNED_BYTE", 0x1402: "SHORT", 0x1403: "UNSIGNED_SHORT", 0x1404: "INT", 0x1405: "UNSIGNED_INT", 0x1406: "FLOAT",
    0x1902: "DEPTH_COMPONENT", 0x1906: "ALPHA", 0x1907: "RGB", 0x1908: "RGBA", 0x1909: "LUMINANCE", 0x190A: "LUMINANCE_ALPHA",
    0x8B30: "FRAGMENT_SHADER", 0x8B31: "VERTEX_SHADER", 0x8B81: "COMPILE_STATUS", 0x8B82: "LINK_STATUS",
    0x8D40: "FRAMEBUFFER", 0x8D41: "RENDERBUFFER", 0x0C02: "READ_BUFFER", 0x8CA6: "DRAW_FRAMEBUFFER_BINDING", 0x8CA8: "READ_FRAMEBUFFER", 0x8CA9: "DRAW_FRAMEBUFFER", 0x8CAA: "READ_FRAMEBUFFER_BINDING",
};

// https://www.khronos.org/files/webgl20-reference-guide.pdf

if (typeof WebGL2WrapperOriginal === 'undefined')
    window.WebGL2WrapperOriginal = {};

function WebGL2Wrapper(name, handler) {
    if (!WebGL2WrapperOriginal.hasOwnProperty(name))
        WebGL2WrapperOriginal[name] = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function () {
        var returnValue = WebGL2WrapperOriginal[name].apply(this, arguments);
        try {
            handler(returnValue, ...arguments);
        }
        catch(e) {
            console.error(e);
        }
        return returnValue;
    }
}

var ShaderSources = {};
let AttributeLocations = {
    0: { name: "position", buffer_id: -1 },
    1: { name: "normal", buffer_id: -1 },
    2: { name: "uv", buffer_id: -1 }
};
let UniformLocations = [];
let Buffers = [];
var activeBuffer = -1;
let Framebuffers = [];
var activeFramebuffer = -1;
var activeColor = [1, 1, 1, 1];
var activeRoughness = 1.0;

WebGL2Wrapper('shaderSource', (_, shader, source) => {
    if (ShaderSources.hasOwnProperty(source))
        ShaderSources[source] += 1;
    else ShaderSources[source] = 1;
    console.log(source);
});

WebGL2Wrapper('clearColor', (_, c0, c1, c2, c3) => {
    console.log('clearColor', c0, c1, c2, c3);
});
WebGL2Wrapper('clearDepth', (_, c0, c1, c2, c3) => {
    console.log('clearDepth', c0, c1, c2, c3);
});
WebGL2Wrapper('clear', (_, x) => {
    console.log('clear', '0x'+x.toString(16));
});

WebGL2Wrapper('useProgram', (_, program) => {
    console.log('useProgram', program);
});
WebGL2Wrapper('getAttribLocation', (location, program, name) => {
    console.log('getAttribLocation', program, name, '->', location);
    if (location)
        AttributeLocations[location] = { name: name, buffer_id: -1 };
});
WebGL2Wrapper('getUniform', (result, program, location) => {
    console.log('getUniform', program, location, '->', result);
});
WebGL2Wrapper('getUniformLocation', (location, program, name) => {
    console.log('getUniformLocation', program, name, '->', location);
    if (location) {
        location.id = UniformLocations.length;
        location.name = name;
        UniformLocations.push(location);
    }
});
WebGL2Wrapper('uniform4fv', (_, location, value) => {
    console.log('uniform4fv', location, value);
    // if (location.name == "pickingColor")
    //     activeColor = value;
});
WebGL2Wrapper('uniform4f', (_, location, v0, v1, v2, v3) => {
    console.log('uniform4f', location, v0, v1, v2, v3);
});
WebGL2Wrapper('uniform3fv', (_, location, value) => {
    console.log('uniform3fv', location, value);
});
WebGL2Wrapper('uniform3f', (_, location, v0, v1, v2) => {
    console.log('uniform3f', location, v0, v1, v2);
    if (location && location.name == "diffuse")
        activeColor = [v0, v1, v2, 1.0];
});
WebGL2Wrapper('uniform1f', (_, location, v0) => {
    console.log('uniform1f', location, v0);
    if (location && location.name == "roughness")
        activeRoughness = v0;
});

WebGL2Wrapper('createBuffer', (buffer) => {
    buffer.id = Buffers.length;
    Buffers.push({ buffer: buffer, data: null, size: -1 });
    console.log('createBuffer', '->', buffer);
});
WebGL2Wrapper('bindBuffer', (_, target, buffer) => {
    console.log('bindBuffer', GL_CONSTANTS[target], buffer);
    activeBuffer = buffer.id;
});
WebGL2Wrapper('bufferData', (_, target, data) => {
    console.log('bufferData', GL_CONSTANTS[target], data);
    Buffers[activeBuffer].data = data;
});
WebGL2Wrapper('vertexAttribPointer', (_, index, size, type, normalized, stride, offset) => {
    console.log('vertexAttribPointer',
        AttributeLocations[index],
        size, GL_CONSTANTS[type], normalized, stride, offset);
    if (Buffers[activeBuffer])
        Buffers[activeBuffer].size = size;
    if (AttributeLocations[index])
        AttributeLocations[index].buffer_id = activeBuffer;
});

WebGL2Wrapper('createFramebuffer', (framebuffer) => {
    framebuffer.id = Framebuffers.length;
    Framebuffers.push(framebuffer);
    console.log('createFramebuffer', '->', framebuffer);
});
WebGL2Wrapper('bindFramebuffer', (_, target, framebuffer) => {
    console.log('bindFramebuffer', GL_CONSTANTS[target], framebuffer);
    activeFramebuffer = framebuffer ? framebuffer.id : null;
});
WebGL2Wrapper('drawArrays', (_, mode, first, count) => {
    console.log('drawArrays', GL_CONSTANTS[mode], first, count);
});
WebGL2Wrapper('drawArraysInstanced', (_, mode, first, count) => {
    console.log('drawArraysInstanced', GL_CONSTANTS[mode], first, count);
});
WebGL2Wrapper('drawElements', (_, mode, count, type, offset) => {
    console.log('drawElements', GL_CONSTANTS[mode], count, GL_CONSTANTS[type], offset);
    if (GL_CONSTANTS[mode] == "TRIANGLES") {
        addModel();
    }
});
WebGL2Wrapper('drawElementsInstanced', (_, mode, count, type, offset) => {
    console.log('drawElementsInstanced', GL_CONSTANTS[mode], count, GL_CONSTANTS[type], offset);
});


/******** Model Exporter ********/

let Models = [];
let ModelHashes = {
    '8dc5ad4b70fbe090': -1,  // axis arrow
    'd9ec0e5061527878': -1,  // axis rod
    '463c904c2f580180': -1,  // point, sphere, ellipsoid
};

function hashArray(array) {
    // used to check duplicate objects
    // double max 2^53, 32 bit hash, ideally 77k values required for 50% hash collision
    // use both position and indices to produce 64 bit hash, collision less likely 
    var mod = Math.pow(2, 32);
    var hash = array.length;
    for (var i = 0; i < array.length; i++) {
        var x = Math.round(array[i] * 65536) % mod;
        if (x < 0) x += mod;
        hash = (hash * 31 + x) % mod;
    }
    return hash.toString(16).padStart(8, '0');
}

function addModel() {

    // retrieve model
    var model = {
        color: activeColor,
        roughness: activeRoughness,
        position: null,
        normal: null,
        indices: null
    };
    for (var key in AttributeLocations) {
        var attrib = AttributeLocations[key];
        if (model.hasOwnProperty(attrib.name) &&
                Buffers[attrib.buffer_id]) {
            model[attrib.name] = Buffers[attrib.buffer_id].data;
        }
    }
    if (Buffers[activeBuffer])
        model.indices = Buffers[activeBuffer].data;

    // sanity check
    if (!model.position)
        return console.log("Model has no position");
    if (!model.normal)
        return console.log("Model has no normal");
    if (!model.indices)
        return console.log("Model has no indices");
    var n = model.position.length;
    var m = model.indices.length;
    if (model.normal && model.normal.length != n)
        return console.log("Different position and normal buffer length");
    if (n % 3 != 0)
        return console.log("Position buffer length not multiple of 3 ("+n+")");
    if (m % 3 != 0)
        return console.log("Indice length not multiple of 3 ("+m+")");
    var hash = hashArray(model.position) + hashArray(model.indices);
    if (ModelHashes.hasOwnProperty(hash))
        return console.log("Model already added");
    var used = new Uint8Array(n/3).fill(0);
    for (var i = 0; i < m; i++) {
        if (model.indices[i] != Math.round(model.indices[i]))
            return console.log("Indice is not integer.");
        if (model.indices[i] >= n/3)
            return console.log("Indice overflow.");
        used[model.indices[i]] = 1;
    }
    var usedCount = 0;
    for (var i = 0; i < n/3; i++)
        usedCount += used[i];
    console.log("Valid model - "+(usedCount/(n/3)*100).toFixed(6)+"% indices used.");

    // add model
    ModelHashes[hash] = Models.length;
    Models.push(model);
}

function concatComponents(components) {
    // thanks ChatGPT
    let byteLength = 0;

    // Calculate the total byte length
    for (const component of components) {
        if (typeof component === 'string') {
            byteLength += new TextEncoder().encode(component).length;
        } else if (typeof component === 'number') {
            byteLength += 4; // Assuming 32-bit integers
        } else if (component instanceof ArrayBuffer || ArrayBuffer.isView(component)) {
            byteLength += component.byteLength;
        } else {
            throw new Error('Unsupported component type');
        }
    }

    // Create a Uint8Array with the calculated byte length
    const resultArray = new Uint8Array(byteLength);
    let offset = 0;

    // Concatenate components into the resultArray
    for (const component of components) {
        if (typeof component === 'string') {
            const encodedString = new TextEncoder().encode(component);
            resultArray.set(encodedString, offset);
            offset += encodedString.length;
        } else if (typeof component === 'number') {
            const intArray = new Uint32Array([component]);
            resultArray.set(new Uint8Array(intArray.buffer), offset);
            offset += 4;
        } else if (component instanceof ArrayBuffer || ArrayBuffer.isView(component)) {
            resultArray.set(new Uint8Array(component.buffer), offset);
            offset += component.byteLength;
        }
    }

    return resultArray;
}

function encodeSTL(objects) {
    var components = [
        new Uint8Array(80),
        0
    ];

    objects.forEach((object, objIndex) => {
        var n = object.position.length;
        var m = object.indices.length;
        components[1] += n;
        var bytes = new Uint8Array(50*m);
        for (var k = 0; k < m; k += 3) {
            var i = object.indices.slice(k, k+3);
            var v = [
                object.position.slice(3*i[0], 3*i[0]+3),
                object.position.slice(3*i[1], 3*i[1]+3),
                object.position.slice(3*i[2], 3*i[2]+3)
            ];
            var n = new Float32Array([
                (v[1][1]-v[0][1])*(v[2][2]-v[0][2])-(v[1][2]-v[0][2])*(v[2][1]-v[0][1]),
                (v[1][2]-v[0][2])*(v[2][0]-v[0][0])-(v[1][0]-v[0][0])*(v[2][2]-v[0][2]),
                (v[1][0]-v[0][0])*(v[2][1]-v[0][1])-(v[1][1]-v[0][1])*(v[2][0]-v[0][0]),
            ]);
            var l = Math.sqrt(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]);
            n = new Float32Array([n[0]/l, n[1]/l, n[2]/l]);
            bytes.set(new Uint8Array(n.buffer), 50*k);
            for (var _ = 0; _ < 3; _++) {
                bytes.set(new Uint8Array(Float32Array.from(v[_]).buffer), 50*k+12*(_+1));
            }
            bytes.set(Uint8Array.from([0, 0]), 50*k+48);
        }
        components.push(bytes);
    });

    return concatComponents(components);
}

function encodeOBJ(objects) {
    let objContent = '';
    objContent += `o Desmos_Object\n`;

    objects.forEach((object, objIndex) => {
        for (let i = 0; i < object.position.length; i += 3)
            objContent += `v ${object.position[i]} ${object.position[i+2]} ${-object.position[i+1]}\n`;
    });
    objects.forEach((object, objIndex) => {
        for (let i = 0; i < object.normal.length; i += 3)
            objContent += `vn ${object.normal[i]} ${object.normal[i+2]} ${-object.normal[i+1]}\n`;
    });
    var indexStart = 1;
    objects.forEach((object, objIndex) => {
        for (let i = 0; i < object.indices.length; i += 3) {
            const i1 = object.indices[i] + indexStart;
            const i2 = object.indices[i+1] + indexStart;
            const i3 = object.indices[i+2] + indexStart;
            objContent += `f ${i1}//${i1} ${i2}//${i2} ${i3}//${i3}\n`;
        }
        indexStart += object.position.length / 3;
    });

    return objContent;
}

function encodeGLB(objects) {
    // https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
    let gltf = {
        asset: { version: "2.0" },
        scene: 0,
        scenes: [{ name: "Desmos_3D", nodes: [] }],
        nodes: [],
        meshes: [],
        materials: [],
        accessors: [],
        bufferViews: [],
        buffers: []
    };

    var objOffset = 0;
    var accessorOffset = 0;
    var bufferOffset = 0;
    var bufferComponents = [];
    objects.forEach((model, modelIndex) => {
        var vn = model.position.length / 3;
        var tn = model.indices.length;
        var vbn = 12*vn;
        var tbn = 4*tn;
        // mesh
        var position = Float32Array.from(model.position);
        var normal = Float32Array.from(model.normal);
        for (var i = 0; i < position.length; i += 3) {
            position[i+1] = model.position[i+2];
            position[i+2] = -model.position[i+1];
            normal[i+1] = model.normal[i+2];
            normal[i+2] = -model.normal[i+1];
        }
        var pmin = [Infinity, Infinity, Infinity];
        var pmax = [-Infinity, -Infinity, -Infinity];
        for (var i = 0; i < position.length; i++) {
            pmin[i%3] = Math.min(pmin[i%3], position[i]);
            pmax[i%3] = Math.max(pmax[i%3], position[i]);
        }
        // add components
        gltf.scenes[0].nodes.push(objOffset);
        gltf.nodes.push({
            mesh: objOffset,
            name: "Desmos_Mesh_"+objOffset
        });
        gltf.meshes.push({
            name: "Desmos_Mesh_"+objOffset,
            primitives: [{
                attributes: {
                    POSITION: accessorOffset+0,
                    NORMAL: accessorOffset+1
                },
                indices: accessorOffset+2,
                material: objOffset,
                mode: 4
            }]
        });
        gltf.materials.push({
            name: "Desmos_Material_"+objOffset,
            pbrMetallicRoughness: {
                baseColorFactor: model.color,
                metallicFactor: 0.0,
                roughnessFactor: model.roughness
            },
            doubleSided: true
        });
        gltf.accessors = gltf.accessors.concat([
            {
                bufferView: accessorOffset+0,
                componentType: 5126,
                count: vn,
                min: pmin,
                max: pmax,
                type: "VEC3"
            },
            {
                bufferView: accessorOffset+1,
                componentType: 5126,
                count: vn,
                min: [-1.0, -1.0, -1.0],
                max: [1.0, 1.0, 1.0],
                type: "VEC3"
            },
            {
                bufferView: accessorOffset+2,
                componentType: 5125,
                count: tn,
                min: [0],
                max: [vn],
                type: "SCALAR"
            }
        ]);
        gltf.bufferViews = gltf.bufferViews.concat([
            {
                buffer: 0,
                byteLength: vbn,
                byteOffset: bufferOffset+0,
                target: 34962
            },
            {
                buffer: 0,
                byteLength: vbn,
                byteOffset: bufferOffset+vbn,
                target: 34962
            },
            {
                buffer: 0,
                byteLength: tbn,
                byteOffset: bufferOffset+2*vbn,
                target: 34963
            }
        ]);
        bufferComponents = bufferComponents.concat([
            position, normal,
            Uint32Array.from(model.indices)
        ]);
        objOffset += 1;
        accessorOffset += 3;
        bufferOffset += 2*vbn+tbn;
    });
    gltf.buffers.push({
         byteLength: bufferOffset
    });

    var json = JSON.stringify(gltf);
    while (json.length % 4)
        json += " ";

    var components = [
        // header
        "glTF",
        2,
        12 + (4+4+json.length) + (4+4+bufferOffset),
        // JSON
        json.length,
        0x4e4f534a,
        json,
        // data
        bufferOffset,
        0x004e4942
    ].concat(bufferComponents);

    return concatComponents(components);
}

function downloadFile(content, type, filename) {
    const blob = new Blob([content], { type: type });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadSTL() {
    downloadFile(encodeSTL(Models), 'model/stl', 'model.stl');
}
function downloadOBJ() {
    downloadFile(encodeOBJ(Models), 'model/obj', 'model.obj');
}
function downloadGLB() {
    downloadFile(encodeGLB(Models), 'model/gltf-binary', 'model.glb');
}

(function() {
    // get state
    let state = Calc.getState();

    // turn off animation
    let exprs = state.expressions.list;
    for (var i = 0; i < exprs.length; i++) {
        let expr = exprs[i];
        if (expr.slider && expr.slider.isPlaying)
            expr.slider.isPlaying = false;
    }
    let ticker = state.expressions.ticker;
    if (ticker && ticker.playing)
        ticker.playing = false;
    state.graph.speed3D = 0;

    // set state
    Calc.setState(state);
})()
