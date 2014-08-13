// Teach proj4 about the British national grid
proj4.defs("EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs");

(function() {
'use strict';

// ///// CONSTANTS /////

// var WGS84 = 'EPSG:4326', MAP_PROJ = 'EPSG:3857';
var WGS84 = 'EPSG:4326', MAP_PROJ = 'EPSG:27700';

// Amount to shift road segments to "left"
var ROAD_SHIFT = 4; // pixels
var ROAD_WIDTH = 5;

// scales
var MAX_SPEED=120, MAX_FLOW=5000, MAX_OCCUPANCY=100;

// A promise which is resolved after the DOM is loaded and event handlers wired up.
var domReady = new Promise(function(resolve, reject) {
  $(document).ready(function() {
    $('#toggleAnts').change(function() {
      setShowMarchingAnts($(this).is(':checked'));
    });
    setShowMarchingAnts($('#toggleAnts').is(':checked'));

    $('#toggleRainfall').change(function() {
      setShowRainfallRadar($(this).is(':checked'));
    });
    setShowRainfallRadar($('#toggleRainfall').is(':checked'));

    $('input[name="dataLayer"]').change(function() {
      var value = $('input[name="dataLayer"]:checked').val();
      showDataLayer(value);
    });
    showDataLayer($('input[name="dataLayer"]:checked').val());

    resolve(true);
  });
});

// A promise which is resolved with the OpenLayers map object
var createMap = domReady.then(function() {
  console.log('Creating map');

  // var baseMapSource = new ol.source.MapQuest({layer: 'osm'});

  var resolutions = [2500, 1000, 500, 200, 100, 50, 25, 10, 5, 2, 1];

  var baseMapLayer = new ol.layer.Group({
    layers: resolutions.map(osMapLayerForResolution),
  });

  /*
  var rainfallLayer = new ol.layer.Tile({
    source: new ol.source.WMTS({
      url: 'http://datapoint.metoffice.gov.uk/public/data/inspire/view/wmts',
      projection: MAP_PROJ,
      layer: 'RADAR_UK_Composite_Highres',
      style: 'Bitmap 1km Blue-Pale blue gradient 0.01 to 32mm/hr',
      params: {
        'DIMTIME': '2014-08-13T08:00:Z',
        'KEY': MetOfficeData.DATAPOINT_KEY,
      },
    }),
  });
  */

  // Create the base map
  var map = new ol.Map({
    target: 'map',
    // renderer: ['webgl', 'canvas', 'dom'],
    layers: [ baseMapLayer ],
    view: new ol.View({
      // maxZoom: 18, minZoom: 0,
      center: ol.proj.transform([-0.09, 51.505], WGS84, MAP_PROJ),
      projection: MAP_PROJ,
      resolution: 1000,
      resolutions: resolutions,
    }),
    controls: ol.control.defaults().extend([
      new ol.control.ScaleLine({ units: 'imperial' }),
      new ol.control.FullScreen(),
      new ol.control.Control({ element: $('#legend').detach().get()[0] }),
      new ol.control.Control({ element: $('#statsPanel').detach().get()[0] }),
    ]),
  });

  return map;
});

var fetchData = RealtimeTrafficData.createFetchDataPromise({ destProjection: MAP_PROJ });
fetchData.then(function(v) { console.log('fetch', v); });
fetchData.catch(function(err) { console.log('Error fetching data', err ); });

// Initialse map view to cover extent of data and fill in the stats panel
var setUpInitialState = Promise.all([createMap, fetchData]).then(function(vals) {
  var map = vals[0], trafficData = vals[1];

  // write some stats
  $('#roadCount').text(trafficData.graph.size);
  $('#pubTime').text(trafficData.timestamps.data.published.toLocaleString());

  // Calculate entire extent
  var boundingExtent = trafficData.simplified[trafficData.simplified.length-1].tree.data.bbox;
  console.log('bounding extent', boundingExtent);

  // Add control to reset zoom
  map.addControl(new ol.control.ZoomToExtent({
    extent: boundingExtent,
  }));

  // Zoom to extent
  map.getView().fitExtent(boundingExtent, map.getSize());
});

// Interpolate missing data returning new data
var interpolateData = fetchData.then(function(trafficData) {
  trafficData.data = extend(trafficData.data, {
    speeds: graphInterpolateData(trafficData.data.speeds, trafficData.graph),
    flows: graphInterpolateData(trafficData.data.flows, trafficData.graph),
    occupancies: graphInterpolateData(trafficData.data.occupancies, trafficData.graph),
  });

  return trafficData;
});

// Create the traffic data layers
var createDataLayers = Promise.all([createMap, fetchData]).then(function(vals) {
  var map = vals[0], trafficData = vals[1];
  console.log('create data layers on', map, trafficData);

  var layers = [
    { name: 'speed', scale: { min: 0, max: MAX_SPEED, map: redGreen, unit: 'km/h' } },
    { name: 'flow', scale: { min: 0, max: MAX_FLOW, map: heat, unit: 'veh/hr' } },
    { name: 'occupancy', scale: { min: 0, max: MAX_OCCUPANCY, map: heat, unit: '%' } },
  ];

  layers.forEach(function(l) {
    l.layer = newTrafficDataLayer({
      data: trafficData, roadShift: ROAD_SHIFT, roadWidth: ROAD_WIDTH,
      type: l.name, scale: l.scale,
    });

    map.addLayer(l.layer);
    l.layer.setVisible(false);
  });

  return layers;
});

var createMarchingAntsHandler = Promise.all([createMap, interpolateData]).then(function(vals) {
  var map = vals[0], trafficData = vals[1];
  console.log('set up marching ants on', map, trafficData);

  // Create a post-compose handler for displaying cars
  var pch = new MarchingAntsRenderer(trafficData, ROAD_SHIFT, ROAD_WIDTH);
  var handlerFunc = pch.handleEvent.bind(pch);
  return handlerFunc;
});
createMarchingAntsHandler.catch(function(err) { console.log('error in marching ants', err); });

// Remove loading screen once data is fetched
(function() {
  function stopLoading() { $('body').removeClass('loading'); }
  fetchData.then(stopLoading, stopLoading);
})();

function updateLayerScale(scale) {
  domReady.then(function() {
    $('canvas.scale').each(function(idx, canvas) {
      var noDataLabel = 'No data';

      canvas.width = $(canvas).width();
      canvas.height = $(canvas).height();

      var ctx = canvas.getContext('2d'), color,
          barSize = 15, spacing = 10, fontSize = 12;

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Nothing to do other than clear the canvas if no scale
      if(!scale) { return; }

      ctx.font = fontSize + 'px sans-serif';
      var noDataMetrics = ctx.measureText(noDataLabel),
          scaleStart = 0, scaleEnd = canvas.width - spacing - noDataMetrics.width,
          scaleExtent = scaleEnd - scaleStart,
          dl=Math.max(1, Math.floor(scaleExtent/255));

      console.log(scaleStart, scaleEnd);

      for(var l=0; l<scaleExtent; l+=dl) {
        color = scale.map(l, scaleExtent);
        ctx.fillStyle = tinycolor({r:color[0], g:color[1], b:color[2], a:color[3]}).toHexString();
        ctx.fillRect(scaleStart + l, canvas.height - barSize, dl, barSize);
      }

      ctx.fillStyle = '#888';
      ctx.fillRect(scaleExtent + spacing + 0.5*noDataMetrics.width - 0.5*barSize,
          canvas.height - barSize, barSize, barSize);

      ctx.fillStyle = 'black';
      ctx.textBaseline = 'bottom';

      ctx.textAlign = 'left';
      ctx.fillText(noDataLabel, scaleExtent + spacing, canvas.height - barSize - 0.5*spacing);
      ctx.fillText(scale.min, 0, canvas.height - barSize - 0.5*spacing);

      ctx.textAlign = 'right';
      ctx.fillText(scale.max, scaleExtent, canvas.height - barSize - 0.5*spacing);

      ctx.textAlign = 'center';
      ctx.fillText(scale.unit, 0.5*scaleExtent, canvas.height - barSize - 0.5*spacing);
    }).catch(function(err) {
      console.error('error setting scale', err);
    });
  });
}

// Event handlers
function setShowMarchingAnts(show) {
  Promise.all([createMap, createMarchingAntsHandler]).then(function(vs) {
    var map = vs[0], handler = vs[1];
    if(show) {
      map.on('postcompose', handler);
      map.render();
    } else {
      map.un('postcompose', handler);
    }
  });
}

function setShowRainfallRadar(show) {
  Promise.all([createMap, createRainfallLayer]).then(function(vs) {
    var map = vs[0], layer = vs[1];
    if(show) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  });
}

function showDataLayer(layerName) {
  createDataLayers.then(function(layers) {
    console.log('Showing', layerName, 'from', layers);

    var selectedLayer;
    layers.forEach(function(l) {
      l.layer.setVisible(l.name === layerName);
      if(l.name === layerName) { selectedLayer = l; }
    });
    updateLayerScale(selectedLayer ? selectedLayer.scale : null);
  });
}

var createRainfallLayer = new Promise(function(resolve, reject) {
  MetOfficeData.fetchLayerUrls().then(function(data) {
    var layerUrl, layerTime;
    data.forEach(function(layer) {
      if(layer.displayName !== 'Rainfall') { return; }
      layer.urls.forEach(function(urlRecord) {
        if(!layerTime || (urlRecord.at.Time > layerTime)) {
          layerTime = urlRecord.at.Time;
          layerUrl = urlRecord.url;
        }
      });
    });

    console.log('got rainfall layer', layerUrl, 'for', layerTime);

    // create an image element for the dataset and create a canvas layer when
    // loaded
    var mapImage = document.createElement('img');
    mapImage.onload = function() {
      var imageExtent = ol.proj.transformExtent([-12, 48, 5, 61], WGS84, MAP_PROJ),
          imageSize = [mapImage.width, mapImage.height];

      console.log('Rainfall image loaded with size', imageSize, 'extent', imageExtent);
      createMap.then(function(map) {
        console.log('Creating rainfall layer for map');
        resolve(new ol.layer.Image({
          source: new ol.source.ImageCanvas({
            canvasFunction: function(extent, resolution, pixelRatio, size, projection) {
              var canvas = document.createElement('canvas');
              canvas.width = size[0]; canvas.height = size[1];

              var ctx = canvas.getContext('2d');
              ctx.webkitImageSmoothingEnabled = false;
              ctx.mozImageSmoothingEnabled = false;
              ctx.msImageSmoothingEnabled = false;
              ctx.imageSmoothingEnabled = false;

              // setup canvas to accept raw projection co-ordinates
              ctx.transform(
                pixelRatio/resolution, 0, 0, -pixelRatio/resolution,
                -pixelRatio*extent[0]/resolution, pixelRatio*extent[3]/resolution
              );

              // now convert pixel co-ordinates to projection co-ordinates
              ctx.transform(
                (imageExtent[2]-imageExtent[0])/imageSize[0], 0,
                0, -(imageExtent[3]-imageExtent[1])/imageSize[1],
                imageExtent[0], imageExtent[3]
              );

              // draw the image
              ctx.drawImage(mapImage, 0, 0);

              return canvas;
            },
          }),
        }));
      });
    };
    mapImage.crossOrigin = 'anonymous';
    mapImage.src = layerUrl;
  });
});
createRainfallLayer.catch(function(err) { console.log('failed to create rainfall layer', err); });

function osMapLayerForResolution(resolution) {
  var osOpenSpaceKey = 'FFF3760C96A04469E0430C6CA40A1131',
      osOpenSpaceUrl = 'https://rjw57.github.io/',
      extent = [0, 0, 800000, 1300000];

  // What is the tile size at this resolution?
  var tileSize = (resolution > 2) ? 200 : 250;

  // What is the next heighest and lowest resolution?
  var nextHigherRes = resolution+0.5, nextLowerRes = resolution-0.5;
  switch(resolution) {
    case 2500:
      nextHigherRes = 5000; nextLowerRes = 1000;
      break;
    case 1000:
      nextHigherRes = 2500; nextLowerRes = 500;
      break;
    case 500:
      nextHigherRes = 1000; nextLowerRes = 200;
      break;
    case 200:
      nextHigherRes = 500; nextLowerRes = 100;
      break;
    case 100:
      nextHigherRes = 200; nextLowerRes = 50;
      break;
    case 50:
      nextHigherRes = 100; nextLowerRes = 25;
      break;
    case 25:
      nextHigherRes = 50; nextLowerRes = 10;
      break;
    case 10:
      nextHigherRes = 25; nextLowerRes = 5;
      break;
    case 5:
      nextHigherRes = 10; nextLowerRes = 2;
      break;
    case 2:
      nextHigherRes = 5; nextLowerRes = 1;
      break;
    case 1:
      nextHigherRes = 2; nextLowerRes = 0.5;
      break;
  }

  // OSOpenSpace WMS layer code taken from http://maps.peterrobins.co.uk/files/gb.js
  var osMapSource = new ol.source.TileWMS({
    url: 'http://openspace.ordnancesurvey.co.uk/osmapapi/ts',
    params: {
      'VERSION': '1.1.1',
      'LAYERS': '' + resolution,
      'URL': osOpenSpaceUrl,
      'KEY': osOpenSpaceKey,
    },
    attributions: [new ol.Attribution({
      html: 'Topo maps &copy; Crown copyright and database rights ' + 
          new Date().getFullYear() + 
          ' <span style="white-space: nowrap;">Ordnance Survey.</span>' +
          '&nbsp;&nbsp;<span style="white-space: nowrap;">' +
          '<a href="http://openspace.ordnancesurvey.co.uk/openspace/developeragreement.html#enduserlicense"' +
          'target="_blank">End User License Agreement</a></span>'
    })],
    logo: 'http://openspace.ordnancesurvey.co.uk/osmapapi/img_versions/img_4.0.0/OS/poweredby_free.png',
    extent: extent,
    crossOrigin: 'anonymous',
    projection: 'EPSG:27700',
    tileGrid: new ol.tilegrid.TileGrid({
      tileSizes: [tileSize],
      resolutions: [resolution],
      origin: [0, 0],
    }),
  });

  var osMapLayer = new ol.layer.Tile({
    source: osMapSource,
    maxResolution: nextHigherRes-0.5,
    minResolution: nextLowerRes,
  });

  return osMapLayer;
}

})();
