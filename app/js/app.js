(function() {
'use strict';

// ///// CONSTANTS /////

// colour scheme
var LINK_COLOUR = tinycolor({ h: 240, s: 100, v: 75 }).toHexString(),
    SRC_SINK_COLOUR = tinycolor({ h: 0, s: 100, v: 75 }).toHexString();

var DATA_SERVER = '//trafficdata-realtimetraffic.rhcloud.com/data/';

// Uncomment for testing
// DATA_SERVER = 'http://localhost:5000/data/';

var networkToRBush = function(network) {
  var items = [];
  network.getEdges().forEach(function(edge) {
    var p1 = network.getNodeById(edge.nodes[0]).data.pos,
        p2 = network.getNodeById(edge.nodes[1]).data.pos;

    items.push([
      Math.min(p1[0], p2[0]), Math.min(p1[1], p2[1]),
      Math.max(p1[0], p2[0]), Math.max(p1[1], p2[1]),
      edge.id,
    ]);
  });

  var tree = rbush();
  tree.load(items);
  return tree;
};

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

  // Create networks for various resolutions
  var maxResolution = 30, minResolution, networks = [];
  while(maxResolution < 1000) {
    console.log(G);

    networks.push({
      minResolution: minResolution, maxResolution: maxResolution,
      graph: G, tree: networkToRBush(G),
    });

    minResolution = maxResolution;
    maxResolution = maxResolution * 3;
    G = G.copy().simplify(maxResolution);
  }
  networks.push({
    minResolution: minResolution, graph: G, tree: networkToRBush(G),
  });

  console.log('Final network has ' + G.order + ' node(s) and ' +
      G.size + ' edge(s)');

  map.on('postcompose', function(event) {
    var res = map.getView().getResolution(), tree, graph;
    networks.forEach(function(n) {
      if(n.minResolution && (res < n.minResolution)) { return; }
      if(n.maxResolution && (res > n.maxResolution)) { return; }
      tree = n.tree; graph = n.graph;
    });

    if(!tree || !graph) { return; }

    var lineStrings = [];
    tree.search(event.frameState.extent).forEach(function(link) {
      var edge = graph.getEdgeById(link[4]),
          p1 = graph.getNodeById(edge.nodes[0]).data.pos,
          p2 = graph.getNodeById(edge.nodes[1]).data.pos;
      lineStrings.push([ p1, p2 ]);
    });

    event.vectorContext.setFillStrokeStyle(
      new ol.style.Fill(),
      new ol.style.Stroke({
        color: [255,0,0,1],
        width: 3,
      })
    );
    event.vectorContext.drawMultiLineStringGeometry(
      new ol.geom.MultiLineString(lineStrings), null);
  });
  map.render();

  /*
  networks.forEach(function(network) {
    map.addLayer(new ol.layer.Vector({
      source: new ol.source.GeoJSON({
        object: network.graph.edgesAsGeoJSON(function(n) { return n.data.pos }),
      }),
      minResolution: network.minResolution,
      maxResolution: network.maxResolution,
    }));
  });
  */
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
        source: new ol.source.MapQuest({layer: 'osm'}),
      }),
    ],
    view: new ol.View({
      center: ol.proj.transform([-0.09, 51.505], 'EPSG:4326', 'EPSG:3857'),
      zoom: 8,
    }),
  });

  /*
  map.getView().on('change:resolution', function(event) {
    console.log('Resolution change', event.target.getResolution());
  });
  */

  // kick off a request for the traffic network
  $.getJSON(DATA_SERVER + 'network.json', function(data) {
    haveNetwork(map, data);
    $('body').removeClass('loading');
  });
});

})();
