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

    $('canvas.scale').each(function(idx, canvas) {
      canvas.width = $(canvas).width();
      canvas.height = $(canvas).height();

      var ctx = canvas.getContext('2d'), color, dy=Math.max(1, Math.floor(canvas.height/255));
      for(var y=0; y<canvas.height; y+=dy) {
        color = redGreen(canvas.height-y, canvas.height);
        ctx.fillStyle = tinycolor({r:color[0], g:color[1], b:color[2], a:color[3]}).toHexString();
        ctx.fillRect(0, y, canvas.width, dy);
      }
    });

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
    ]),
  });

  return map;
});

var fetchData = RealtimeTrafficData.createFetchDataPromise({
  destProjection: MAP_PROJ,
});
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
  trafficData.data.speeds = graphInterpolateData(trafficData.data.speeds, trafficData.graph);
  trafficData.data.flows = graphInterpolateData(trafficData.data.flows, trafficData.graph);
  trafficData.data.occupancies = graphInterpolateData(trafficData.data.occupancies, trafficData.graph);
  return trafficData;
});

// Create the traffic data layers
var createDataLayers = Promise.all([createMap, fetchData]).then(function(vals) {
  var map = vals[0], trafficData = vals[1];
  console.log('create data layers on', map, trafficData);

  // Create an image canvas source layer for the traffic data
  map.addLayer(newTrafficDataLayer({
    data: trafficData, roadShift: ROAD_SHIFT, roadWidth: ROAD_WIDTH,
    type: 'speed', scale: { min: 0, max: MAX_SPEED, map: redGreen },
    // type: 'flow', scale: { min: 0, max: MAX_FLOW, map: heat },
  }));
});

var createMarchingAntsHandler = Promise.all([createMap, interpolateData]).then(function(vals) {
  var map = vals[0], trafficData = vals[1];
  console.log('set up marching ants on', map, trafficData);

  // Create a post-compose handler for displaying cars
  var pch = new MarchingAntsRenderer(trafficData, ROAD_SHIFT, ROAD_WIDTH);
  var handlerFunc = pch.handleEvent.bind(pch);
  return handlerFunc;
});
createMarchingAntsHandler.catch(function(err) {
  console.log('error in marching ants', err);
});

// Remove loading screen once data is fetched
(function() {
  function stopLoading() { $('body').removeClass('loading'); }
  fetchData.then(stopLoading, stopLoading);
})();

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
  console.log('Showing', layerName);
}

})();
