(function() {
'use strict';

// ///// CONSTANTS /////

// colour scheme
var LINK_COLOUR = tinycolor({ h: 240, s: 100, v: 75 }).toHexString(),
    SRC_SINK_COLOUR = tinycolor({ h: 0, s: 100, v: 75 }).toHexString();

var DATA_SERVER = '//trafficdata-realtimetraffic.rhcloud.com/data/';

// Uncomment for testing
// DATA_SERVER = 'http://localhost:5000/data/';

var haveNetwork = function(map, network) {
  console.log(network);
  // A list of node and edge objects to construct the DirectedGraph
  var nodes = [], edges = [];

  // Project each of the nodes into the map co-ordinate projection
  var srcProjection = 'EPSG:4326', dstProjection = 'EPSG:3857';
  network.graph.nodes.forEach(function(n, nIdx) {
    if(!n.pos) { return; }
    n.pos = ol.proj.transform(n.pos, srcProjection, dstProjection);
    nodes.push({ id: 'Node' + nIdx, data: n });
  });

  // Now, using the projected nodes, work out the length of each edge.
  network.graph.links.forEach(function(e, eIdx) {
    var u = network.graph.nodes[e.source], v = network.graph.nodes[e.target];
    var dx = v.pos[0] - u.pos[0], dy = v.pos[1] - v.pos[1];
    e.length = Math.sqrt(dx*dx + dy*dy);
    edges.push({
      id: 'Edge' + eIdx,
      nodes: [ 'Node' + e.source, 'Node' + e.target ],
      data: e,
    });
  });

  // OK, we've fiddled with the network enough to load it into our network class.
  var G = new DirectedGraph(nodes, edges);
  console.log('Have network graph:', G);

  console.log('Raw network has ' + G.order + ' node(s) and ' +
      G.size + ' edge(s)');

  // Create sets of GeoJSON files for various resolutions
  var maxResolution = 30, minResolution, geoJSONs = [],
      getPos = function(n) { return n.data.pos; };
  while(maxResolution < 3000) {
    console.log(G);

    geoJSONs.push({
      minResolution: minResolution, maxResolution: maxResolution,
      object: G.edgesAsGeoJSON(getPos),
    });

    minResolution = maxResolution;
    maxResolution = maxResolution * 3;
    G = G.copy().simplify(maxResolution);
  }
  geoJSONs.push({
    minResolution: minResolution,
    object: G.edgesAsGeoJSON(getPos),
  });

  console.log('Final network has ' + G.order + ' node(s) and ' +
      G.size + ' edge(s)');

  geoJSONs.forEach(function(gj) {
    map.addLayer(new ol.layer.Vector({
      source: new ol.source.GeoJSON({
        object: gj.object,
      }),
      minResolution: gj.minResolution,
      maxResolution: gj.maxResolution,
    }));
  });

  console.log(geoJSONs);
};

$(document).ready(function() {
  // Are we WebGL capable?
  console.log('Have WebGL:', ol.BrowserFeature.HAS_WEBGL);

  // Create the base map
  var map = new ol.Map({
    target: 'map',
    // renderer: ['webgl', 'canvas', 'dom'],
    layers: [
      new ol.layer.Tile({
        source: new ol.source.MapQuest({layer: 'sat'}),
      }),
    ],
    view: new ol.View({
      center: ol.proj.transform([-0.09, 51.505], 'EPSG:4326', 'EPSG:3857'),
      zoom: 11,
    }),
  });

  map.getView().on('change:resolution', function(event) {
    console.log('Resolution change', event.target.getResolution());
  });

  // kick off a request for the traffic network
  $.getJSON(DATA_SERVER + 'network.json', function(data) {
    haveNetwork(map, data);
    $('body').removeClass('loading');
  });
});

})();
