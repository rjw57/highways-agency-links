// Teach proj4 about the British national grid
proj4.defs("EPSG:27700",
    "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs");

(function() {
'use strict';

// ///// CONSTANTS /////

var WGS84 = 'EPSG:4326',
    MAP_PROJ = 'EPSG:3857';

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

  // Create the base map
  var map = new ol.Map({
    target: 'map',
    // renderer: ['webgl', 'canvas', 'dom'],
    layers: [
      new ol.layer.Tile({
        source: new ol.source.MapQuest({layer: 'osm'}),
        //source: new ol.source.TileJSON({
        //  url: '//api.tiles.mapbox.com/v3/mapbox.world-bright.jsonp',
        //  crossOrigin: 'anonymous',
        //}),
      }),
    ],
    view: new ol.View({
      maxZoom: 18, minZoom: 0,
      center: ol.proj.transform([-0.09, 51.505], WGS84, MAP_PROJ),
      zoom: 8,
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

              /*
              ctx.fillStyle = 'red';
              ctx.fillRect(0, 0, size[0], size[1]);
              */

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

Promise.all([createMap, createRainfallLayer]).then(function(values) {
  values[0].addLayer(values[1]);
});

})();
