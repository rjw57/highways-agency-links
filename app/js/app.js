(function() {
'use strict';

// ///// CONSTANTS /////

// colour scheme
var LINK_COLOUR = tinycolor({ h: 240, s: 100, v: 75 }).toHexString(),
    SRC_SINK_COLOUR = tinycolor({ h: 0, s: 100, v: 75 }).toHexString();

var haveNetwork = function(map, network) {
  // A list of node and edge objects to construct the DirectedGraph
  var nodes = [], edges = [];

  // Project each of the nodes into the map co-ordinate projection
  var srcProjection = 'EPSG:4326', dstProjection = 'EPSG:3857';
  network.nodes.forEach(function(n, nIdx) {
    if(!n.pos) { return; }
    n.pos = ol.proj.transform(n.pos, srcProjection, dstProjection);
    nodes.push({ id: 'Node' + nIdx, data: n });
  });

  // Now, using the projected nodes, work out the length of each edge.
  network.edges.forEach(function(e, eIdx) {
    var u = network.nodes[e.nodes[0]], v = network.nodes[e.nodes[1]];
    var dx = v.pos[0] - u.pos[0], dy = v.pos[1] - v.pos[1];
    e.length = Math.sqrt(dx*dx + dy*dy);
    edges.push({
      id: 'Edge' + eIdx,
      nodes: [ 'Node' + e.nodes[0], 'Node' + e.nodes[1] ],
      data: e,
    });
  });

  // OK, we've fiddled with the network enough to load it into our network class.
  var G = new DirectedGraph(nodes, edges);
  console.log('Have network graph:', G);

  console.log('Raw network has ' + G.order + ' node(s) and ' +
      G.size + ' edge(s)');

  var collapsedG = G.simplify(100);

  console.log('Collapsed network has ' + collapsedG.order +
      ' node(s) and ' + collapsedG.size + ' edge(s)');
  console.log(collapsedG);

  var collapsedGeoJSON = collapsedG.edgesAsGeoJSON(function(n) { return n.data.pos; });
  console.log('GeoJSON:', collapsedGeoJSON);

  map.addLayer(new ol.layer.Vector({
    source: new ol.source.GeoJSON({
      object: collapsedGeoJSON,
    }),
  }));
};

$(document).ready(function() {
  // HACK!
  $('body').removeClass('loading');

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

  /*
  // create our leaflet map
  var map = L.map('map', {
    attributionControl: false,
  }).setView([51.505, -0.09], 13);

  // add attribuion control
  L.control.attribution({ prefix: false }).addTo(map);

  // add scale
  L.control.scale().addTo(map);

  // use OSM base layer
  var baseMap = L.tileLayer('//otile{s}-s.mqcdn.com/tiles/1.0.0/map/{z}/{x}/{y}.jpg', {
    subdomains: '1234',
    attribution: '© OpenStreetMap contributors',
  }).addTo(map);
  */

  // kick off a request for the traffic network
  $.getJSON('//realtime-traffic.appspot.com/data/network.json', function(data) {
    haveNetwork(map, data);
  });

  // kick off a request for our data
  $.getJSON('//realtime-traffic.appspot.com/data/links.geojson', function(data) {
      // haveLinksGeoJSON(map, data);
  });

  /*
  // kick off a request for our data
  $.getJSON('//realtime-traffic.appspot.com/data/links.geojson', function(data) {
    var featureCollectionsForZooms, linkLayersForZooms, z, linkBounds, bounds,
        addLayersForZoom, linkLayerGroup;

    console.log('got links');
    console.log(data);

    // split the incoming geojson into several sets of features. Each set is
    // parameterised by the minimum zoom level at which that feature should be
    // displayed.

    featureCollectionsForZooms = {};
    for(z=map.getMinZoom(); z<=map.getMaxZoom(); ++z) {
      featureCollectionsForZooms[z] = {
        type: 'FeatureCollection', features: [], properties: data.properties,
      }
    }

    data.features.forEach(function(feature) {
      // For each zoom...
      var coords = feature.geometry.coordinates,
          from = L.latLng(coords[0][1], coords[0][0]),
          to = L.latLng(coords[1][1], coords[1][0]);

      for(var z=map.getMinZoom(); z<map.getMaxZoom(); ++z) {
        // convert feature bounds to pixel coord extent
        var extent = map.project(from, z).distanceTo(map.project(to, z));

        // if we are bigger than a given number of pixels at this zoom level,
        // we should be displayed at it
        if(extent > 1) {
          featureCollectionsForZooms[z].features.push(feature);
          return;
        }
      }

      // otherwise, we should just display this feature at maximum zoom
      featureCollectionsForZooms[map.getMaxZoom()].features.push(feature);
    });

    // Create layers for each zoom creating a total bounds on the way
    linkLayersForZooms = {};
    for(z=map.getMinZoom(); z<=map.getMaxZoom(); ++z) {
      if(featureCollectionsForZooms[z].features.length > 0) {
        linkLayersForZooms[z] = L.layerGroup()
          .addLayer(L.geoJson(featureCollectionsForZooms[z], {
              filter: function(feature, layer) {
                var props = feature.properties;
                return props.type === 'link';
              },
              color: LINK_COLOUR,
              weight: 5,
              opacity: 1,
            }))
          .addLayer(L.geoJson(featureCollectionsForZooms[z], {
              filter: function(feature, layer) {
                var props = feature.properties;
                return props.type !== 'link';
              },
              color: SRC_SINK_COLOUR,
              weight: 5,
              opacity: 1,
            }))
          .eachLayer(function(l) {
            bounds = l.getBounds();
            if(linkBounds) {
              linkBounds.extend(bounds);
            } else {
              linkBounds = L.latLngBounds(bounds.getSouthWest(), bounds.getNorthEast());
            }
          });
      }
    }

    // Zoom to complete extent
    map.fitBounds(linkBounds, { padding: [10,10] });

    // Hide all the magic behind a single link layer
    linkLayerGroup = L.layerGroup();
    addLayersForZoom = function(zoom) {
      var l, n=0, m=0;
      console.log('Processing zoom:', zoom);
      for(z=map.getMinZoom(); z<=map.getMaxZoom(); ++z) {
        l = linkLayersForZooms[z];
        if(!l) { continue; }

        if(zoom < z) {
          if(map.hasLayer(l)) { linkLayerGroup.removeLayer(l); ++m; }
        } else {
          if(!map.hasLayer(l)) { linkLayerGroup.addLayer(l); ++n; }
        }
      }
      console.log('Added ' + n +' layers, removed ' + m);
    };

    // Wire up zoom events to link layer
    addLayersForZoom(map.getZoom());
    map.on('zoomend', function() { addLayersForZoom(map.getZoom()); });

    // Add link layer to map
    linkLayerGroup.addTo(map);

    // clear loading
    $('body').removeClass('loading');
  });
  */
});

})();
