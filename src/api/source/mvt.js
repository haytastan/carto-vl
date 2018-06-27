import * as rsys from '../../client/rsys';
import Dataframe from '../../core/dataframe';
import * as Protobuf from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { decodeLines, decodePolygons } from '../../client/mvt/feature-decoder';
import TileClient from './TileClient';
import Base from './base';
import { RTT_WIDTH } from '../../core/renderer';
import Metadata from '../../core/metadata';

// Constants for '@mapbox/vector-tile' geometry types, from https://github.com/mapbox/vector-tile-js/blob/v1.3.0/lib/vectortilefeature.js#L39
const mvtDecoderGeomTypes = { point: 1, line: 2, polygon: 3 };

const geometryTypes = {
    UNKNOWN: 'unknown',
    POINT: 'point',
    LINE: 'line',
    POLYGON: 'polygon'
};

export default class MVT extends Base {

    /**
     * Create a carto.source.MVT.
     *
     * @param {object} data - A MVT data object
     * @param {object} metadata - A carto.source.mvt.Metadata object
     *
     * @example
     * const metadata = new carto.source.mvt.Metadata([{ type: 'number', name: 'total_pop'}])
     * new carto.source.MVT("https://{server}/{z}/{x}/{y}.mvt", metadata);
     *
     * @fires CartoError
     *
     * @constructor MVT
     * @extends carto.source.Base
     * @memberof carto.source
     * @IGNOREapi
     */
    constructor(templateURL, metadata = new Metadata()) {
        super();
        this._templateURL = templateURL;
        this._metadata = metadata;
        this._tileClient = new TileClient(templateURL);
    }

    _clone() {
        return new MVT(this._templateURL, JSON.parse(JSON.stringify(this._metadata)));
    }

    bindLayer(addDataframe, dataLoadedCallback) {
        this._tileClient.bindLayer(addDataframe, dataLoadedCallback);
    }

    async requestMetadata() {
        return this._metadata;
    }

    requestData(viewport) {
        return this._tileClient.requestData(viewport, this.responseToDataframeTransformer.bind(this));
    }

    async responseToDataframeTransformer(response, x, y, z) {
        const MVT_EXTENT = 4096;
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength == 0 || response == 'null') {
            return { empty: true };
        }
        const tile = new VectorTile(new Protobuf(arrayBuffer));
        const mvtLayer = tile.layers[Object.keys(tile.layers)[0]];

        const { points, featureGeometries, properties, numFeatures } = this._decodeMVTLayer(mvtLayer, this._metadata, MVT_EXTENT);


        const rs = rsys.getRsysFromTile(x, y, z);
        const dataframeGeometry = this._metadata.geomType == geometryTypes.POINT ? points : featureGeometries;
        const dataframe = this._generateDataFrame(rs, dataframeGeometry, properties, numFeatures, this._metadata.geomType);
        return dataframe;
    }


    _decodeMVTLayer(mvtLayer, metadata, mvt_extent) {
        let points;
        if (metadata.geomType == geometryTypes.POINT) {
            points = new Float32Array(mvtLayer.length * 2);
        }
        let featureGeometries = [];
        let numFeatures = 0;
        const decodedProperties = {};
        const decodingPropertyNames = [];
        Object.keys(metadata.properties).
            filter(propertyName => metadata.properties[propertyName].type != 'geometry').
            forEach(propertyName => {
                decodingPropertyNames.push(...metadata.propertyNames(propertyName));
            });
        decodingPropertyNames.forEach(propertyName => {
            decodedProperties[propertyName] = new Float32Array(mvtLayer.length + RTT_WIDTH);
        });
        for (let i = 0; i < mvtLayer.length; i++) {
            const f = mvtLayer.feature(i);
            const geom = f.loadGeometry();
            const mvtGeomType = f.type;
            if (metadata.geomType === undefined) {
                switch (mvtGeomType) {
                    case mvtDecoderGeomTypes.point:
                        metadata.geomType = geometryTypes.POINT;
                        break;
                    case mvtDecoderGeomTypes.line:
                        metadata.geomType = geometryTypes.LINE;
                        break;
                    case mvtDecoderGeomTypes.polygon:
                        metadata.geomType = geometryTypes.POLYGON;
                        break;
                    default:
                        throw new Error('MVT: invalid geometry type');
                }
                if (metadata.geomType == geometryTypes.POINT) {
                    points = new Float32Array(mvtLayer.length * 2);
                }
            }
            if (metadata.geomType == geometryTypes.POINT) {
                const x = 2 * (geom[0][0].x) / mvt_extent - 1.;
                const y = 2 * (1. - (geom[0][0].y) / mvt_extent) - 1.;
                // Tiles may contain points in the border;
                // we'll avoid here duplicatend points between tiles by excluding the 1-edge
                if (x < -1 || x >= 1 || y < -1 || y >= 1) {
                    continue;
                }
                points[2 * numFeatures + 0] = x;
                points[2 * numFeatures + 1] = y;
            } else if (metadata.geomType == geometryTypes.POLYGON) {
                const decodedPolygons = decodePolygons(geom, mvt_extent);
                featureGeometries.push(decodedPolygons);
            } else if (metadata.geomType == geometryTypes.LINE) {
                const decodedLines = decodeLines(geom, mvt_extent);
                featureGeometries.push(decodedLines);
            } else {
                throw new Error(`Unimplemented geometry type: '${metadata.geomType}'`);
            }
            decodingPropertyNames.forEach(propertyName => {
                const propertyValue = f.properties[propertyName];
                decodedProperties[propertyName][numFeatures] = this.decodeProperty(propertyName, propertyValue);
            });
            ++numFeatures;
        }
        return { properties: decodedProperties, points, featureGeometries, numFeatures };
    }

    decodeProperty(propertyName, propertyValue) {
        if (typeof propertyValue === 'string') {
            return this._metadata.categorizeString(propertyValue);
        } else if (typeof propertyValue === 'number') {
            return propertyValue;
        } else if (propertyValue == null || propertyValue == undefined) {
            return Number.NaN;
        } else {
            throw new Error(`MVT decoding error. Feature property value of type '${typeof propertyValue}' cannot be decoded.`);
        }
    }

    _generateDataFrame(rs, geometry, properties, size, type) {
        return new Dataframe({
            active: false,
            center: rs.center,
            geom: geometry,
            properties: properties,
            scale: rs.scale,
            size: size,
            type: type,
            metadata: this._metadata,
        });
    }

    free() {
        this._tileClient.free();
    }
}
