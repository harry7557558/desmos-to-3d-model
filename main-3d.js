/*

## How to use

- Open a 3D Desmos graph
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
    console.log("Valid mesh - "+(usedCount/(n/3)*100).toFixed(6)+"% points used.");

    return true;
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
                metallicFactor: model.metalness,
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
            color: color,
            metalness: metalness,
            roughness: roughness,
            position: position,
            normal: normal,
            indices: indices
        };
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
                models.push(model1);
            }
        }
        else models.push(model);
    }

    //downloadSTL(models);
    //downloadOBJ(models);
    downloadGLB(models);
})()
