/*

## How to use

- Open a 3D Desmos graph
- Zoom / Resize window for desired shape and point/line size/thickness
- Paste `main-3d.js` into F12 JS console
- Follow the prompt to download model
- You can change the 3D model format format by changing `download(GLB|OBJ|STL)()` at the end of the script

*/

"use strict";

function matrixTransform(mat, a) {
    for (var k = 0; k < a.length; k += 3) {
        var v = [a[k], a[k+1], a[k+2], 1];
        var w = [0, 0, 0, 0];
        for (var i = 0; i < 4; i++)
            for (var j = 0; j < 4; j++)
                w[i] += mat[j*4+i] * v[j];
        for (var i = 0; i < 3; i++)
            a[k+i] = w[i]/w[3];
    }
}

function validMesh(model) {
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
    //console.log("Valid mesh - "+(usedCount/(n/3)*100).toFixed(6)+"% points used.");

    return true;
}

function clipMesh(mesh, clip) {
    // get geometry
    var position = new Array(mesh.position.length / 3);
    var normal = new Array(mesh.normal.length / 3);
    for (var i = 0; i < mesh.position.length; i += 3) {
        position[i/3] = [
            mesh.position[i],
            mesh.position[i+1],
            mesh.position[i+2]
        ];
        normal[i/3] = [
            mesh.normal[i],
            mesh.normal[i+1],
            mesh.normal[i+2]
        ];
    }
    // calculate offsets
    var offsets = new Array(position.length);
    var calc_o = function(p, n, o) {
        return p[0]*n[0]+p[1]*n[1]+p[2]*n[2]-o;
    }
    var clip_size = Math.cbrt(
        (clip.xmax-clip.xmin)*(clip.ymax-clip.ymin)*(clip.zmax-clip.zmin));
    for (var i = 0; i < position.length; i++) {
        var p = position[i];
        var o = calc_o(p, [1, 0, 0], clip.xmax);
        o = Math.max(o, calc_o(p, [0, 1, 0], clip.ymax));
        o = Math.max(o, calc_o(p, [0, 0, 1], clip.zmax));
        o = Math.max(o, calc_o(p, [-1, 0, 0], -clip.xmin));
        o = Math.max(o, calc_o(p, [0, -1, 0], -clip.ymin));
        o = Math.max(o, calc_o(p, [0, 0, -1], -clip.zmin));
        offsets[i] = o + 1e-6*clip_size;
    }
    // clip each triangle
    var indices = [];
    var edgemap = {};
    var FACE_TABLE = [
        [0, 1, 2],  // 000
        [3, 1, 2, 5, 3, 2],  // 001
        [0, 3, 2, 2, 3, 4],  // 010
        [2, 5, 4],  // 011
        [0, 4, 5, 0, 1, 4], // 100
        [3, 1, 4],  // 101
        [0, 3, 5],  // 110
        [],  // 111
    ]
    for (var ii = 0; ii < mesh.indices.length; ii += 3) {
        var vi = [
            mesh.indices[ii],
            mesh.indices[ii+1],
            mesh.indices[ii+2],
            -1, -1, -1
        ];
        // create new vertices on edges
        for (var i = 0; i < 3; i++) {
            var a = vi[i];
            var b = vi[(i+1)%3];
            if (offsets[a]*offsets[b] < 0) {
                var key = Math.min(a,b) + ',' + Math.max(a,b);
                if (edgemap.hasOwnProperty(key)) {
                    vi[i+3] = edgemap[key];
                }
                vi[i+3] = edgemap[key] = position.length;
                var t = -offsets[a] / (offsets[b]-offsets[a]);
                var p = [0, 0, 0];
                var n = [0, 0, 0], nl = 0.0;
                for (var j = 0; j < 3; j++) {
                    p[j] = position[a][j]*(1.0-t)+position[b][j]*t;
                    n[j] = normal[a][j]*(1.0-t)+normal[b][j]*t;
                    nl += n[j]*n[j];
                }
                var ns = 1.0 / Math.sqrt(nl);
                position.push(p);
                normal.push([n[0]*ns, n[1]*ns, n[2]*ns]);
            }
        }
        // create new triangles
        var tcase = 0;
        for (var i = 0; i < 3; i++) {
            var a = vi[i];
            if (offsets[a] > 0.0) {
                vi[i] = -1;
                tcase |= (1<<i);
            }
        }
        tcase = FACE_TABLE[tcase];
        for (var i = 0; i < tcase.length; i++) {
            if (tcase[i] == -1)
                throw new Error(-1);
            indices.push(vi[tcase[i]]);
        }
    }
    // remove unused vertices
    var vertMap = new Array(position.length).fill(-1);
    for (var i = 0; i < indices.length; i++)
        vertMap[indices[i]] = 1;
    for (var i = 0; i < position.length; i++) {
        var p = position[i];
        if (!(isFinite(p[0]) && isFinite(p[1]) && isFinite(p[2])))
            vertMap[i] = -1;
    }
    var numVerts = 0;
    for (var i = 0; i < position.length; i++) {
        if (vertMap[i] != -1) {
            vertMap[i] = numVerts;
            numVerts += 1;
        }
    }
    var numIndices = 0;
    for (var i = 0; i < indices.length; i += 3) {
        if (vertMap[indices[i]] == -1 ||
            vertMap[indices[i+1]] == -1 ||
            vertMap[indices[i+2]] == -1)
            continue;
        for (var _ = 0; _ < 3; _++)
            indices[numIndices+_] = vertMap[indices[i+_]];
        numIndices += 3;
    }
    indices = indices.slice(0, numIndices);
    // update model
    mesh.position = new Float32Array(3*numVerts);
    mesh.normal = new Float32Array(3*numVerts);
    var vertCount = 0;
    for (var i = 0; i < 3*position.length; i++) {
        var ii = Math.floor(i/3);
        if (vertMap[ii] == -1)
            continue;
        mesh.position[vertCount] = position[ii][i%3];
        mesh.normal[vertCount] = normal[ii][i%3];
        vertCount += 1;
    }
    mesh.indices = Uint32Array.from(indices);
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

function encodeGLB(objects_) {

    var objects = [];
    for (var mi = 0; mi < objects_.length;) {
        // get consecutive models
        var model = objects_[mi];
        var vn = model.position.length;
        var fn = model.indices.length;
        var models = [model];
        var sameColor = true;
        for (mi++; mi < objects_.length; mi++) {
            var model1 = objects_[mi];
            var equal = (!model1.colors && !model.colors &&
                         model1.key.split(':')[0] == model.key.split(':')[0] &&
                         model1.position.length == vn &&
                         model1.normal.length == vn &&
                         model1.indices.length == fn);
            if (equal) {
                for (var i = 0; i < model1.indices.length; i++)
                    if (model1.indices[i] != model.indices[i])
                    { equal = false; break; }
            }
            if (!equal) break;
            models.push(model1);
            if (JSON.stringify(model1.color) != JSON.stringify(model.color)
                || model1.metalness != model.metalness
                || model1.roughness != model.roughness)
                sameColor = false;
        }
        // merge
        var n = models.length;
        if (n == 1) {
            objects.push(model);
            continue;
        }
        var object = {
            key: model.key,
            position: new Float32Array(vn*n),
            normal: new Float32Array(vn*n),
            indices: new Float32Array(fn*n),
            color: [1, 1, 1, 1],
            metalness: model.metalness,
            roughness: model.roughness
        };
        if (sameColor)
            object.color = model.color;
        else
            object.colors = new Float32Array(vn*n);
        for (var i = 0; i < n; i++) {
            object.position.set(models[i].position, vn*i);
            object.normal.set(models[i].normal, vn*i);
            object.indices.set(models[i].indices, fn*i);
            for (var j = 0; j < fn; j++)
                object.indices[fn*i+j] += vn*i/3;
            if (sameColor) continue;
            for (var j = 0; j < vn; j++)
                object.colors[vn*i+j] = models[i].color[j%3];
        }
        objects.push(object);
    }
    console.log("glTF contains", objects.length, "objects");
    
    // https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html
    let gltf = {
        asset: {
            version: "2.0",
            copyright: window.location.href
        },
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
            if (isFinite(position[i])) {
                pmin[i%3] = Math.min(pmin[i%3], position[i]);
                pmax[i%3] = Math.max(pmax[i%3], position[i]);
            }
        }
        if (!isFinite(pmax[0]-pmin[0]) || !isFinite(pmax[1]-pmin[1]) ||
               !isFinite(pmax[2]-pmin[2]))
            return;
        // add components
        gltf.scenes[0].nodes.push(objOffset);
        gltf.nodes.push({
            mesh: objOffset,
            name: "Desmos_Mesh_"+model.key
        });
        let mesh = {
            name: "Desmos_Mesh_"+model.key,
            primitives: [{
                attributes: {
                    POSITION: accessorOffset+0,
                    NORMAL: accessorOffset+1
                },
                indices: accessorOffset+2,
                material: objOffset,
                mode: 4
            }]
        };
        let material = {
            name: "Desmos_Material_"+model.key,
            pbrMetallicRoughness: {
                baseColorFactor: model.color,
                metallicFactor: model.metalness,
                roughnessFactor: model.roughness
            },
            doubleSided: true
        };
        let accessors = [
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
        ];
        let bufferViews = [
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
        ];
        bufferComponents = bufferComponents.concat([
            position, normal,
            Uint32Array.from(model.indices)
        ]);
        accessorOffset += accessors.length;
        for (var i = 0; i < bufferViews.length; i++)
            bufferOffset += bufferViews[i].byteLength;
        if (model.colors) {
            mesh.primitives[0].attributes['COLOR_0'] = accessorOffset;
            material.pbrMetallicRoughness['baseColorTexture'] = {
                index: gltf.bufferViews.length+bufferViews.length
            };
            accessors.push({
                bufferView: accessorOffset,
                componentType: 5126,
                count: vn,
                min: [0, 0, 0],
                max: [1, 1, 1],
                type: "VEC3"
            });
            bufferViews.push({
                "buffer": 0,
                "byteLength": vbn,
                "byteOffset": bufferOffset,
                "target": 34963
            });
            accessorOffset += 1;
            bufferOffset += vbn;
            bufferComponents.push(model.colors);
        }
        gltf.meshes.push(mesh);
        gltf.materials.push(material);
        gltf.accessors = gltf.accessors.concat(accessors);
        gltf.bufferViews = gltf.bufferViews.concat(bufferViews);
        objOffset += 1;
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

function downloadSTL(models) {
    downloadFile(encodeSTL(models), 'model/stl', 'model.stl');
}
function downloadOBJ(models) {
    downloadFile(encodeOBJ(models), 'model/obj', 'model.obj');
}
function downloadGLB(models) {
    downloadFile(encodeGLB(models), 'model/gltf-binary', 'model.glb');
}

(function() {
    let models = [];

    let graph = Calc.getState().graph;
    let useClip = graph.showBox3D === undefined || graph.showBox3D;
    let clip = graph.viewport;

    let surfaces = Calc.controller.grapher3d.webglLayer.surfaces;
    for (var key in surfaces) {
        
        // retrive data
        let mesh = surfaces[key].mesh;
        let diffuse = mesh.material.uniforms.diffuse.value;
        let color = [diffuse.r, diffuse.g, diffuse.b, 1.0];
        let metalness = mesh.material.uniforms.metalness.value;
        let roughness = mesh.material.uniforms.roughness.value;
        let position = mesh.geometry.attributes.position.array.slice();
        let normal = mesh.geometry.attributes.normal.array.slice();
        let indices = mesh.geometry.index.array.slice();

        // transform
        let mat = mesh.dcgModelMatrix.elements.slice();
        matrixTransform(mat, position);
        // assume translation / uniform scaling, normal doesn't change
        // to-do: ellipsoid?

        // add model
        let model = {
            key: key,
            color: color,
            metalness: metalness,
            roughness: roughness,
            position: position,
            normal: normal,
            indices: indices
        };
        if (mesh.geometry.attributes.color)
            model.colors = mesh.geometry.attributes.color.array.slice();
        if (validMesh(model) !== true)
            continue;
        if (mesh.count) {
            for (var k = 0; k < mesh.count; k++) {
                let model1 = { ...model };
                let color = mesh.instanceColor.array.slice(3*k, 3*k+3);
                model1.color = [color[0], color[1], color[2], 1.0];
                let mat = mesh.instanceMatrix.array.slice(16*k, 16*k+16);
                model1.position = model.position.slice();
                matrixTransform(mat, model1.position);
                model1.normal = model.normal.slice();
                model1.indices = model.indices.slice();
                if (useClip) clipMesh(model1, clip);
                if (model1.indices.length > 0)
                    models.push(model1);
            }
        }
        else {
            if (useClip) clipMesh(model, clip);
            if (model.indices.length > 0)
                models.push(model);
        }
    }

    //downloadSTL(models);
    //downloadOBJ(models);
    downloadGLB(models);
})();
