MetOfficeData = (function() { module = {};

var DATAPOINT_KEY = 'd8997796-bcda-4bce-aff6-3b16f4cacbfd';
module.DATAPOINT_KEY = DATAPOINT_KEY;

// Return promise which is resolved with a JSON object describing the current
// Met Office capabilities.
var fetchCapabilitiesPromise;
function fetchCapabilities() {
  if(fetchCapabilitiesPromise) { return fetchCapabilitiesPromise; }
  fetchCapabilitiesPromise = new Promise(function(resolve, reject) {
    $.ajax({
      url: 'http://datapoint.metoffice.gov.uk/public/data/layer/wxobs/all/json/capabilities',
      data: { key: DATAPOINT_KEY },
      dataType: 'json',
      success: function(data) { resolve(data); },
      error: function(err) {
        console.error('Error fetching capabilities', err);
        reject(new Error('Error fetching capabilities'));
      }
    });
  });
  return fetchCapabilitiesPromise;
}
module.fetchCapabilities = fetchCapabilities;

// Return a promise which is resolved with list of layer objects
function fetchLayerUrls() {
  return fetchCapabilities().then(function(caps) {
    var layerUrls = [], baseUrl = caps.Layers.BaseUrl.$,
        timeAxis = caps.Layers.BaseUrl['@forServiceTimeFormat'];

    caps.Layers.Layer.forEach(function(layerSpec) {
      var layer = {
        displayName: layerSpec['@displayName'],
        name: layerSpec.Service['@name'],
        urls: [],
      };

      // Form URL with most of fields filled in
      var layerUrl, fields = extend({ key: DATAPOINT_KEY }, layerSpec.Service),
          timeFields, jointFields;

      // How many temporal layers are there?
      var timeSpecs = layerSpec.Service[timeAxis], nTimes = 0, timeFieldNames = [];
      for(var timeKey in timeSpecs) {
        if(timeSpecs[timeKey] instanceof Array) {
          timeFieldNames.push(timeKey);
          nTimes = Math.max(nTimes, timeSpecs[timeKey].length);
        }
      }

      for(var timeIdx=0; timeIdx<nTimes; ++timeIdx) {
        timeFields = {};
        for(var timeFieldNameIdx=0; timeFieldNameIdx<timeFieldNames.length; ++timeFieldNameIdx) {
          timeFields[timeFieldNames[timeFieldNameIdx]] =
            timeSpecs[timeFieldNames[timeFieldNameIdx]][timeIdx];
        }
        jointFields = extend(extend({}, fields), timeFields);

        layerUrl = baseUrl;
        for(var fieldName in jointFields) {
          while(layerUrl.indexOf('{'+fieldName+'}') != -1) {
            layerUrl = layerUrl.replace('{'+fieldName+'}', jointFields[fieldName], 'g');
          }
        }

        // Special case for Time
        if(timeFields.Time) { timeFields.Time = new Date(timeFields.Time); }

        layer.urls.push({
          url: layerUrl,
          at: timeFields,
        });
      }

      layerUrls.push(layer);
    });

    return layerUrls;
  });
}
module.fetchLayerUrls = fetchLayerUrls;

// Return promise which is resolved with a XML describing the current
// Met Office capabilities for WMTS.
var fetchWMTSCapabilitiesPromise;
function fetchWMTSCapabilities() {
  if(fetchWMTSCapabilitiesPromise) { return fetchWMTSCapabilitiesPromise; }
  fetchWMTSCapabilitiesPromise = new Promise(function(resolve, reject) {
    $.ajax({
      url: 'http://datapoint.metoffice.gov.uk/public/data/inspire/view/wmts',
      data: {
        'REQUEST': 'getcapabilities',
        key: DATAPOINT_KEY
      },
      dataType: 'xml',
      success: function(data) { resolve(data); },
      error: function(err) {
        console.error('Error fetching capabilities', err);
        reject(new Error('Error fetching capabilities'));
      }
    });
  });
  return fetchWMTSCapabilitiesPromise;
}
module.fetchWMTSCapabilities = fetchWMTSCapabilities;

function parseWMTSCapabilities() { return fetchWMTSCapabilities().then( function(caps) {
  console.log('caps doc', caps);
  // wrap returned document in jQuery.
  caps = $(caps).children('Capabilities');
  var contents = caps.children('Contents');

  function parseNumList(list) {
    return list.split(' ').map(function(v) { return +v; });
  }

  // process each tile matrix set
  var tileMatrixSets = {};
  contents.children('TileMatrixSet').each(function() {
    var elem = $(this),
        identifier = elem.children('ows\\:Identifier').text(),
        crs = elem.children('ows\\:SupportedCRS').text(),
        tileMatrices = [];

    elem.children('TileMatrix').each(function() {
      var tm = $(this);
      tileMatrices.push({
        identifier: tm.children('ows\\:Identifier').text(),
        scaleDenominator: +tm.children('ScaleDenominator').text(),
        topLeftCorner: parseNumList(tm.children('TopLeftCorner').text()),
        tileSize: [ +tm.children('TileWidth').text(), +tm.children('TileHeight').text() ],
        matrixSize: [ +tm.children('MatrixWidth').text(), +tm.children('MatrixHeight').text() ],
      });
    });

    tileMatrixSets[identifier] = {
      crs: crs,
      tileMatrices: tileMatrices,
    };
  });

  var layers = {};
  contents.children('Layer').each(function() {
    var layerElem = $(this), layer = {},
        identifier = layerElem.children('ows\\:Identifier').text();

    layer.title = layerElem.children('ows\\:Title').text();
    layer.format = layerElem.children('Format').text();

    var wgs84BB = layerElem.children('ows\\:WGS84BoundingBox');
    layer.wgs84Extent =
      parseNumList(wgs84BB.children('ows\\:LowerCorner').text()).concat(
        parseNumList(wgs84BB.children('ows\\:UpperCorner').text())
      );

    layer.styles = [];
    layerElem.children('Style').each(function() {
      layer.styles.push($(this).children('ows\\:Identifier').text());
    });

    layer.dimensions = {};
    layerElem.children('Dimension').each(function() {
      var dimElem = $(this), dimension = {},
          identifier = dimElem.children('Identifier').text();

      dimension.default = dimElem.children('Default').text();
      dimension.values = [];
      dimElem.children('Value').each(function() {
        dimension.values.push($(this).text());
      });

      layer.dimensions[identifier] = dimension;
    });

    layer.tileMatrixSets = {};
    layerElem.children('TileMatrixSetLink').each(function() {
      var identifier = $(this).children('TileMatrixSet').text();
      layer.tileMatrixSets[identifier] = tileMatrixSets[identifier];
    });

    layers[identifier] = layer;
  });

  return layers;
}); }

// Return a promise which is resolved with list of WMTS layers
function createWMTSLayers(projection) {
  projection = ol.proj.get(projection);
  return parseWMTSCapabilities().then( function(layerSpecs) {
    var layers = {}, layerSpec, url, params, layerTileGrid;
    console.log(layerSpecs);

    for(var layerKey in layerSpecs) {
      layerSpec = layerSpecs[layerKey];
      if(!layerSpec.tileMatrixSets[projection.getCode()]) {
        console.warn('Layer ' + layerKey + ' does not support ' + projection.getCode());
        continue;
      }

      // Form base url
      params = { key: DATAPOINT_KEY };
      for(var dimKey in layerSpec.dimensions) {
        params[dimKey] = layerSpec.dimensions[dimKey].default;
      }
      url = 'http://datapoint.metoffice.gov.uk/public/data/inspire/view/wmts?' + $.param(params);

      var tms = layerSpec.tileMatrixSets[projection.getCode()],
          origins = [], resolutions = [], tileSizes = [], matrixIds = [];

      for(var tmIdx=0; tmIdx<tms.tileMatrices.length; ++tmIdx) {
        var tm = tms.tileMatrices[tmIdx];
        matrixIds.push(tm.identifier);
        origins.push(tm.topLeftCorner);
        tileSizes.push(tm.tileSize[0]);

        // This assumes a "standard" pixel of 0.28mm.
        resolutions.push(2.8e-4 * tm.scaleDenominator);
      }

      console.log(origins, resolutions, tileSizes, matrixIds);

      layerTileGrid = new ol.tilegrid.WMTS({
        origins: origins, resolutions: resolutions,
        tileSizes: tileSizes, matrixIds: matrixIds
      });

      layers[layerKey] = new ol.layer.Tile({
        source: new ol.source.WMTS({
          crossOrigin: 'anonymous',
          url: url, projection: projection,
          layer: layerKey, format: layerSpec.format,
          style: layerSpec.styles[0], // FIXME: specify?
          matrixSet: projection.getCode(), // FIXME: non-general?
          tileGrid: layerTileGrid,
        }),
      });
    }
    return layers;
  });
}
module.createWMTSLayers = createWMTSLayers;

return module; })();
