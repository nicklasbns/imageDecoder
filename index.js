var pako = require("pako");
var fs = require("fs");
var https = require("https");

module.exports.decode = decode;
module.exports.mean = mean;


/**
 * @typedef {Object} imageData
 * @property {number} width
 * @property {number} height
 * @property {number} depth
 * @property {number} color
 * @property {[number, number, number, number][]} data
 * 
 */

/**
 * Downloads or reads the png file and parses the average color
 * of the image
 * @param {String} url HTTPS url or file path to a png
 * @returns {Promise<[number, number, number, number]>}
 * If successful, returns an `array` of 4 `numbers` in RGBA format
 * 
 * ```js
 * var imageDecoder = require("@nicklasbns/imagedecoder");
 * 
 * let meanColor = await imageDecoder.mean(url).catch((e) => {
 *   console.log("Error:", e);
 * }) || [0, 0, 0, 0]; //if the image is invalid we instead use a deafult color
 * 
 * console.log(meanColor) //[168, 87, 115, 255]
 * ```
 */
async function mean(url) {
    let image = await decode(url)
    // console.log(image);
    var totals = [0, 0, 0, 0];
    image.data.forEach(pixel => {
        for (let i in pixel) {
            totals[i] += pixel[i];
        }
    });
    for (var i = 0; i < 4; i++) {
        totals[i] = Math.round(totals[i]/image.data.length);
    }
    return totals
}


/**
 * Downloads or reads the png file and if successful, returns {@link imageData}
 * @param {String} url HTTPS url or file path to a png
 * @returns {Promise<imageData>} Object of type `imageData`
 * @example
 * ```js
 * var imageDecoder = require("@nicklasbns/imagedecoder");
 * 
 * let image = await imageDecoder.decode(url).catch((e) => {
 *   console.log("Error:", e);
 * });
 * 
 * console.log(image)
 * ```
 * 
 * example output:
 * ```js
 * {
 *   width: 200,
 *   height: 200,
 *   depth: 8,
 *   color: 6,
 *   data: [[128, 128, 128, 255], ...]
 * }
 * ```
 * 
 */
async function decode(url) {
return new Promise(async (respond, reject) => {
    var png = await download(url).catch((e) => {
        reject(e);
    });
    if (!png) return
    var imageData = {};
    var base = [], pixels = [];

    if (png.subarray(0, 8).join() != "137,80,78,71,13,10,26,10") {
        reject(new Error("This file is not a vaild png"));
        return
    }
    var i = 8;
    while (i < png["byteLength"]) {
        var length = read32(png, i);
        
        switch (String.fromCharCode(...png.subarray(i+4, i+8))) {
            case "IHDR":
                imageData = {
                    width: read32(png, i+8),
                    height: read32(png, i+12),
                    depth: png[i+16],
                    color: png[i+17], // 1: palette, 2: color, 4: alpha
                }
                // console.log(imageData);
                if (png[i+20] == 1) {
                    reject(new Error("This image is fucking interlaced you stoopid"));
                    return
                }
                if (imageData.color == 6) {
                    imageData.channels = 4;
                } else if (imageData.color == 2) {
                    imageData.channels = 3;
                } else if (imageData.color == 3) {
                    reject(new Error("This image uses a palette, i have not added support for this yet:tm: (dm me nicklasbns#8693)"));
                } else {
                    reject(new Error("Unsupported color-type: " + imageData.color + ". (dm me nicklasbns#8693 if you want support for this color type)"));
                    return
                }
                break
            case "PLTE":
                break
            case "IDAT":
                base.push(...png.subarray(i+8, i+8+length));
                break
            case "IEND":
                var baseData = pako.inflate(base);
                pixels = decodeIDAT(baseData, imageData.width*imageData.depth*imageData.channels/8, imageData.height, imageData.channels, reject);
                break
            default:
                // console.log(String.fromCharCode(...png.subarray(i+4, i+8)));
        }
        
        i += length+12;
    }

    var pixels2 = []
    for (let i = 0; i < pixels.length/imageData.channels; i++) {
        pixels2[i] = []
        for (let j = 0; j < imageData.channels; j++) {
            pixels2[i][j] = pixels[i*imageData.channels+j];
        }
    }
    imageData.data = pixels2
    respond(imageData);
});
}

function decodeIDAT(data, length, height, channels, reject) {
    var bytes = []
    for (let j = 0; j < height; j++) {
        let scanline = new Uint8Array(data.subarray(j*(length+1)+1, (j+1)*(length+1)));
        let start = j*(length);
        switch (data[j*(length+1)]) {
            case 0:
                for (let k = 0; k < length; k++) {
                    bytes.push(scanline[k]%256);
                }
                break
            case 1:
                for (let k = 0; k < length; k++) {
                    let a = k>channels-1 ? bytes[start+k-channels] : 0;
                    bytes.push((a+scanline[k])%256);
                }
                break
            case 2:
                for (let k = 0; k < length; k++) {
                    let b = j ? bytes[start+k-length] : 0;
                    bytes.push((b+scanline[k])%256);
                }
                break
            case 3:
                for (let k = 0; k < length; k++) {
                    let a = k>channels-1 ? bytes[start+k-channels] : 0;
                    let b = j ? bytes[start+k-length] : 0;
                    let avg = Math.floor((a+b)/2);
                    bytes.push((avg+scanline[k])%256);
                }
                break
            case 4:
                for (let k = 0; k < length; k++) {
                    let abs = Math.abs;
                    let a = k>channels-1 ? bytes[start+k-channels] : 0;
                    let b = j ? bytes[start+k-length] : 0;
                    let c = k>channels-1&&j ? bytes[start+k-length-channels] : 0;
                    let p = a + b - c
                    if (abs(p-a) > abs(p-b)) {
                        if (abs(p-b) > abs(p-c)) {
                            bytes.push((c+scanline[k])%256);
                        } else {
                            bytes.push((b+scanline[k])%256);
                        }
                    } else {
                        if (abs(p-a) > abs(p-c)) {
                            bytes.push((c+scanline[k])%256);
                        } else {
                            bytes.push((a+scanline[k])%256);
                        }
                    }
                }
                break
            default:
                reject(new Error(`Unsupported filter(${data[j*(length+1)]}) on ${j}th scanline.
This should never happen since all fliters should be supported. dm me nicklasbns#8693`));
                return []
        }
    }
    return bytes
}

async function download(url) {
    return new Promise((res, reject) => {
    try {
        if (url.split(":")[0] == "https") {
            https.get(url, {} , async data => {
                let array = new Uint8Array();
                    
                data.on("data", data => {
                    array = new Uint8Array([...array, ...data]);
                });
                data.on("end", () => {res(array)});
            }).on("error", e => {
                reject(e);
            });
        } else if (url.split(":")[0] == "http") {
            reject(new Error("Does not support http"));
        } else {
            fs.readFile(url, {}, (err, data) => {
                if (err) reject(err);
                res(data);
            })
        }
    } catch(e) {
        reject(e);
    }
    });
}

function read32(arr, int) {
    return (arr[int++] << 24) |
           (arr[int++] << 16) |
           (arr[int++] << 08) |
            arr[int++]
}
